import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { io as SocketClient } from 'socket.io-client';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initDatabase, getDB } from './database.js';
import { analyzeFrameForAnomalies, validateSOPStep, validateSessionSignOff, analyzeLiveFrame } from './visionAnalyzer.js';
import { profileSession, saveProfileAlerts } from './sessionProfiler.js';
import { formatAlert, emitAlertToSession, emitSOPUpdate, emitSignOffResult } from './alertEmitter.js';

dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'missing_key');
const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' }, { apiVersion: 'v1beta' });

const app = express();
app.use(cors());
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

    // Emit initial "System Ready" alerts for interactivity
    setTimeout(() => {
      const welcomeAlert = formatAlert({
        type: 'system',
        severity: 'low',
        title: 'AI Monitor Online',
        description: 'Real-time safety and quality monitoring has started. Analyzing frames at 10s intervals.',
        confidence: 1.0
      }, sessionId, 'system');
      emitAlertToSession(edgeSocket, sessionId, welcomeAlert);
      
      const engineAlert = formatAlert({
        type: 'system',
        severity: 'low',
        title: 'Vision Engine Active',
        description: 'Using gemini-3.1-flash-lite-preview for autonomous SOP validation.',
        confidence: 1.0
      }, sessionId, 'system');
      emitAlertToSession(edgeSocket, sessionId, engineAlert);
    }, 1500);
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

// Helper: Analyze equipment image for pre-session diagnosis
async function analyzeEquipmentImage(imageData, equipmentType = null) {
  const systemPrompt = `You are an industrial equipment diagnostic AI assistant with expertise in hydraulic systems, electrical panels, engines, and manufacturing equipment.

Analyze the provided image and identify:
1. Equipment type and model (if visible)
2. Failure mode or issue present
3. Severity level: LOW (cosmetic), MEDIUM (performance degraded), HIGH (safety risk), CRITICAL (immediate danger)
4. Root cause analysis
5. Required replacement parts with realistic SKU-style codes and estimated costs
6. Estimated repair time for a junior technician
7. Recommendation: "SOLO_REPAIR" if straightforward replacement/adjustment, "CALL_EXPERT" if complex diagnosis needed or safety-critical
8. Step-by-step repair instructions (5-8 steps maximum)

Return ONLY valid JSON matching this exact schema (no markdown, no preamble):
{
  "equipmentType": "string",
  "issue": "string",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": 0.85,
  "partsNeeded": [
    { "name": "string", "sku": "string", "estimatedCost": 12.99 }
  ],
  "estimatedRepairTime": "15-20 minutes",
  "recommendation": "SOLO_REPAIR" | "CALL_EXPERT",
  "repairSteps": [
    "1. Step one",
    "2. Step two"
  ],
  "reasoning": "Brief explanation of diagnosis"
}

If you cannot confidently diagnose from the image (blurry, wrong angle, equipment not visible), return:
{ "error": "Unable to analyze - please retake photo with equipment clearly visible" }`;

  try {
    const base64Image = imageData.includes('base64,') 
      ? imageData.split('base64,')[1] 
      : imageData;

    const result = await model.generateContent([
      systemPrompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: 'image/jpeg'
        }
      }
    ]);

    const textResponse = result.response.text().trim();
    
    // Remove markdown code blocks if present
    const cleanedResponse = textResponse
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const diagnosis = JSON.parse(cleanedResponse);
    
    // Check for error response
    if (diagnosis.error) {
      throw new Error(diagnosis.error);
    }

    // Validate minimum confidence threshold
    if (diagnosis.confidence < 0.65) {
      return {
        error: "Low confidence diagnosis - image quality insufficient or equipment unclear"
      };
    }
    
    return diagnosis;

  } catch (error) {
    console.error('Equipment analysis error:', error);
    throw error;
  }
}

