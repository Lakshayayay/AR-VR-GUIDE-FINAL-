const SEVERITY_COLORS = {
  critical: { bg: '#1a0000', border: '#dc2626', text: '#f87171', badge: '#dc2626' },
  high:     { bg: '#1a0a00', border: '#d97706', text: '#fbbf24', badge: '#d97706' },
  medium:   { bg: '#0a1a0a', border: '#16a34a', text: '#4ade80', badge: '#16a34a' },
  low:      { bg: '#0a0a1a', border: '#2563eb', text: '#60a5fa', badge: '#2563eb' }
};

export default function AlertBadge({ alert, onAcknowledge, onDismiss }) {
  const colors = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.low;
  const time = new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{
      background: alert.acknowledged ? '#0f172a' : colors.bg,
      border: `1px solid ${alert.acknowledged ? '#1e293b' : colors.border}`,
      borderRadius: '6px',
      padding: '8px 10px',
      marginBottom: '6px',
      opacity: alert.acknowledged ? 0.5 : 1,
      transition: 'opacity 0.3s'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{
              background: colors.badge, color: 'white',
              fontSize: '9px', padding: '1px 5px', borderRadius: '3px', letterSpacing: '0.05em'
            }}>
              {alert.severity.toUpperCase()}
            </span>
            <span style={{ color: '#475569', fontSize: '10px' }}>{time}</span>
          </div>
          <div style={{ color: colors.text, fontSize: '12px', fontWeight: 600 }}>{alert.title}</div>
          <div style={{ color: '#64748b', fontSize: '11px', marginTop: '3px', lineHeight: 1.4 }}>{alert.description || alert.finding}</div>
          {alert.recommendation && (
            <div style={{ color: '#4ade80', fontSize: '11px', marginTop: '3px', lineHeight: 1.4 }}>💡 {alert.recommendation}</div>
          )}
          <div style={{ color: '#334155', fontSize: '10px', marginTop: '4px' }}>
            Confidence: {Math.round((alert.confidence || 0) * 100)}%
          </div>
        </div>
        {!alert.acknowledged && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '8px' }}>
            <button
              onClick={() => onAcknowledge(alert.id)}
              style={{
                background: 'transparent', border: '1px solid #334155',
                borderRadius: '4px', color: '#64748b', fontSize: '10px',
                padding: '3px 7px', cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              ✓ ACK
            </button>
            <button
              onClick={() => onDismiss && onDismiss(alert.id)}
              style={{
                background: 'transparent', border: '1px solid #334155',
                borderRadius: '4px', color: '#64748b', fontSize: '10px',
                padding: '3px 7px', cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              ✗ DISMISS
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
