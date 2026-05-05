import { useEffect, useState } from 'react';

export default function AIWarningBanner({ socket }) {
  const [activeAlert, setActiveAlert] = useState(null);
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const handleAlert = (alert) => {
      if (alert.severity !== 'high' && alert.severity !== 'critical') return;
      setQueue(prev => [...prev, alert]);
    };

    socket.on('ai_alert', handleAlert);
    return () => socket.off('ai_alert', handleAlert);
  }, [socket]);

  useEffect(() => {
    if (queue.length === 0 || activeAlert) return;
    const next = queue[0];
    setActiveAlert(next);
    setQueue(prev => prev.slice(1));
    const timer = setTimeout(() => setActiveAlert(null), 6000);
    return () => clearTimeout(timer);
  }, [queue, activeAlert]);

  if (!activeAlert) return null;

  const isCritical = activeAlert.severity === 'critical';

  return (
    <div style={{
      position: 'absolute',
      top: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 100,
      background: isCritical ? 'rgba(220, 38, 38, 0.92)' : 'rgba(217, 119, 6, 0.92)',
      border: `1px solid ${isCritical ? '#ef4444' : '#f59e0b'}`,
      borderRadius: '8px',
      padding: '10px 18px',
      maxWidth: '320px',
      backdropFilter: 'blur(8px)',
      animation: 'aiSlideDown 0.3s ease-out'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>{isCritical ? '🔴' : '⚠️'}</span>
        <div>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '12px', letterSpacing: '0.08em' }}>
            AI ALERT
          </div>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: '13px', marginTop: '2px' }}>
            {activeAlert.title}
          </div>
        </div>
      </div>
      <div style={{ height: '2px', background: 'rgba(255,255,255,0.3)', marginTop: '8px', borderRadius: '1px' }}>
        <div style={{
          height: '100%',
          background: 'white',
          borderRadius: '1px',
          animation: 'aiShrink 6s linear forwards'
        }} />
      </div>
    </div>
  );
}