// Pre-Session Diagnostics Endpoint
app.post('/api/pre-diagnose', async (req, res) => {
  try {
    const { imageData, equipmentType } = req.body;
    
    // Validate input
    if (!imageData) {
      return res.status(400).json({ 
        success: false, 
        error: 'No image data provided' 
      });
    }

    console.log('[Pre-Diagnose] Analyzing equipment image...');
    
    // Call Gemini Vision API
    const diagnosis = await analyzeEquipmentImage(imageData, equipmentType);
    
    // Check for error response from AI
    if (diagnosis.error) {
      return res.json({ 
        success: false, 
        error: diagnosis.error 
      });
    }

    // Generate hash of image for deduplication
    const imageHash = crypto
      .createHash('md5')
      .update(imageData)
      .digest('hex');

    // Save to database
    db.prepare(`
      INSERT INTO pre_diagnostics 
      (image_hash, equipment_type, issue, severity, confidence, 
       parts_needed, recommendation, repair_steps, reasoning, 
       timestamp, technician_action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      imageHash,
      diagnosis.equipmentType || 'Unknown',
      diagnosis.issue,
      diagnosis.severity,
      diagnosis.confidence,
      JSON.stringify(diagnosis.partsNeeded),
      diagnosis.recommendation,
      JSON.stringify(diagnosis.repairSteps),
      diagnosis.reasoning,
      new Date().toISOString(),
      null // technician_action filled later when they choose action
    );

    console.log('[Pre-Diagnose] Success:', {
      equipment: diagnosis.equipmentType,
      severity: diagnosis.severity,
      recommendation: diagnosis.recommendation
    });

    res.json({ 
      success: true, 
      diagnosis 
    });
    
  } catch (error) {
    console.error('[Pre-Diagnose] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to analyze image'
    });
  }
});

// Optional: Endpoint to update technician action after diagnosis
app.post('/api/pre-diagnose/:id/action', (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "accepted_solo" | "called_expert" | "dismissed"
    
    db.prepare(`
      UPDATE pre_diagnostics 
      SET technician_action = ? 
      WHERE id = ?
    `).run(action, id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// LIVE SESSION REAL-TIME ANALYSIS ENDPOINT
app.post('/api/analyze-live', async (req, res) => {
  try {
    const { sessionId, frameData, activeSopId, timestamp } = req.body;
    if (!frameData) return res.status(400).json({ success: false, error: 'No frame data' });

    // Look up SOP step if activeSopId is provided
    let stepData = null;
    if (activeSopId) {
      const sopDef = db.prepare('SELECT * FROM sop_definitions WHERE id = ?').get(activeSopId);
      if (sopDef) {
        const steps = JSON.parse(sopDef.steps);
        const session = db.prepare('SELECT steps_completed FROM sessions WHERE id = ?').get(sessionId);
        const currentStepNum = (session?.steps_completed || 0) + 1;
        stepData = steps.find(s => s.number === currentStepNum);
      }
    }

    const result = await analyzeLiveFrame(frameData, activeSopId, stepData);

    if (result.issuesFound && result.findings && result.findings.length > 0) {
      for (const finding of result.findings) {
        if (finding.confidence > 0.70) {
          const alert = {
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sessionId,
            timestamp: timestamp || new Date().toISOString(),
            type: finding.type,
            severity: finding.severity,
            finding: finding.finding,
            confidence: finding.confidence,
            recommendation: finding.recommendation,
            sopStepId: stepData ? stepData.number.toString() : null,
            expert_response: null
          };

          // Save to database
          try {
            db.prepare(`
              INSERT INTO ai_alerts (session_id, alert_type, severity, title, description, confidence, frame_timestamp, recommendation, sop_step_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              sessionId, 
              alert.type, 
              alert.severity, 
              'Live Alert', 
              alert.finding, 
              alert.confidence, 
              Date.now(), 
              alert.recommendation, 
              alert.sopStepId
            );
          } catch(e) {
             console.error('[AI-CoPilot] Alert DB insert failed:', e.message);
          }

          // Broadcast via socket to edge server
          edgeSocket.emit('broadcast-ai-alert', { sessionId, alert });
        }
      }
      return res.json({ success: true, issuesFound: true });
    }

    return res.json({ success: true, noIssues: true });
  } catch (error) {
    console.error('[AI-CoPilot] /api/analyze-live error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ALERT ACTION LOGGING ENDPOINT
app.post('/api/alert-action', (req, res) => {
  try {
    const { alertId, action, sessionId } = req.body;
    db.prepare(`
      UPDATE ai_alerts 
      SET expert_response = ?, response_timestamp = ?, acknowledged = ?
      WHERE id = ? OR description = ?
    `).run(action, new Date().toISOString(), action === 'acknowledged' ? 1 : 0, alertId, alertId);
    // Since we generate random IDs, we might fallback to checking description or just log
    res.json({ success: true });
  } catch (error) {
    console.error('[AI-CoPilot] Alert action update error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || process.env.AI_SERVICE_PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[AI-CoPilot] Service running on port ${PORT}`);
});
