import { useEffect, useState, useRef } from 'react';
import AlertBadge from './AlertBadge';
import ConfidenceScore from './ConfidenceScore';

export default function AICopilotPanel({ socket, sessionId }) {
  const [alerts, setAlerts] = useState([]);
  const [sopSteps, setSopSteps] = useState([]);
  const [signOffResult, setSignOffResult] = useState(null);
  const [isRequestingSignOff, setIsRequestingSignOff] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [analysisPaused, setAnalysisPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const analysisPausedRef = useRef(false); 
  
  // Keep ref in sync
  useEffect(() => { analysisPausedRef.current = analysisPaused; }, [analysisPaused]);

  const playAlertSound = (severity) => {
    if (!audioEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      
      const playBeep = (freq, time, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
        osc.start(time);
        osc.stop(time + dur);
      };

      const now = ctx.currentTime;
      if (severity === 'CRITICAL' || severity === 'critical') {
        playBeep(880, now, 0.2);
        playBeep(880, now + 0.3, 0.2);
        playBeep(880, now + 0.6, 0.2);
      } else if (severity === 'HIGH' || severity === 'high') {
        playBeep(660, now, 0.2);
        playBeep(660, now + 0.3, 0.2);
      } else {
        playBeep(440, now, 0.2);
      }
    } catch(e) { console.log('Audio error:', e); }
  };

  useEffect(() => {
    if (!socket || !sessionId) return;

    const handleAlert = (alert) => {
      if (analysisPausedRef.current) return;
      
      setIsProcessing(true);
      setTimeout(() => setIsProcessing(false), 800);

      const normalizedAlert = { ...alert, severity: (alert.severity || 'low').toLowerCase() };
      
      setAlerts(prev => {
        const newAlerts = [normalizedAlert, ...prev].slice(0, 50);
        return newAlerts;
      });
      
      if (['medium', 'high', 'critical'].includes(normalizedAlert.severity)) {
        playAlertSound(normalizedAlert.severity);
      }
      
      if (normalizedAlert.severity === 'low') {
        setTimeout(() => dismissAlert(normalizedAlert.id), 30000);
      }
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
    socket.on('ai-alert', handleAlert); // From live analysis
    socket.on('sop_step_update', handleSOPUpdate);
    socket.on('sign_off_result', handleSignOff);

    return () => {
      socket.off('ai_alert', handleAlert);
      socket.off('ai-alert', handleAlert);
      socket.off('sop_step_update', handleSOPUpdate);
      socket.off('sign_off_result', handleSignOff);
    };
  }, [socket, sessionId, audioEnabled]); // Added audioEnabled dependency for the closure

  const acknowledgeAlert = (alertId) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
    socket.emit('alert-action', { alertId, action: 'acknowledged', sessionId });
  };

  const dismissAlert = (alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    socket.emit('alert-action', { alertId, action: 'dismissed', sessionId });
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: analysisPaused ? '#64748b' : '#10b981',
              boxShadow: analysisPaused ? 'none' : '0 0 8px #10b981',
              animation: analysisPaused ? 'none' : 'pulse 2s infinite'
            }} />
            <span style={{ color: '#94a3b8', fontSize: '11px', letterSpacing: '0.1em' }}>AI CO-PILOT</span>
            {isProcessing && <span style={{ color: '#10b981', fontSize: '9px', marginLeft: '4px', opacity: 0.8 }}>● SCANNING...</span>}
          </div>
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
            <button 
              onClick={() => setAudioEnabled(!audioEnabled)}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}
            >
              {audioEnabled ? '🔊' : '🔇'}
            </button>
            <button 
              onClick={() => setAnalysisPaused(!analysisPaused)}
              style={{ background: 'transparent', border: 'none', color: analysisPaused ? '#f87171' : '#94a3b8', cursor: 'pointer', fontSize: '12px' }}
            >
              {analysisPaused ? '▶️' : '⏸️'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {analysisPaused && (
        <div style={{ background: '#4c0f0f', color: '#f87171', fontSize: '10px', padding: '4px', textAlign: 'center', fontWeight: 'bold' }}>
          ANALYSIS PAUSED
        </div>
      )}

      {/* Alerts Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {alerts.length === 0 && (
          <div style={{ color: '#334155', textAlign: 'center', padding: '24px 0', fontSize: '11px' }}>
            No alerts — session looks clean
            <br />
            <span style={{ fontSize: '9px', opacity: 0.6 }}>AI monitoring active</span>
          </div>
        )}
        {alerts.map(alert => (
          <AlertBadge key={alert.id} alert={alert} onAcknowledge={acknowledgeAlert} onDismiss={dismissAlert} />
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
