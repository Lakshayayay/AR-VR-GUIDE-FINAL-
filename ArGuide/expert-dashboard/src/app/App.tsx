import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import * as THREE from 'three';
import { Video } from 'lucide-react';
import AICopilotPanel from './components/AICopilotPanel';

const SESSION_ID = 'HAL-123';
const SERVER_URL = 'https://ar-vr-guide-final.onrender.com';

export default function App() {
  const [activeTab, setActiveTab] = useState('history'); // Default to history
  const [selectedSession, setSelectedSession] = useState('SES-20240418-001');
  const [sessionHistory, setSessionHistory] = useState([
    { id: 'SES-20240418-001', tech: 'Rajesh Kumar', location: 'Assembly Bay 3', expert: 'Dr. Mehta', date: '2026-04-18', duration: '14:23', annotations: 37, status: 'completed' }
  ]);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const socketRef = useRef<any>(null);

  // Initialize socket at the App level to listen for calls globally
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Expert connected to server');
      // Join a generic expert room to receive calls
      socket.emit('join-session', 'expert-room');
    });

    socket.on('call-expert', (data: any) => {
      console.log('Incoming call from:', data.techName);
      setIncomingCall(data);
      // Play a ringing sound
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(() => {
          // Fallback beep
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.5);
        });
      } catch(e) {}
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleAcceptCall = () => {
    setCallAccepted(true);
    setActiveTab('live');
    if (socketRef.current && incomingCall) {
      socketRef.current.emit('call-accepted', { 
        sessionId: incomingCall.sessionId,
        expertSocketId: socketRef.current.id 
      });
      // The session ID might be dynamic now based on the call
      setSelectedSession(incomingCall.sessionId || 'HAL-123');
    }
  };

  const handleEndCall = (duration: string) => {
    if (incomingCall) {
      setSessionHistory(prev => [{
        id: incomingCall.sessionId || `SES-${Date.now()}`,
        tech: incomingCall.techName || 'Unknown Tech',
        location: 'Field Site',
        expert: 'You',
        date: new Date().toISOString().split('T')[0],
        duration: duration,
        annotations: Math.floor(Math.random() * 20) + 5,
        status: 'completed'
      }, ...prev]);
    }
    setCallAccepted(false);
    setIncomingCall(null);
    setActiveTab('history');
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground" style={{
      '--hal-blue': '#185FA5',
      '--video-bg': '#0d1621',
      '--status-online': '#10b981',
      '--status-idle': '#f59e0b',
      '--status-recording': '#ef4444',
      '--annotation-red': '#ef4444',
      '--annotation-amber': '#f59e0b',
      '--annotation-teal': '#14b8a6',
      '--annotation-white': '#ffffff',
      '--detection-teal': '#5eead4'
    } as React.CSSProperties}>

      {/* Incoming Call Notification */}
      {incomingCall && !callAccepted && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] bg-[#111] border-2 border-[var(--hal-blue)] rounded-2xl p-6 shadow-2xl flex items-center gap-6 animate-bounce">
          <div className="w-12 h-12 bg-[var(--hal-blue)] rounded-full flex items-center justify-center animate-pulse">
            <Video className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-lg">Incoming Session Call</div>
            <div className="text-white/60 text-sm">{incomingCall.techName} is requesting assistance</div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                setIncomingCall(null);
                socketRef.current?.emit('call-rejected', { to: incomingCall.from });
              }}
              className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
            >
              Ignore
            </button>
            <button 
              onClick={handleAcceptCall}
              className="px-6 py-2 bg-[var(--hal-blue)] text-white font-bold rounded-lg hover:opacity-90 transition-opacity"
            >
              Accept & Join
            </button>
          </div>
        </div>
      )}

      {/* Top Nav Bar */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 bg-[var(--hal-blue)] text-white rounded-full text-xs font-medium">
            HAL
          </div>
          <div>
            <div className="font-medium">ArGuide</div>
            <div className="text-xs text-muted-foreground">192.168.1.100:8080</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--status-online)]"></div>
            <span className="text-sm">Server Online</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-[var(--hal-blue)] text-white flex items-center justify-center text-xs font-medium">
            RK
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-6">
        {['Live Session', 'Session History', 'Analytics', 'Settings'].map((tab, idx) => {
          const tabId = ['live', 'history', 'analytics', 'settings'][idx];
          const isActive = activeTab === tabId;
          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={`h-full px-1 border-b-2 transition-colors ${
                isActive
                  ? 'border-[var(--hal-blue)] text-[var(--hal-blue)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <div style={{ display: activeTab === 'live' ? 'flex' : 'none', width: '100%', height: '100%' }}>
          <LiveSession 
            selectedSession={selectedSession} 
            setSelectedSession={setSelectedSession} 
            globalSocket={socketRef.current}
            onEndCall={handleEndCall}
          />
        </div>
        {activeTab === 'history' && <SessionHistory sessions={sessionHistory} />}
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'settings' && <Settings />}
      </div>

      {/* Bottom Status Bar */}
      <div className="h-7 border-t border-border flex items-center px-4 gap-6 text-xs bg-muted/30">
        <span className="font-mono">Server: 192.168.1.100:8080</span>
        <span>Active Sessions: 3</span>
        <span>Bandwidth: 4.2 Mbps</span>
        <span>CPU: 24%</span>
        <span>RAM: 3.8 GB</span>
        <span>Storage: 142 GB free</span>
      </div>
    </div>
  );
}

function LiveSession({ selectedSession, setSelectedSession, globalSocket, onEndCall }: {
  selectedSession: string;
  setSelectedSession: (id: string) => void;
  globalSocket: any;
  onEndCall: (duration: string) => void;
}) {
  const [activeTool, setActiveTool] = useState('arrow');
  const [activeColor, setActiveColor] = useState('red');
  const [isRecording, setIsRecording] = useState(true);
  const [showDetection, setShowDetection] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [volume, setVolume] = useState(75);
  const [isLaserOn, setIsLaserOn] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const streamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const isDrawing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const lastPos = useRef({ x: 0, y: 0 });

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const annotationGroupRef = useRef<THREE.Group | null>(null);
  
  const trackerStateRef = useRef({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    active: false
  });

  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!globalSocket) return;
    
    const socket = globalSocket;
    socketRef.current = socket;
    setSocket(socket);

    setConnectionStatus('Server Connected. Waiting for Technician stream...');
    socket.emit('join-session', selectedSession);
    
    // Capture local audio to send to technician
    streamPromiseRef.current = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      console.log('Expert mic captured');
      localStreamRef.current = stream;
      return stream;
    }).catch(err => {
      console.error('Mic access denied:', err);
      throw err;
    });

    const handleClearAnnotations = () => {
      console.log('Expert received clear command');
      if (previewCanvasRef.current) {
        const pCtx = previewCanvasRef.current.getContext('2d');
        pCtx?.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
      }
      if (annotationGroupRef.current) {
        const toRemove: THREE.Object3D[] = [];
        annotationGroupRef.current.children.forEach(c => {
           if ((c as any).userData.isAnnotation) toRemove.push(c);
        });
        toRemove.forEach(c => {
           annotationGroupRef.current?.remove(c);
           if ((c as any).geometry) (c as any).geometry.dispose();
           if ((c as any).material) (c as any).material.dispose();
        });
        annotationGroupRef.current.position.set(0, 0, 0);
      }
      trackerStateRef.current.active = false;
    };

    const handleAnnotation = (data: any) => {
      console.log('Expert received annotation from technician:', data.tool);
      if (previewCanvasRef.current) {
        const pCtx = previewCanvasRef.current.getContext('2d');
        if (!pCtx) return;

        pCtx.strokeStyle = data.color || '#00ff00';
        pCtx.lineWidth = 3;
        pCtx.lineCap = 'round';
        pCtx.lineJoin = 'round';

        if (data.tool === 'freehand' || data.tool === 'line') {
          pCtx.beginPath();
          pCtx.moveTo(data.x1, data.y1);
          pCtx.lineTo(data.x2, data.y2);
          pCtx.stroke();
        } else {
           pCtx.beginPath();
           pCtx.moveTo(data.x1, data.y1);
           pCtx.lineTo(data.x2, data.y2);
           pCtx.stroke();
        }
      }
    };

    const handleTrackingUpdate = (data: any) => {
      if (!annotationGroupRef.current || !cameraRef.current) return;
      const vFov = THREE.MathUtils.degToRad(cameraRef.current.fov);
      const planeHeight = 2 * Math.tan(vFov / 2) * cameraRef.current.position.z;
      const planeWidth = planeHeight * (16 / 9);

      annotationGroupRef.current.position.x = (data.dx / 400) * planeWidth;
      annotationGroupRef.current.position.y = -(data.dy / 225) * planeHeight;
    };

    const handleUserJoined = (userId: string) => {
      setConnectionStatus('Technician joined. Requesting stream...');
      socket.emit('signal', { to: userId, signal: { type: 'request-offer' } });
    };

    const handleSignal = async (data: any) => {
      let peer = peerRef.current;
      if (!peer) {
        setConnectionStatus('Negotiating WebRTC stream...');
        peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peerRef.current = peer;

        if (localStreamRef.current) {
          console.log('Adding expert tracks to peer');
          localStreamRef.current.getTracks().forEach(track => {
            peer.addTrack(track, localStreamRef.current);
          });
        } else {
          console.warn('Expert mic not ready yet. Proceeding with video only.');
        }

        peer.onicecandidate = e => {
          if (e.candidate) socket.emit('signal', { to: data.from, signal: { type: 'candidate', candidate: e.candidate } });
        };

        peer.onconnectionstatechange = () => {
          setConnectionStatus('Stream: ' + peer.connectionState);
        };

        peer.ontrack = e => {
          console.log('Expert received remote track:', e.track.kind);
          setConnectionStatus('Live Stream Active!');
          if (videoRef.current) {
            videoRef.current.srcObject = e.streams[0];
            videoRef.current.muted = !speakerEnabled;
            videoRef.current.play().catch(err => console.error('Play error:', err));
          }
        };
      }

      const sig = data.signal;
      if (sig.type === 'offer') {
        await peer.setRemoteDescription(new RTCSessionDescription(sig));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('signal', { to: data.from, signal: { type: 'answer', sdp: answer.sdp } });
      } else if (sig.type === 'candidate') {
        await peer.addIceCandidate(new RTCIceCandidate(sig.candidate));
      }
    };

    socket.on('clear-annotations', handleClearAnnotations);
    socket.on('annotation', handleAnnotation);
    socket.on('tracking_update', handleTrackingUpdate);
    socket.on('user-joined', handleUserJoined);
    socket.on('signal', handleSignal);

    return () => {
      socket.off('clear-annotations', handleClearAnnotations);
      socket.off('annotation', handleAnnotation);
      socket.off('tracking_update', handleTrackingUpdate);
      socket.off('user-joined', handleUserJoined);
      socket.off('signal', handleSignal);
      if (peerRef.current) peerRef.current.close();
      if (localStreamRef.current) {
         localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [globalSocket, selectedSession, speakerEnabled]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Initialize Three.js Scene (Mirroring Technician)
  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(85, 1280 / 720, 0.1, 1000);
    camera.position.z = 5;

    const annotationGroup = new THREE.Group();
    scene.add(annotationGroup);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    annotationGroupRef.current = annotationGroup;

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!canvasRef.current) return;
      const parent = canvasRef.current.parentElement;
      if (parent) {
        const width = parent.clientWidth;
        const height = parent.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  const getHexColor = (colorName: any) => {
      const map = { 'red': '#ef4444', 'amber': '#f59e0b', 'teal': '#14b8a6', 'blue': '#185FA5', 'white': '#ffffff' };
      return map[colorName] || '#ef4444';
  };

  const getCanvasPos = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: any) => {
    isDrawing.current = true;
    const pos = getCanvasPos(e);
    startPos.current = pos;
    lastPos.current = pos;
    
    // Set active flag for tracking sync
    trackerStateRef.current.active = true;
  };

  const drawShape = (ctx: any, tool: string, x1: number, y1: number, x2: number, y2: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    if (tool === 'rectangle') {
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === 'circle') {
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      ctx.beginPath();
      ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (tool === 'arrow') {
      const headlen = 20;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  };

  const draw = (e: any) => {
    if (isLaserOn && socketRef.current) {
        const pos = getCanvasPos(e);
        socketRef.current.emit('laser_update', {
            sessionId: SESSION_ID,
            x: pos.x,
            y: pos.y,
            canvasW: canvasRef.current.width,
            canvasH: canvasRef.current.height
        });
    }

    if (!isDrawing.current) return;
    const newPos = getCanvasPos(e);
    const hex = getHexColor(activeColor);
    const isGeometric = ['rectangle', 'circle', 'arrow'].includes(activeTool);

    if (isGeometric) {
      if (!previewCanvasRef.current) return;
      const pCtx = previewCanvasRef.current.getContext('2d');
      pCtx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
      drawShape(pCtx, activeTool, startPos.current.x, startPos.current.y, newPos.x, newPos.y, hex);
    } else {
      // Freehand or Line
      if (socketRef.current) {
        socketRef.current.emit('annotation', {
          sessionId: SESSION_ID,
          tool: activeTool,
          x1: lastPos.current.x,
          y1: lastPos.current.y,
          x2: newPos.x,
          y2: newPos.y,
          color: hex,
          canvasW: canvasRef.current.width,
          canvasH: canvasRef.current.height
        });
      }

      // Draw on preview canvas (never on the WebGL canvas)
      if (previewCanvasRef.current) {
        const pCtx = previewCanvasRef.current.getContext('2d');
        pCtx.beginPath();
        pCtx.moveTo(lastPos.current.x, lastPos.current.y);
        pCtx.lineTo(newPos.x, newPos.y);
        pCtx.strokeStyle = hex;
        pCtx.lineWidth = 5;
        pCtx.lineCap = 'round';
        pCtx.stroke();
      }
      lastPos.current = newPos;
    }
  };

  const stopDrawing = (e: any) => {
    if (!isDrawing.current) return;
    const endPos = getCanvasPos(e);
    const hex = getHexColor(activeColor);
    const isGeometric = ['rectangle', 'circle', 'arrow', 'freehand', 'line'].includes(activeTool);

    if (isGeometric && sceneRef.current && cameraRef.current && annotationGroupRef.current) {
      const data = {
        tool: activeTool,
        x1: startPos.current.x,
        y1: startPos.current.y,
        x2: endPos.x,
        y2: endPos.y,
        color: hex,
        canvasW: canvasRef.current.width,
        canvasH: canvasRef.current.height
      };

      // 3D Mesh Generation (Mirroring Technician)
      const nx1 = (data.x1 / data.canvasW) * 2 - 1;
      const ny1 = -(data.y1 / data.canvasH) * 2 + 1;
      const nx2 = (data.x2 / data.canvasW) * 2 - 1;
      const ny2 = -(data.y2 / data.canvasH) * 2 + 1;

      const vec1 = new THREE.Vector3(nx1, ny1, 0.5).unproject(cameraRef.current);
      const vec2 = new THREE.Vector3(nx2, ny2, 0.5).unproject(cameraRef.current);
      const material = new THREE.MeshBasicMaterial({ color: hex });
      let mesh: THREE.Object3D;

      if (data.tool === 'rectangle') {
        const group = new THREE.Group();
        const p1 = vec1.clone();
        const p2 = new THREE.Vector3(vec2.x, vec1.y, vec1.z);
        const p3 = vec2.clone();
        const p4 = new THREE.Vector3(vec1.x, vec2.y, vec1.z);
        [[p1, p2], [p2, p3], [p3, p4], [p4, p1]].forEach(([v1, v2]) => {
          const path = new THREE.LineCurve3(v1, v2);
          group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 1, 0.005, 8, false), material));
        });
        mesh = group;
      } else if (data.tool === 'circle') {
        const radius = vec1.distanceTo(vec2);
        mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.005, 8, 50), material);
        mesh.position.copy(vec1);
        mesh.lookAt(cameraRef.current.position);
      } else if (data.tool === 'arrow') {
        const group = new THREE.Group();
        group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(vec1, vec2), 1, 0.005, 8, false), material));
        const dir = new THREE.Vector3().subVectors(vec2, vec1).normalize();
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 8), material);
        head.position.copy(vec2);
        head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        group.add(head);
        mesh = group;
      } else {
        mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(vec1, vec2), 20, 0.005, 8, false), material);
      }

      (mesh as any).userData.isAnnotation = true;
      // Offset mesh by current group position to place it accurately in world space
      mesh.position.x -= annotationGroupRef.current.position.x;
      mesh.position.y -= annotationGroupRef.current.position.y;
      annotationGroupRef.current.add(mesh);

      // Clear preview
      if (previewCanvasRef.current) {
        const pCtx = previewCanvasRef.current.getContext('2d');
        pCtx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
      }

      // Emit annotation (freehand/line already emitted during drawing)
      if (['rectangle', 'circle', 'arrow'].includes(activeTool) && socketRef.current) {
        socketRef.current.emit('annotation', {
          sessionId: SESSION_ID,
          ...data
        });
      }
    }

    isDrawing.current = false;
  };

  const toggleFreeze = () => {
    const newState = !isFrozen;
    setIsFrozen(newState);
    if (videoRef.current) {
        if (newState) videoRef.current.pause();
        else videoRef.current.play();
    }
    if (socketRef.current) {
        socketRef.current.emit('freeze_session', { sessionId: SESSION_ID, frozen: newState });
    }
  };

  const toggleMic = () => {
    const newState = !micEnabled;
    setMicEnabled(newState);
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = newState;
    }
  };

  const toggleSpeaker = () => {
    const newState = !speakerEnabled;
    setSpeakerEnabled(newState);
    if (videoRef.current) {
      videoRef.current.muted = !newState;
    }
  };

  const clearAnnotations = () => {
     if (annotationGroupRef.current) {
        const toRemove: THREE.Object3D[] = [];
        annotationGroupRef.current.children.forEach(c => {
           if ((c as any).userData.isAnnotation) toRemove.push(c);
        });
        toRemove.forEach(c => {
           annotationGroupRef.current?.remove(c);
           if ((c as any).geometry) (c as any).geometry.dispose();
           if ((c as any).material) (c as any).material.dispose();
        });
        annotationGroupRef.current.position.set(0, 0, 0);
     }
     trackerStateRef.current.active = false;
     if(socketRef.current) socketRef.current.emit('clear-annotations', { sessionId: SESSION_ID });
  };

  return (
    <>
      {/* Left Sidebar */}
      <div className="w-52 border-r border-border flex flex-col bg-sidebar relative">
        <div className="absolute inset-0 bg-[#5DCAA5]/5 animate-pulse" />
        <div className="p-4 border-b border-sidebar-border relative z-10">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-[var(--status-online)] animate-ping" />
             Active Session
          </div>
          <div className="space-y-2">
              <div className="w-full p-3 rounded border border-[var(--hal-blue)] border-l-2 bg-accent text-left transition-colors">
                <div className="font-mono text-xs text-[var(--hal-blue)]">{selectedSession}</div>
                <div className="text-sm mt-1 text-white">Technician Connected</div>
                <div className="text-xs text-muted-foreground mt-0.5">Live Remote Support</div>
                <div className="mt-4 flex flex-col gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-[var(--status-online)]/10 text-[var(--status-online)] font-mono border border-[var(--status-online)]/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-online)] shadow-[0_0_8px_var(--status-online)]" />
                      Streaming...
                    </span>
                    <button 
                      onClick={() => onEndCall(formatTime(sessionTime))}
                      className="w-full py-2 bg-red-600/90 hover:bg-red-500 text-white rounded font-bold transition-all shadow-lg flex items-center justify-center gap-2 mt-4"
                    >
                      End Call
                    </button>
                </div>
              </div>
          </div>
        </div>

        <div className="p-4 flex-1 relative z-10 opacity-50">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Queued</div>
          <div className="space-y-2 text-center py-4 text-xs text-muted-foreground">
             No pending calls.
          </div>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <button className="w-full px-4 py-2 bg-[var(--hal-blue)] text-white rounded hover:opacity-90 transition-opacity">
            New Session
          </button>
        </div>
      </div>

      {/* Center Video Feed */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex-1 rounded overflow-hidden relative" style={{ backgroundColor: 'var(--video-bg)' }}>
            <div className="w-full h-full relative">
              <video 
                ref={videoRef}
                autoPlay playsInline
                className="absolute inset-0 w-full h-full object-contain"
              />
              <canvas
                ref={canvasRef}
                width={1280}
                height={720}
                className="absolute inset-0 w-full h-full z-10"
              />
              <canvas
                ref={previewCanvasRef}
                width={1280}
                height={720}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseOut={stopDrawing}
                className="absolute inset-0 w-full h-full z-20"
                style={{ 
                  cursor: activeTool === 'arrow' ? 'default' : 'crosshair', 
                  pointerEvents: isLaserOn ? 'auto' : (activeTool === 'arrow' ? 'none' : 'auto')
                }}
              />

              {/* HUD Overlays */}
              {/* Top-left HUD */}
              <div className="absolute top-4 left-4 space-y-1 font-mono text-xs">
                <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-[var(--status-recording)]/20 border border-[var(--status-recording)]/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-recording)] animate-pulse"></span>
                  <span className="text-[var(--status-recording)]">LIVE</span>
                </div>
                <div className="text-white/80">SES-20240418-001</div>
                <div className="text-white/60">Rajesh Kumar</div>
                <div className="text-[var(--annotation-teal)] z-20 pointer-events-none relative">{connectionStatus}</div>
              </div>

              {/* Top-right HUD */}
              <div className="absolute top-4 right-4 font-mono text-xs text-white/60 text-right space-y-1">
                <div>1920x1080</div>
                <div>2.4 Mbps</div>
                <div>30 FPS</div>
              </div>

              {/* Bottom-left HUD */}
              <div className="absolute bottom-4 left-4 font-mono text-xs text-white/80">
                Rajesh Kumar · Assembly Bay 3
              </div>

              {/* Bottom-right HUD - Session timer */}
              <div className="absolute bottom-4 right-4 font-mono text-sm text-[var(--status-recording)] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--status-recording)] animate-pulse"></span>
                {formatTime(sessionTime)}
              </div>
            </div>
          </div>
        </div>

        {/* Annotation Toolbar */}
        <div className="border-t border-border px-4 py-3 flex items-center gap-3">
          {/* Tool buttons */}
          <div className="flex items-center gap-1 border-r border-border pr-3">
            {[
              { id: 'arrow', label: 'Arrow', icon: '↗' },
              { id: 'circle', label: 'Circle', icon: '○' },
              { id: 'rectangle', label: 'Rectangle', icon: '▭' },
              { id: 'freehand', label: 'Freehand', icon: '✎' },
              { id: 'text', label: 'Text', icon: 'T' }
            ].map(tool => (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={`w-9 h-9 rounded flex items-center justify-center transition-colors ${
                  activeTool === tool.id
                    ? 'bg-[var(--hal-blue)]/20 text-[var(--hal-blue)] border border-[var(--hal-blue)]'
                    : 'hover:bg-accent text-muted-foreground'
                }`}
                title={tool.label}
              >
                {tool.icon}
              </button>
            ))}
          </div>

          {/* Color swatches */}
          <div className="flex items-center gap-1 border-r border-border pr-3">
            {[
              { id: 'red', color: 'var(--annotation-red)' },
              { id: 'amber', color: 'var(--annotation-amber)' },
              { id: 'teal', color: 'var(--annotation-teal)' },
              { id: 'blue', color: 'var(--hal-blue)' },
              { id: 'white', color: 'var(--annotation-white)' }
            ].map(swatch => (
              <button
                key={swatch.id}
                onClick={() => setActiveColor(swatch.id)}
                className={`w-7 h-7 rounded border-2 transition-all ${
                  activeColor === swatch.id ? 'border-foreground scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: swatch.color }}
              ></button>
            ))}
          </div>

          {/* Utility buttons */}
          <div className="flex items-center gap-1 flex-1">
            <button 
              onClick={toggleFreeze}
              className={`px-3 h-9 rounded border transition-colors text-sm ${
                isFrozen ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'border-border hover:bg-accent'
              }`}
            >
              {isFrozen ? 'Resume' : 'Freeze Frame'}
            </button>
            <button 
              onClick={() => setIsLaserOn(!isLaserOn)}
              className={`px-3 h-9 rounded border transition-colors text-sm ${
                isLaserOn ? 'bg-teal-500/20 border-teal-500 text-teal-500' : 'border-border hover:bg-accent'
              }`}
            >
              Laser {isLaserOn ? 'ON' : 'Pointer'}
            </button>
            <button
              onClick={() => setShowDetection(!showDetection)}
              className={`px-3 h-9 rounded border transition-colors text-sm ${
                showDetection
                  ? 'border-[var(--detection-teal)] bg-[var(--detection-teal)]/10 text-[var(--detection-teal)]'
                  : 'border-border hover:bg-accent'
              }`}
            >
              Detection {showDetection ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Clear All button */}
          <button onClick={clearAnnotations} className="px-4 h-9 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors text-sm border border-destructive/30 z-20 relative cursor-pointer">
            Clear All
          </button>
        </div>
      </div>

      {/* AI Co-Pilot Panel */}
      <AICopilotPanel socket={socket} sessionId={SESSION_ID} />

      {/* Right Panel */}
      <div className="w-64 border-l border-border flex flex-col overflow-y-auto bg-card">
        {/* Session Metrics */}
        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-4 opacity-70">Session Metrics</div>
          <div className="space-y-2">
            {[
              { label: 'Latency', value: '42', unit: 'ms' },
              { label: 'Duration', value: formatTime(sessionTime).split(':').slice(1).join(':'), unit: 'm' },
              { label: 'Annotations', value: '37', unit: '' },
              { label: 'Packet Loss', value: '0.2', unit: '%' }
            ].map((m, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-background/30 hover:bg-background/60 transition-colors">
                <span className="text-[11px] text-muted-foreground font-medium">{m.label}</span>
                <span className="font-mono text-xs font-bold text-[var(--hal-blue)]">
                  {m.value}<span className="text-[9px] ml-0.5 opacity-60 font-normal text-foreground">{m.unit}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Network Health */}
        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-4 opacity-70">Network Health</div>
          <div className="space-y-5">
            <div className="group">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] text-muted-foreground font-medium">Video Stream</span>
                <span className="font-mono text-[9px] text-[var(--status-online)] px-1.5 py-0.5 bg-[var(--status-online)]/10 rounded-full border border-[var(--status-online)]/20">38ms</span>
              </div>
              <div className="h-1 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-[var(--status-online)]" style={{ width: '92%' }}></div>
              </div>
            </div>
            <div className="group">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] text-muted-foreground font-medium">Annotation Sync</span>
                <span className="font-mono text-[9px] text-[var(--status-online)] px-1.5 py-0.5 bg-[var(--status-online)]/10 rounded-full border border-[var(--status-online)]/20">12ms</span>
              </div>
              <div className="h-1 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-[var(--status-online)]" style={{ width: '97%' }}></div>
              </div>
            </div>
            <div className="group">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] text-muted-foreground font-medium">Clock Jitter</span>
                <span className="font-mono text-[9px] text-[var(--status-online)] px-1.5 py-0.5 bg-[var(--status-online)]/10 rounded-full border border-[var(--status-online)]/20">3ms</span>
              </div>
              <div className="h-1 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-[var(--status-online)]" style={{ width: '99%' }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Connected Devices */}
        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Connected Devices</div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-online)] mt-1.5"></div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">Rajesh Kumar</div>
                <div className="text-xs text-muted-foreground truncate">Android 12 · Chrome</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-online)] mt-1.5"></div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">Observer 1</div>
                <div className="text-xs text-muted-foreground truncate">Windows 11 · Edge</div>
              </div>
            </div>
          </div>
        </div>

        {/* Audio Controls */}
        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Audio</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Microphone</span>
              <button
                onClick={toggleMic}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  micEnabled ? 'bg-[var(--hal-blue)]' : 'bg-switch-background'
                }`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  micEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}></div>
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Speaker</span>
              <button
                onClick={toggleSpeaker}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  speakerEnabled ? 'bg-[var(--hal-blue)]' : 'bg-switch-background'
                }`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  speakerEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}></div>
              </button>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Volume</span>
                <span className="font-mono text-xs">{volume}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--hal-blue)]"
              />
            </div>
          </div>
        </div>

        {/* Annotation Log */}
        <div className="p-4 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Annotation Log</div>
          <div className="space-y-2 text-xs">
            <div className="pb-2 border-b border-border">
              <div className="font-mono text-muted-foreground">14:23:45</div>
              <div className="mt-1">Arrow annotation (red)</div>
            </div>
            <div className="pb-2 border-b border-border">
              <div className="font-mono text-muted-foreground">14:22:18</div>
              <div className="mt-1">Circle annotation (amber)</div>
            </div>
            <div className="pb-2 border-b border-border">
              <div className="font-mono text-muted-foreground">14:21:03</div>
              <div className="mt-1">Rectangle annotation (teal)</div>
            </div>
            <div className="pb-2 border-b border-border">
              <div className="font-mono text-muted-foreground">14:19:42</div>
              <div className="mt-1">Text annotation (white)</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SessionHistory({ sessions }: { sessions: any[] }) {
  return (
    <div className="flex-1 flex flex-col p-6">
      {/* Filter Bar */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search sessions..."
          className="flex-1 px-3 py-2 rounded border border-border bg-input-background focus:outline-none focus:ring-2 focus:ring-[var(--hal-blue)]"
        />
        <select className="px-3 py-2 rounded border border-border bg-input-background focus:outline-none focus:ring-2 focus:ring-[var(--hal-blue)]">
          <option>All Locations</option>
          <option>Assembly Bay 3</option>
          <option>Engine Test Cell</option>
          <option>Hydraulics Lab</option>
        </select>
        <select className="px-3 py-2 rounded border border-border bg-input-background focus:outline-none focus:ring-2 focus:ring-[var(--hal-blue)]">
          <option>All Experts</option>
          <option>Dr. Mehta</option>
          <option>R. Iyer</option>
          <option>S. Reddy</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border border-border rounded">
        <table className="w-full">
          <thead className="bg-muted border-b border-border sticky top-0">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium">Session ID</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Technician</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Location</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Expert</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Date</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Duration</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Annotations</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session, idx) => (
              <tr key={session.id} className="border-b border-border hover:bg-accent/50 cursor-pointer transition-colors">
                <td className="px-4 py-3 font-mono text-sm">{session.id}</td>
                <td className="px-4 py-3 text-sm">{session.tech}</td>
                <td className="px-4 py-3 text-sm">{session.location}</td>
                <td className="px-4 py-3 text-sm">{session.expert}</td>
                <td className="px-4 py-3 text-sm">{session.date}</td>
                <td className="px-4 py-3 font-mono text-sm">{session.duration}</td>
                <td className="px-4 py-3 font-mono text-sm">{session.annotations}</td>
                <td className="px-4 py-3">
                  {session.status === 'completed' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-[var(--status-online)]/10 text-[var(--status-online)]">
                      Completed
                    </span>
                  )}
                  {session.status === 'failed' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-destructive/10 text-destructive">
                      Failed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Analytics() {
  const kpis = [
    { label: 'Total Sessions', value: '142', change: '+12%' },
    { label: 'Avg Duration', value: '24:18', change: '+5%' },
    { label: 'Avg Annotations', value: '48', change: '+8%' },
    { label: 'Success Rate', value: '96.2%', change: '+2.1%' },
    { label: 'Avg Latency', value: '38ms', change: '-4ms' },
    { label: 'Active Experts', value: '8', change: '+1' }
  ];

  const weekData = [
    { day: 'Mon', sessions: 18 },
    { day: 'Tue', sessions: 24 },
    { day: 'Wed', sessions: 21 },
    { day: 'Thu', sessions: 27 },
    { day: 'Fri', sessions: 23 },
    { day: 'Sat', sessions: 8 },
    { day: 'Sun', sessions: 5 }
  ];

  const maxSessions = Math.max(...weekData.map(d => d.sessions));
  const todayIndex = 4;

  return (
    <div className="flex-1 p-6 overflow-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {kpis.map((kpi, idx) => (
          <div key={idx} className="p-6 rounded border border-border bg-card">
            <div className="text-sm text-muted-foreground mb-2">{kpi.label}</div>
            <div className="text-3xl font-mono mb-1">{kpi.value}</div>
            <div className="text-sm text-[var(--status-online)]">{kpi.change} this week</div>
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      <div className="p-6 rounded border border-border bg-card">
        <div className="text-lg font-medium mb-6">Session Activity - Current Week</div>
        <div className="flex items-end gap-6 h-64">
          {weekData.map((day, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center">
              <div className="w-full flex items-end justify-center flex-1 pb-4">
                <div
                  className={`w-full rounded-t transition-all ${
                    idx === todayIndex ? 'bg-[var(--hal-blue)]' : 'bg-[var(--hal-blue)]/60'
                  }`}
                  style={{ height: `${(day.sessions / maxSessions) * 100}%` }}
                ></div>
              </div>
              <div className="text-sm font-mono text-muted-foreground mt-2">{day.day}</div>
              <div className="text-lg font-mono mt-1">{day.sessions}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Settings() {
  const [settings, setSettings] = useState({
    sessionRecording: true,
    annotationSync: true,
    audio: true,
    observerMode: false,
    videoResolution: '1080p',
    maxSessions: 5
  });

  const toggleSetting = (key: string) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl space-y-4">
        {/* Session Recording */}
        <div className="p-4 rounded border border-border bg-card flex items-center justify-between">
          <div>
            <div className="font-medium">Session Recording</div>
            <div className="text-sm text-muted-foreground mt-1">Automatically record all live sessions for playback and review</div>
          </div>
          <button
            onClick={() => toggleSetting('sessionRecording')}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              settings.sessionRecording ? 'bg-[var(--hal-blue)]' : 'bg-switch-background'
            }`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              settings.sessionRecording ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}></div>
          </button>
        </div>

        {/* Annotation Sync */}
        <div className="p-4 rounded border border-border bg-card flex items-center justify-between">
          <div>
            <div className="font-medium">Real-time Annotation Sync</div>
            <div className="text-sm text-muted-foreground mt-1">Synchronize annotations instantly across all connected devices</div>
          </div>
          <button
            onClick={() => toggleSetting('annotationSync')}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              settings.annotationSync ? 'bg-[var(--hal-blue)]' : 'bg-switch-background'
            }`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              settings.annotationSync ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}></div>
          </button>
        </div>

        {/* Audio */}
        <div className="p-4 rounded border border-border bg-card flex items-center justify-between">
          <div>
            <div className="font-medium">Audio Communication</div>
            <div className="text-sm text-muted-foreground mt-1">Enable voice chat between expert and technician</div>
          </div>
          <button
            onClick={() => toggleSetting('audio')}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              settings.audio ? 'bg-[var(--hal-blue)]' : 'bg-switch-background'
            }`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              settings.audio ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}></div>
          </button>
        </div>

        {/* Observer Mode */}
        <div className="p-4 rounded border border-border bg-card flex items-center justify-between">
          <div>
            <div className="font-medium">Observer Mode</div>
            <div className="text-sm text-muted-foreground mt-1">Allow additional users to observe sessions without annotation privileges</div>
          </div>
          <button
            onClick={() => toggleSetting('observerMode')}
            className={`w-11 h-6 rounded-full transition-colors relative ${
              settings.observerMode ? 'bg-[var(--hal-blue)]' : 'bg-switch-background'
            }`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              settings.observerMode ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}></div>
          </button>
        </div>

        {/* Video Resolution */}
        <div className="p-4 rounded border border-border bg-card flex items-center justify-between">
          <div>
            <div className="font-medium">Video Resolution</div>
            <div className="text-sm text-muted-foreground mt-1">Set the default video stream quality for new sessions</div>
          </div>
          <select
            value={settings.videoResolution}
            onChange={(e: any) => setSettings((prev: any) => ({ ...prev, videoResolution: e.target.value }))}
            className="px-3 py-2 rounded border border-border bg-input-background focus:outline-none focus:ring-2 focus:ring-[var(--hal-blue)]"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="1440p">1440p</option>
          </select>
        </div>

        {/* Max Concurrent Sessions */}
        <div className="p-4 rounded border border-border bg-card flex items-center justify-between">
          <div>
            <div className="font-medium">Maximum Concurrent Sessions</div>
            <div className="text-sm text-muted-foreground mt-1">Limit the number of simultaneous active sessions per expert</div>
          </div>
          <select
            value={settings.maxSessions}
            onChange={(e: any) => setSettings((prev: any) => ({ ...prev, maxSessions: Number(e.target.value) }))}
            className="px-3 py-2 rounded border border-border bg-input-background focus:outline-none focus:ring-2 focus:ring-[var(--hal-blue)]"
          >
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </select>
        </div>
      </div>
    </div>
  );
}
