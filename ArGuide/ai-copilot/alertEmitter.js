export function formatAlert(rawAlert, sessionId, source) {
  return {
    id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    sessionId,
    source, // 'vision' | 'sop' | 'profiler' | 'signoff'
    type: rawAlert.type,
    severity: rawAlert.severity, // 'low' | 'medium' | 'high' | 'critical'
    title: rawAlert.title,
    description: rawAlert.description,
    confidence: rawAlert.confidence,
    timestamp: Date.now(),
    acknowledged: false
  };
}

export function emitAlertToSession(socket, sessionId, alert) {
  socket.emit('ai_alert', {
    room: sessionId,
    alert
  });
  console.log(`[AlertEmitter] Emitted ${alert.severity} alert to session ${sessionId}: ${alert.title}`);
}

export function emitSOPUpdate(socket, sessionId, stepNumber, validationResult) {
  socket.emit('sop_step_update', {
    room: sessionId,
    stepNumber,
    confidence: validationResult.compliance_confidence,
    concerns: validationResult.concerns,
    recommendation: validationResult.recommendation,
    timestamp: Date.now()
  });
}

export function emitSignOffResult(socket, sessionId, signOffResult) {
  socket.emit('sign_off_result', {
    room: sessionId,
    ...signOffResult,
    timestamp: Date.now()
  });
}
