import { useEffect, useState } from 'react';
import AlertBadge from './AlertBadge';
import ConfidenceScore from './ConfidenceScore';

export default function AICopilotPanel({ socket, sessionId }) {
  const [alerts, setAlerts] = useState([]);
  const [sopSteps, setSopSteps] = useState([]);
  const [signOffResult, setSignOffResult] = useState(null);
  const [isRequestingSignOff, setIsRequestingSignOff] = useState(false);

  useEffect(() => {
    if (!socket || !sessionId) return;

    const handleAlert = (alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 50));
    };

    const handleSOPUpdate = (update) => {
      setSopSteps(prev => {
        const existing = prev.findIndex(s => s.stepNumber === update.stepNumber);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = update;
          return updated;
        }
        return [...prev, update];
      });
    };

    const handleSignOff = (result) => {
      setSignOffResult(result);
      setIsRequestingSignOff(false);
    };

    socket.on('ai_alert', handleAlert);
    socket.on('sop_step_update', handleSOPUpdate);
    socket.on('sign_off_result', handleSignOff);

    return () => {
      socket.off('ai_alert', handleAlert);
      socket.off('sop_step_update', handleSOPUpdate);
      socket.off('sign_off_result', handleSignOff);
    };
  }, [socket, sessionId]);

  const acknowledgeAlert = (alertId) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
    fetch(`http://localhost:3000/sessions/${sessionId}/alerts/${alertId}/acknowledge`, { method: 'POST' });
  };

  const requestSignOff = () => {
    setIsRequestingSignOff(true);
    setSignOffResult(null);
    socket.emit('request_sign_off', { sessionId });
  };

  const unacknowledgedCritical = alerts.filter(a => !a.acknowledged && a.severity === 'critical').length;
  const unacknowledgedHigh = alerts.filter(a => !a.acknowledged && a.severity === 'high').length;

  return (
    <div style={{
      width: '280px',
      background: '#0f172a',
      borderLeft: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: 'monospace',
      flexShrink: 0
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8', fontSize: '11px', letterSpacing: '0.1em' }}>AI CO-PILOT</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {unacknowledgedCritical > 0 && (
              <span style={{ background: '#dc2626', color: 'white', borderRadius: '10px', fontSize: '9px', padding: '1px 6px' }}>
                {unacknowledgedCritical} CRITICAL
              </span>
            )}
            {unacknowledgedHigh > 0 && (
              <span style={{ background: '#d97706', color: 'white', borderRadius: '10px', fontSize: '9px', padding: '1px 6px' }}>
                {unacknowledgedHigh} HIGH
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Alerts Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {alerts.length === 0 && (
          <div style={{ color: '#334155', textAlign: 'center', padding: '24px 0', fontSize: '11px' }}>
            No alerts — session looks clean
          </div>
        )}
        {alerts.map(alert => (
          <AlertBadge key={alert.id} alert={alert} onAcknowledge={acknowledgeAlert} />
        ))}
      </div>

      {/* SOP Step Confidence */}
      {sopSteps.length > 0 && (
        <div style={{ borderTop: '1px solid #1e293b', padding: '8px' }}>
          <div style={{ color: '#64748b', fontSize: '10px', letterSpacing: '0.08em', marginBottom: '6px' }}>
            SOP COMPLIANCE
          </div>
          {sopSteps.map(step => (
            <ConfidenceScore key={step.stepNumber} step={step} />
          ))}
        </div>
      )}

      {/* Sign-Off Request Panel */}
      <div style={{ borderTop: '1px solid #1e293b', padding: '12px' }}>
        <button
          onClick={requestSignOff}
          disabled={isRequestingSignOff}
          style={{
            width: '100%',
            padding: '8px',
            background: isRequestingSignOff ? '#1e293b' : '#0f4c2a',
            border: '1px solid #166534',
            borderRadius: '6px',
            color: isRequestingSignOff ? '#64748b' : '#4ade80',
            fontSize: '11px',
            cursor: isRequestingSignOff ? 'not-allowed' : 'pointer',
            letterSpacing: '0.05em'
          }}
        >
          {isRequestingSignOff ? 'VALIDATING...' : '▶ REQUEST AI SIGN-OFF'}
        </button>

        {signOffResult && (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: signOffResult.sign_off_recommended ? '#0f4c2a' : '#4c0f0f',
            borderRadius: '6px',
            fontSize: '11px'
          }}>
            <div style={{ color: signOffResult.sign_off_recommended ? '#4ade80' : '#f87171', fontWeight: 700, marginBottom: '4px' }}>
              {signOffResult.sign_off_recommended ? '✓ SIGN-OFF APPROVED' : '✗ SIGN-OFF BLOCKED'}
            </div>
            <div style={{ color: '#94a3b8', marginTop: '4px' }}>{signOffResult.summary}</div>
            {signOffResult.blockers?.length > 0 && (
              <div style={{ marginTop: '6px' }}>
                {signOffResult.blockers.map((b, i) => (
                  <div key={i} style={{ color: '#f87171', fontSize: '10px' }}>• {b}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
