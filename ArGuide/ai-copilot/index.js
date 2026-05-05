import express from 'express';
import { createServer } from 'http';
import { io as SocketClient } from 'socket.io-client';
import dotenv from 'dotenv';
import { initDatabase, getDB } from './database.js';
import { analyzeFrameForAnomalies, validateSOPStep, validateSessionSignOff } from './visionAnalyzer.js';
import { profileSession, saveProfileAlerts } from './sessionProfiler.js';
import { formatAlert, emitAlertToSession, emitSOPUpdate, emitSignOffResult } from './alertEmitter.js';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));
const httpServer = createServer(app);
const db = initDatabase();

// Connect to existing Edge Server as a client
const edgeSocket = SocketClient(process.env.EDGE_SERVER_URL, {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000
});

edgeSocket.on('connect', () => {
  console.log('[AI-CoPilot] Connected to Edge Server at', process.env.EDGE_SERVER_URL);
  edgeSocket.emit('register_ai_service', { service: 'ai-copilot', version: '1.0.0' });
});

edgeSocket.on('disconnect', () => {
  console.warn('[AI-CoPilot] Disconnected from Edge Server — attempting reconnect...');
});

// Active session registry: sessionId → { state, sessionContext, startedAt, sopCurrentStep, alertsEmitted }
const activeSessions = new Map();

