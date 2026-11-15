import { useEffect, useState, useRef } from 'react';

// ── Fake seed messages shown on mount ─────────────────────────────────────────
const SEED_MESSAGES = [
  {
    id: 'seed-1', role: 'ai', severity: 'info',
    text: 'Session initialised. Visual feed acquired — running anomaly baseline.',
    time: '08:41:02', icon: '🛰️'
  },
  {
    id: 'seed-2', role: 'ai', severity: 'ok',
    text: 'SOP compliance check passed (Step 1–3). All parameters nominal.',
    time: '08:41:18', icon: '✅'
  },
  {
    id: 'seed-3', role: 'ai', severity: 'warning',
    text: 'Elevated thermal signature near component C7. Suggest visual inspection before proceeding.',
    time: '08:42:05', icon: '⚠️'
  },
  {
    id: 'seed-4', role: 'ai', severity: 'info',
    text: 'Gesture annotation detected. Syncing overlay to expert dashboard.',
    time: '08:42:44', icon: '✍️'
  },
];

const QUICK_REPLIES = [
  'Analyse frame now',
  'Run SOP check',
  'Flag anomaly',
  'Request sign-off',
];

const SEVERITY_STYLE = {
  critical: { border: '#ef4444', bg: 'rgba(239,68,68,0.08)', dot: '#ef4444', label: 'CRITICAL' },
  warning:  { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)', dot: '#f59e0b', label: 'WARNING'  },
  high:     { border: '#f97316', bg: 'rgba(249,115,22,0.08)', dot: '#f97316', label: 'HIGH'     },
  ok:       { border: '#10b981', bg: 'rgba(16,185,129,0.08)', dot: '#10b981', label: 'OK'       },
  info:     { border: '#185FA5', bg: 'rgba(24,95,165,0.08)',  dot: '#60a5fa', label: 'INFO'     },
};

function TypingIndicator() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'10px 14px',
      background:'rgba(255,255,255,0.03)', borderRadius:'14px 14px 14px 4px',
      border:'1px solid rgba(255,255,255,0.06)', width:'fit-content', marginBottom:'8px' }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width:'6px', height:'6px', borderRadius:'50%', background:'#185FA5',
          animation:'typing-dot 1.2s infinite ease-in-out',
          animationDelay:`${i*0.2}s`
        }} />
      ))}
    </div>
  );
}

function ChatBubble({ msg, isNew }) {
  const s = SEVERITY_STYLE[msg.severity] || SEVERITY_STYLE.info;
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display:'flex', flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems:'flex-end', gap:'8px', marginBottom:'10px',
      animation: isNew ? 'slide-in 0.3s ease' : 'none'
    }}>
      {!isUser && (
        <div style={{
          width:'28px', height:'28px', borderRadius:'50%', flexShrink:0,
          background:'linear-gradient(135deg,#185FA5,#0ea5e9)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:'12px', boxShadow:'0 0 12px rgba(24,95,165,0.5)'
        }}>🤖</div>
      )}
      <div style={{ maxWidth:'80%' }}>
        {!isUser && msg.severity !== 'info' && (
          <div style={{
            display:'inline-flex', alignItems:'center', gap:'4px',
            fontSize:'9px', fontWeight:700, letterSpacing:'0.1em',
            color: s.dot, marginBottom:'3px',
            padding:'1px 7px', borderRadius:'20px',
            background: s.bg, border:`1px solid ${s.border}44`
          }}>
            <div style={{ width:'5px', height:'5px', borderRadius:'50%',
              background:s.dot, boxShadow:`0 0 6px ${s.dot}` }} />
            {s.label}
          </div>
        )}
        <div style={{
          padding:'9px 13px',
          background: isUser
            ? 'linear-gradient(135deg,#185FA5,#1d4ed8)'
            : s.bg,
          border: `1px solid ${isUser ? 'transparent' : s.border+'44'}`,
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          color: isUser ? '#fff' : '#cbd5e1',
          fontSize:'12px', lineHeight:'1.55',
          boxShadow: isUser
            ? '0 4px 15px rgba(24,95,165,0.35)'
            : `0 2px 8px rgba(0,0,0,0.3)`,
        }}>
          {!isUser && msg.icon && <span style={{ marginRight:'6px' }}>{msg.icon}</span>}
          {msg.text}
        </div>
        <div style={{
          fontSize:'9px', color:'#475569', marginTop:'3px',
          textAlign: isUser ? 'right' : 'left', fontFamily:'monospace'
        }}>{msg.time}</div>
      </div>
    </div>
  );
}

