import { getDB } from './database.js';

export function getHistoricalAverage(repairType) {
  const db = getDB();
  const result = db.prepare(`
    SELECT AVG(duration_seconds) as avg_duration, COUNT(*) as session_count
    FROM sessions
    WHERE repair_type = ? AND status = 'completed'
  `).get(repairType);

  return {
    avgDurationSeconds: result?.avg_duration || null,
    sessionCount: result?.session_count || 0
  };
}

export function profileSession(sessionState) {
  const alerts = [];
  const db = getDB();

  const {
    sessionId,
    repairType,
    startedAt,
    stepsCompleted,
    stepsTotal,
    sopExpectedDurationMin,
    sopExpectedDurationMax
  } = sessionState;

  const elapsedMinutes = (Date.now() - startedAt) / 1000 / 60;

  // CHECK 1: Session running faster than minimum SOP duration
  if (sopExpectedDurationMin && elapsedMinutes < sopExpectedDurationMin * 0.6 && stepsCompleted > stepsTotal * 0.7) {
    alerts.push({
      type: 'time_pressure',
      severity: 'high',
      title: 'Session Progressing Too Fast',
      description: `${stepsCompleted} of ${stepsTotal} steps completed in ${Math.round(elapsedMinutes)} min (min expected: ${sopExpectedDurationMin} min)`,
      confidence: 0.85
    });
  }

  // CHECK 2: Compare against historical average
  const historical = getHistoricalAverage(repairType);
  if (historical.sessionCount >= 3 && historical.avgDurationSeconds) {
    const avgMinutes = historical.avgDurationSeconds / 60;
    const percentOfAvg = (elapsedMinutes / avgMinutes) * 100;

    if (stepsCompleted > stepsTotal * 0.5 && percentOfAvg < 40) {
      alerts.push({
        type: 'below_historical_average',
        severity: 'medium',
        title: 'Session Duration Below Historical Average',
        description: `Current pace is ${Math.round(percentOfAvg)}% of the average ${Math.round(avgMinutes)} min for ${repairType} repairs`,
        confidence: 0.75
      });
    }
  }

  // CHECK 3: Critical steps skipped detection
  const sopDef = db.prepare('SELECT steps FROM sop_definitions WHERE repair_type = ?').get(repairType);
  if (sopDef) {
    const steps = JSON.parse(sopDef.steps);
    const criticalSteps = steps.filter(s => s.critical);
    const completedSteps = db.prepare(`
      SELECT step_number FROM sop_steps
      WHERE session_id = ? AND completed = 1
    `).all(sessionId).map(r => r.step_number);

    const missedCritical = criticalSteps.filter(cs => {
      const isEarlyStep = cs.number <= Math.ceil(stepsTotal * 0.6);
      return isEarlyStep && !completedSteps.includes(cs.number);
    });

    if (missedCritical.length > 0) {
      alerts.push({
        type: 'critical_step_skipped',
        severity: 'critical',
        title: `${missedCritical.length} Critical Step(s) Not Validated`,
        description: `Steps not yet validated: ${missedCritical.map(s => `Step ${s.number} (${s.name})`).join(', ')}`,
        confidence: 0.90
      });
    }
  }

  // CHECK 4: Session stalled (no activity for too long)
  const lastActivity = db.prepare(`
    SELECT MAX(created_at) as last_alert FROM ai_alerts WHERE session_id = ?
  `).get(sessionId);

  if (lastActivity?.last_alert) {
    const minutesSinceActivity = (Date.now() / 1000 - lastActivity.last_alert) / 60;
    if (minutesSinceActivity > 20 && stepsCompleted < stepsTotal) {
      alerts.push({
        type: 'session_stalled',
        severity: 'low',
        title: 'Session Activity Stalled',
        description: `No significant updates in ${Math.round(minutesSinceActivity)} minutes with ${stepsTotal - stepsCompleted} steps remaining`,
        confidence: 0.65
      });
    }
  }

  return alerts;
}

export function saveProfileAlerts(sessionId, alerts) {
  const db = getDB();
  const insert = db.prepare(`
    INSERT INTO ai_alerts (session_id, alert_type, severity, title, description, confidence, frame_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const alert of alerts) {
    insert.run(sessionId, alert.type, alert.severity, alert.title, alert.description, alert.confidence, Date.now());
  }
}