// LISTEN: Frame data sent from technician via Edge Server relay
edgeSocket.on('ai_frame_capture', async (data) => {
  const { sessionId, frameBase64, sessionContext } = data;

  if (!activeSessions.has(sessionId)) {
    console.log(`[AI-CoPilot] New session registered: ${sessionId}`);
    activeSessions.set(sessionId, {
      sessionId,
      sessionContext,
      startedAt: Date.now(),
      lastFrameAnalysis: null,
      sopCurrentStep: 1,
      alertsEmitted: 0
    });

    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!existing) {
      db.prepare(`
        INSERT INTO sessions (id, technician_name, expert_name, location, repair_type, started_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(
        sessionId,
        sessionContext.technicianName || 'Unknown',
        sessionContext.expertName || 'Unknown',
        sessionContext.location || 'Unknown',
        sessionContext.repairType || 'general',
        Math.floor(Date.now() / 1000)
      );
    }
  }

  runVisionAnalysis(sessionId, frameBase64, sessionContext);
});

// LISTEN: SOP step change event (expert or technician marks step done)
edgeSocket.on('sop_step_completed', async (data) => {
  const { sessionId, stepNumber, frameBase64, sessionContext } = data;
  const session = activeSessions.get(sessionId);
  if (!session) return;

  session.sopCurrentStep = stepNumber + 1;

  const sopDef = db.prepare('SELECT * FROM sop_definitions WHERE repair_type = ?').get(sessionContext?.repairType);
  if (!sopDef) return;

  const steps = JSON.parse(sopDef.steps);
  const step = steps.find(s => s.number === stepNumber);
  if (!step) return;

  const validation = await validateSOPStep(frameBase64, step, sessionContext);

  db.prepare(`
    INSERT OR REPLACE INTO sop_steps (session_id, sop_id, step_number, step_name, completed, completed_at, ai_validated, confidence)
    VALUES (?, ?, ?, ?, 1, ?, 1, ?)
  `).run(sessionId, sopDef.id, stepNumber, step.name, Math.floor(Date.now() / 1000), validation.compliance_confidence);

  emitSOPUpdate(edgeSocket, sessionId, stepNumber, validation);

  if (step.critical && validation.compliance_confidence < 0.65) {
    const alert = formatAlert({
      type: 'sop_compliance_concern',
      severity: 'high',
      title: `Critical Step ${stepNumber} — Low AI Confidence`,
      description: `Step "${step.name}" has a compliance confidence of ${Math.round(validation.compliance_confidence * 100)}%. ${validation.concerns.join('; ')}`,
      confidence: validation.compliance_confidence
    }, sessionId, 'sop');
    emitAlertToSession(edgeSocket, sessionId, alert);
    saveAlertToDB(sessionId, alert);
  }
});

// LISTEN: Technician requests sign-off
edgeSocket.on('request_sign_off', async (data) => {
  const { sessionId, sessionContext } = data;
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000);

  const completedSteps = db.prepare('SELECT * FROM sop_steps WHERE session_id = ? AND completed = 1').all(sessionId);
  const sopDef = db.prepare('SELECT * FROM sop_definitions WHERE repair_type = ?').get(sessionContext?.repairType);
  const allSteps = sopDef ? JSON.parse(sopDef.steps) : [];
  const criticalSteps = allSteps.filter(s => s.critical);
  const criticalCompleted = completedSteps.filter(s => {
    const def = allSteps.find(a => a.number === s.step_number);
    return def?.critical;
  });

  const alertStats = db.prepare('SELECT COUNT(*) as total, SUM(acknowledged) as acked FROM ai_alerts WHERE session_id = ?').get(sessionId);

  const signOffResult = await validateSessionSignOff(
    {
      repairType: sessionContext?.repairType,
      expectedDurationMin: sopDef?.expected_duration_min,
      expectedDurationMax: sopDef?.expected_duration_max,
      alertsCount: alertStats?.total || 0,
      alertsAcknowledged: alertStats?.acked || 0
    },
    {
      completed: completedSteps.length,
      total: allSteps.length,
      criticalCompleted: criticalCompleted.length,
      criticalTotal: criticalSteps.length
    },
    Math.round(elapsedSeconds / 60)
  );

  emitSignOffResult(edgeSocket, sessionId, signOffResult);
});

// LISTEN: Session ended
edgeSocket.on('session_ended', (data) => {
  const { sessionId } = data;
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);
    const durationSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
    db.prepare('UPDATE sessions SET ended_at = ?, duration_seconds = ?, status = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), durationSeconds, 'completed', sessionId);
    activeSessions.delete(sessionId);
    console.log(`[AI-CoPilot] Session ${sessionId} closed. Duration: ${durationSeconds}s`);
  }
});

// SESSION PROFILING — runs on interval for all active sessions
setInterval(() => {
  for (const [sessionId, session] of activeSessions.entries()) {
    const sopDef = db.prepare('SELECT * FROM sop_definitions WHERE repair_type = ?').get(session.sessionContext?.repairType);
    const completedCount = db.prepare('SELECT COUNT(*) as count FROM sop_steps WHERE session_id = ? AND completed = 1').get(sessionId);
    const totalSteps = sopDef ? JSON.parse(sopDef.steps).length : 0;

    const profileAlerts = profileSession({
      sessionId,
      repairType: session.sessionContext?.repairType,
      startedAt: session.startedAt,
      stepsCompleted: completedCount?.count || 0,
      stepsTotal: totalSteps,
      sopExpectedDurationMin: sopDef?.expected_duration_min,
      sopExpectedDurationMax: sopDef?.expected_duration_max
    });

    for (const rawAlert of profileAlerts) {
      const alert = formatAlert(rawAlert, sessionId, 'profiler');
      emitAlertToSession(edgeSocket, sessionId, alert);
    }

    if (profileAlerts.length > 0) {
      saveProfileAlerts(sessionId, profileAlerts);
    }
  }
}, parseInt(process.env.SESSION_PROFILE_CHECK_INTERVAL_MS) || 30000);

// Helper: Vision analysis runner
async function runVisionAnalysis(sessionId, frameBase64, sessionContext) {
  try {
    const result = await analyzeFrameForAnomalies(frameBase64, sessionContext);

    db.prepare(`
      INSERT INTO session_frames (session_id, captured_at, analysis_result, anomalies_detected)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, Date.now(), JSON.stringify(result), JSON.stringify(result.anomalies));

    for (const anomaly of result.anomalies || []) {
      if (anomaly.severity === 'low' && anomaly.confidence < 0.7) continue;

      const alert = formatAlert({
        type: anomaly.type,
        severity: anomaly.severity,
        title: `AI Detected: ${anomaly.type.replace(/_/g, ' ').toUpperCase()}`,
        description: anomaly.description,
        confidence: anomaly.confidence
      }, sessionId, 'vision');

      emitAlertToSession(edgeSocket, sessionId, alert);
      saveAlertToDB(sessionId, alert);
    }

    if (result.overall_status === 'critical') {
      const urgentAlert = formatAlert({
        type: 'critical_visual',
        severity: 'critical',
        title: 'CRITICAL: AI Detected High-Risk Visual',
        description: result.summary,
        confidence: 0.9
      }, sessionId, 'vision');
      emitAlertToSession(edgeSocket, sessionId, urgentAlert);
    }
  } catch (err) {
    console.error(`[AI-CoPilot] Vision analysis failed for session ${sessionId}:`, err.message);
  }
}

// Helper: Save alert to DB
function saveAlertToDB(sessionId, alert) {
  db.prepare(`
    INSERT INTO ai_alerts (session_id, alert_type, severity, title, description, confidence, frame_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, alert.type, alert.severity, alert.title, alert.description, alert.confidence, Date.now());
  db.prepare('UPDATE sessions SET ai_alerts_count = ai_alerts_count + 1 WHERE id = ?').run(sessionId);
}

// REST endpoints for dashboard
app.get('/health', (req, res) => res.json({ status: 'ok', activeSessions: activeSessions.size }));

app.get('/sessions/:id/alerts', (req, res) => {
  const alerts = db.prepare('SELECT * FROM ai_alerts WHERE session_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(alerts);
});

app.get('/sessions/:id/sop-steps', (req, res) => {
  const steps = db.prepare('SELECT * FROM sop_steps WHERE session_id = ? ORDER BY step_number ASC').all(req.params.id);
  res.json(steps);
});

app.post('/sessions/:id/alerts/:alertId/acknowledge', (req, res) => {
  db.prepare('UPDATE ai_alerts SET acknowledged = 1 WHERE id = ?').run(req.params.alertId);
  res.json({ success: true });
});

const PORT = process.env.PORT || process.env.AI_SERVICE_PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[AI-CoPilot] Service running on port ${PORT}`);
});
