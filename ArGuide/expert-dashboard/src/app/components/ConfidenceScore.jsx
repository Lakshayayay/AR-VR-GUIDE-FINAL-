export default function ConfidenceScore({ step }) {
  const pct = Math.round((step.confidence || 0) * 100);
  const color = pct >= 80 ? '#4ade80' : pct >= 60 ? '#fbbf24' : '#f87171';

  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ color: '#64748b', fontSize: '10px' }}>Step {step.stepNumber}</span>
        <span style={{ color, fontSize: '10px', fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: '3px', background: '#1e293b', borderRadius: '2px' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '2px', transition: 'width 0.3s' }} />
      </div>
      {step.recommendation && (
        <div style={{ color: '#475569', fontSize: '10px', marginTop: '3px' }}>{step.recommendation}</div>
      )}
    </div>
  );
}