function NotificationToast({ msg, onDismiss }) {
  const s = SEVERITY_STYLE[msg.severity] || SEVERITY_STYLE.info;
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position:'absolute', top:'12px', left:'50%', transform:'translateX(-50%)',
      zIndex:100, width:'88%',
      background:`linear-gradient(135deg,#0f172a,#1e293b)`,
      border:`1px solid ${s.border}`,
      borderRadius:'10px', padding:'10px 14px',
      boxShadow:`0 0 20px ${s.border}44`,
      display:'flex', alignItems:'center', gap:'10px',
      animation:'toast-in 0.35s ease'
    }}>
      <div style={{ width:'8px', height:'8px', borderRadius:'50%',
        background:s.dot, boxShadow:`0 0 10px ${s.dot}`, flexShrink:0 }} />
      <div style={{ flex:1, fontSize:'11px', color:'#e2e8f0' }}>{msg.text}</div>
      <button onClick={onDismiss} style={{
        background:'none', border:'none', color:'#475569',
        cursor:'pointer', fontSize:'14px', lineHeight:1
      }}>×</button>
    </div>
  );
}

export default function AICopilotPanel({ socket, sessionId }) {
  const [messages, setMessages] = useState(SEED_MESSAGES);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [toast, setToast] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [analysisPaused, setAnalysisPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [sopSteps, setSopSteps] = useState([]);
  const [signOffResult, setSignOffResult] = useState(null);
  const [isRequestingSignOff, setIsRequestingSignOff] = useState(false);
  const [newIds, setNewIds] = useState(new Set());
  const analysisPausedRef = useRef(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { analysisPausedRef.current = analysisPaused; }, [analysisPaused]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages, isTyping]);

  // ── Backend socket handlers (preserved) ────────────────────────────────────
  useEffect(() => {
    if (!socket || !sessionId) return;
    const handleAlert = (alert) => {
      if (analysisPausedRef.current) return;
      setIsProcessing(true);
      setTimeout(() => setIsProcessing(false), 800);
      const norm = { ...alert, severity: (alert.severity || 'low').toLowerCase() };
      setAlerts(prev => [norm, ...prev].slice(0, 50));
      // Surface as a chat bubble + toast
      const msg = {
        id: norm.id || `alert-${Date.now()}`,
        role:'ai', severity: norm.severity,
        text: norm.message || norm.text || 'Anomaly detected.',
        time: new Date().toLocaleTimeString('en-GB'),
        icon: norm.severity === 'critical' ? '🚨' : norm.severity === 'high' ? '⚠️' : '🔍'
      };
      setMessages(prev => [...prev, msg]);
      setNewIds(prev => new Set([...prev, msg.id]));
      if (['high','critical'].includes(norm.severity)) setToast(msg);
    };
    const handleSOPUpdate = (update) => {
      setSopSteps(prev => {
        const idx = prev.findIndex(s => s.stepNumber === update.stepNumber);
        if (idx >= 0) { const u=[...prev]; u[idx]=update; return u; }
        return [...prev, update];
      });
      const msg = {
        id:`sop-${Date.now()}`, role:'ai', severity:'ok',
        text:`SOP Step ${update.stepNumber}: ${update.status} (confidence ${Math.round((update.confidence||0)*100)}%)`,
        time: new Date().toLocaleTimeString('en-GB'), icon:'📋'
      };
      setMessages(prev => [...prev, msg]);
      setNewIds(prev => new Set([...prev, msg.id]));
    };
    const handleSignOff = (result) => {
      setSignOffResult(result);
      setIsRequestingSignOff(false);
      const msg = {
        id:`signoff-${Date.now()}`, role:'ai',
        severity: result.sign_off_recommended ? 'ok' : 'critical',
        text: result.sign_off_recommended
          ? `✅ Sign-off approved. ${result.summary||''}`
          : `❌ Sign-off blocked. ${result.summary||''}`,
        time: new Date().toLocaleTimeString('en-GB'), icon: result.sign_off_recommended ? '✅':'❌'
      };
      setMessages(prev => [...prev, msg]);
      setNewIds(prev => new Set([...prev, msg.id]));
    };
    socket.on('ai_alert', handleAlert);
    socket.on('ai-alert', handleAlert);
    socket.on('sop_step_update', handleSOPUpdate);
    socket.on('sign_off_result', handleSignOff);
    return () => {
      socket.off('ai_alert', handleAlert);
      socket.off('ai-alert', handleAlert);
      socket.off('sop_step_update', handleSOPUpdate);
      socket.off('sign_off_result', handleSignOff);
    };
  }, [socket, sessionId]);

  // ── Send a user message (UI only — no backend) ────────────────────────────
  const sendMessage = (text) => {
    if (!text.trim()) return;
    const userMsg = {
      id:`u-${Date.now()}`, role:'user', severity:'info',
      text: text.trim(), time: new Date().toLocaleTimeString('en-GB')
    };
    setMessages(prev => [...prev, userMsg]);
    setNewIds(prev => new Set([...prev, userMsg.id]));
    setInputVal('');
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      const replies = [
        'Analysing current frame… no critical anomalies detected.',
        'Running SOP compliance check against loaded procedure.',
        'Visual feed stable. Confidence score: 94%. All clear.',
        'Flagged region noted. Logging for session report.',
        'Sign-off criteria check in progress — please wait.',
      ];
      const aiMsg = {
        id:`a-${Date.now()}`, role:'ai', severity:'info',
        text: replies[Math.floor(Math.random()*replies.length)],
        time: new Date().toLocaleTimeString('en-GB'), icon:'🤖'
      };
      setMessages(prev => [...prev, aiMsg]);
      setNewIds(prev => new Set([...prev, aiMsg.id]));
    }, 1400 + Math.random()*600);
  };

  const requestSignOff = () => {
    setIsRequestingSignOff(true);
    setSignOffResult(null);
    socket?.emit('request_sign_off', { sessionId });
    sendMessage('Request AI sign-off for this session.');
  };

  const unacknowledgedCritical = alerts.filter(a => !a.acknowledged && a.severity==='critical').length;

  return (
    <div style={{
      width:'300px', background:'#080f1a',
      borderLeft:'1px solid rgba(255,255,255,0.06)',
      display:'flex', flexDirection:'column', height:'100%',
      fontFamily:'"Inter", "SF Pro Display", system-ui, sans-serif',
      flexShrink:0, position:'relative', overflow:'hidden'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes typing-dot {
          0%,80%,100%{transform:scale(0.6);opacity:0.4}
          40%{transform:scale(1);opacity:1}
        }
        @keyframes slide-in {
          from{opacity:0;transform:translateY(8px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes toast-in {
          from{opacity:0;transform:translateX(-50%) translateY(-6px)}
          to{opacity:1;transform:translateX(-50%) translateY(0)}
        }
        @keyframes glow-pulse {
          0%,100%{box-shadow:0 0 6px #185FA5}
          50%{box-shadow:0 0 18px #185FA5, 0 0 30px #0ea5e944}
        }
        @keyframes scan-line {
          0%{top:-2px} 100%{top:100%}
        }
        .ai-input:focus{outline:none;}
        .ai-input::placeholder{color:#334155;}
        .quick-btn:hover{background:rgba(24,95,165,0.2)!important;color:#93c5fd!important;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px;}
      `}</style>

      {/* Ambient scan line */}
      <div style={{
        position:'absolute', left:0, right:0, height:'1px',
        background:'linear-gradient(90deg,transparent,#185FA5,transparent)',
        animation:'scan-line 4s linear infinite', opacity:0.3, pointerEvents:'none', zIndex:50
      }} />

      {/* Toast notification */}
      {toast && <NotificationToast msg={toast} onDismiss={() => setToast(null)} />}

      {/* ── Header ── */}
      <div style={{
        padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)',
        background:'linear-gradient(180deg,rgba(24,95,165,0.08),transparent)'
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{
              width:'34px', height:'34px', borderRadius:'10px',
              background:'linear-gradient(135deg,#185FA5,#0ea5e9)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'16px', animation:'glow-pulse 3s ease-in-out infinite'
            }}>🤖</div>
            <div>
              <div style={{ color:'#e2e8f0', fontSize:'13px', fontWeight:600, letterSpacing:'0.02em' }}>
                AI Co-Pilot
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                <div style={{
                  width:'6px', height:'6px', borderRadius:'50%',
                  background: analysisPaused ? '#64748b' : '#10b981',
                  boxShadow: analysisPaused ? 'none' : '0 0 8px #10b981'
                }} />
                <span style={{ color:'#64748b', fontSize:'10px' }}>
                  {isProcessing ? 'Scanning…' : analysisPaused ? 'Paused' : 'Monitoring'}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
            {unacknowledgedCritical > 0 && (
              <div style={{
                background:'linear-gradient(135deg,#dc2626,#b91c1c)',
                color:'white', borderRadius:'20px', fontSize:'9px',
                fontWeight:700, padding:'2px 8px',
                boxShadow:'0 0 12px rgba(220,38,38,0.5)'
              }}>{unacknowledgedCritical} CRITICAL</div>
            )}
            <button onClick={() => setAudioEnabled(!audioEnabled)} style={{
              width:'28px', height:'28px', borderRadius:'8px',
              background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)',
              color:'#64748b', cursor:'pointer', fontSize:'12px',
              display:'flex', alignItems:'center', justifyContent:'center'
            }}>{audioEnabled ? '🔊' : '🔇'}</button>
            <button onClick={() => setAnalysisPaused(!analysisPaused)} style={{
              width:'28px', height:'28px', borderRadius:'8px',
              background: analysisPaused ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
              border:`1px solid ${analysisPaused ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.07)'}`,
              color: analysisPaused ? '#f87171' : '#64748b', cursor:'pointer', fontSize:'12px',
              display:'flex', alignItems:'center', justifyContent:'center'
            }}>{analysisPaused ? '▶' : '⏸'}</button>
          </div>
        </div>
      </div>

      {analysisPaused && (
        <div style={{
          background:'linear-gradient(90deg,rgba(239,68,68,0.12),rgba(239,68,68,0.06))',
          borderBottom:'1px solid rgba(239,68,68,0.25)',
          color:'#f87171', fontSize:'10px', fontWeight:700,
          padding:'5px 16px', letterSpacing:'0.1em', textAlign:'center'
        }}>⏸ ANALYSIS PAUSED</div>
      )}

      {/* ── Chat feed ── */}
      <div style={{
        flex:1, overflowY:'auto', padding:'14px 12px',
        display:'flex', flexDirection:'column'
      }}>
        {messages.map(msg => (
          <ChatBubble key={msg.id} msg={msg} isNew={newIds.has(msg.id)} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* ── Quick replies ── */}
      <div style={{ padding:'6px 12px', display:'flex', gap:'5px', flexWrap:'wrap' }}>
        {QUICK_REPLIES.map(r => (
          <button key={r} className="quick-btn" onClick={() => sendMessage(r)} style={{
            background:'rgba(255,255,255,0.03)',
            border:'1px solid rgba(255,255,255,0.08)',
            borderRadius:'20px', color:'#64748b',
            fontSize:'10px', padding:'4px 10px',
            cursor:'pointer', transition:'all 0.2s', fontFamily:'inherit'
          }}>{r}</button>
        ))}
      </div>

      {/* ── Input bar ── */}
      <div style={{
        padding:'10px 12px',
        borderTop:'1px solid rgba(255,255,255,0.06)',
        background:'rgba(255,255,255,0.01)'
      }}>
        <div style={{
          display:'flex', alignItems:'center', gap:'8px',
          background:'rgba(255,255,255,0.04)',
          border:'1px solid rgba(255,255,255,0.09)',
          borderRadius:'12px', padding:'8px 12px',
          transition:'border-color 0.2s'
        }}>
          <span style={{ fontSize:'14px', opacity:0.5 }}>💬</span>
          <input
            ref={inputRef}
            className="ai-input"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key==='Enter' && sendMessage(inputVal)}
            placeholder="Ask AI Co-Pilot…"
            style={{
              flex:1, background:'transparent', border:'none',
              color:'#cbd5e1', fontSize:'12px', fontFamily:'inherit'
            }}
          />
          <button onClick={() => sendMessage(inputVal)} style={{
            width:'26px', height:'26px', borderRadius:'8px',
            background: inputVal.trim() ? 'linear-gradient(135deg,#185FA5,#0ea5e9)' : 'transparent',
            border:'none', cursor:'pointer', display:'flex',
            alignItems:'center', justifyContent:'center',
            transition:'all 0.2s', fontSize:'12px', color:'white'
          }}>↑</button>
        </div>
      </div>

      {/* ── Sign-off button ── */}
      <div style={{ padding:'0 12px 12px' }}>
        <button onClick={requestSignOff} disabled={isRequestingSignOff} style={{
          width:'100%', padding:'9px',
          background: isRequestingSignOff
            ? 'rgba(255,255,255,0.03)'
            : 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.08))',
          border:`1px solid ${isRequestingSignOff ? 'rgba(255,255,255,0.06)' : '#10b98155'}`,
          borderRadius:'10px',
          color: isRequestingSignOff ? '#475569' : '#34d399',
          fontSize:'11px', fontWeight:600, cursor: isRequestingSignOff ? 'not-allowed' : 'pointer',
          letterSpacing:'0.06em', transition:'all 0.2s', fontFamily:'inherit',
          boxShadow: isRequestingSignOff ? 'none' : '0 0 15px rgba(16,185,129,0.12)'
        }}>
          {isRequestingSignOff ? '⏳ VALIDATING…' : '▶ REQUEST AI SIGN-OFF'}
        </button>
        {signOffResult && (
          <div style={{
            marginTop:'8px', padding:'10px 12px', borderRadius:'10px',
            background: signOffResult.sign_off_recommended
              ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border:`1px solid ${signOffResult.sign_off_recommended ? '#10b98144' : '#ef444444'}`
          }}>
            <div style={{
              color: signOffResult.sign_off_recommended ? '#34d399' : '#f87171',
              fontWeight:700, fontSize:'11px', marginBottom:'4px'
            }}>
              {signOffResult.sign_off_recommended ? '✓ SIGN-OFF APPROVED' : '✗ SIGN-OFF BLOCKED'}
            </div>
            <div style={{ color:'#94a3b8', fontSize:'11px' }}>{signOffResult.summary}</div>
            {signOffResult.blockers?.map((b,i) => (
              <div key={i} style={{ color:'#f87171', fontSize:'10px', marginTop:'3px' }}>• {b}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
