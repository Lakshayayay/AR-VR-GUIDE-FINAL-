import { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Camera as CameraIcon,
  Flashlight,
  FlashlightOff,
  PhoneOff,
  WifiOff
} from 'lucide-react';
import io from 'socket.io-client';
import * as THREE from 'three';
import AIWarningBanner from './components/AIWarningBanner';

export default function App() {
  const [isMuted, setIsMuted] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [latency, setLatency] = useState(42);
  const [isFreezed, setIsFreezed] = useState(false);
  const [showConnectionLost, setShowConnectionLost] = useState(false);
  const [laserPosition, setLaserPosition] = useState({ x: 50, y: 50 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<any>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [socket, setSocket] = useState<any>(null);
  const [isLaserActive, setIsLaserActive] = useState(false);
  const laserTimerRef = useRef<any>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(Math.floor(Math.random() * 150) + 20);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getLatencyColor = () => {
    if (latency < 100) return 'text-[#5DCAA5]';
    if (latency < 200) return 'text-[#EF9F27]';
    return 'text-[#E24B4A]';
  };

  const setupPeer = async (expertSocketId: string) => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerRef.current = peer;

    peer.onicecandidate = e => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('signal', { to: expertSocketId, signal: { type: 'candidate', candidate: e.candidate }});
      }
    };

    peer.onconnectionstatechange = () => {
      setConnectionStatus('Streaming to Expert: ' + peer.connectionState);
    };

    if ((window as any).localStream) {
      (window as any).localStream.getTracks().forEach((track: any) => peer.addTrack(track, (window as any).localStream));
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (socketRef.current) {
       socketRef.current.emit('signal', { to: expertSocketId, signal: { type: 'offer', sdp: offer.sdp }});
    }
  };

  const initCamera = async () => {
     try {
       let stream;
       try {
           stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
       } catch (e) {
           stream = await navigator.mediaDevices.getUserMedia({ video: true });
       }
       if (videoRef.current) videoRef.current.srcObject = stream;
       (window as any).localStream = stream;
       if (socketRef.current) socketRef.current.emit('join-session', 'HAL-123');
     } catch (err: any) {
       setConnectionStatus(`Camera Error: ${err.name}. Using mock feed...`);
       const simCanvas = document.createElement('canvas');
       simCanvas.width = 800; simCanvas.height = 600;
       const simCtx = simCanvas.getContext('2d')!;
       let frame = 0;
       setInterval(() => {
           simCtx.fillStyle = '#111';
           simCtx.fillRect(0, 0, 800, 600);
           simCtx.strokeStyle = '#0f0';
           simCtx.beginPath();
           simCtx.moveTo(0, 300); simCtx.lineTo(800, 300);
           simCtx.moveTo(400, 0); simCtx.lineTo(400, 600);
           simCtx.stroke();
           simCtx.fillStyle = `hsl(${frame % 360}, 100%, 50%)`;
           simCtx.beginPath();
           simCtx.arc(400 + Math.cos(frame * 0.05) * 150, 300 + Math.sin(frame * 0.05) * 150, 30, 0, Math.PI * 2);
           simCtx.fill();
           frame += 5;
       }, 3000);
       (window as any).localStream = (simCanvas as any).captureStream(30);
       if (videoRef.current) videoRef.current.srcObject = (window as any).localStream;
       if (socketRef.current) socketRef.current.emit('join-session', 'HAL-123');
     }
  };

  useEffect(() => {
      if (!canvasRef.current) return;
      const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.z = 5;
      
      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      
      const annotationGroup = new THREE.Group();
      scene.add(annotationGroup);

      const tracker = {
         active: false,
         template: new Float32Array(0),
         startX: 0,
         startY: 0,
         currentX: 0,
         currentY: 0,
         size: 48,
         searchWindow: 120,
         ctx: document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
      };
      tracker.ctx.canvas.width = 400;
      tracker.ctx.canvas.height = 225;

      const extractGray = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
         x = Math.max(0, Math.min(Math.floor(x), 400 - w));
         y = Math.max(0, Math.min(Math.floor(y), 225 - h));
         const imgData = ctx.getImageData(x, y, w, h).data;
         const gray = new Float32Array(w * h);
         for (let i=0; i<gray.length; i++) {
             gray[i] = imgData[i*4] * 0.299 + imgData[i*4+1] * 0.587 + imgData[i*4+2] * 0.114;
         }
         return gray;
      };
      
      let animationId: number;
      const animate = () => {
        animationId = requestAnimationFrame(animate);
        
        if (tracker.active && videoRef.current && videoRef.current.readyState >= 2) {
            tracker.ctx.drawImage(videoRef.current, 0, 0, 400, 225);
            const halfS = tracker.searchWindow / 2;
            const halfT = tracker.size / 2;
            const minX = Math.floor(tracker.currentX - halfS);
            const minY = Math.floor(tracker.currentY - halfS);
            
            const searchData = extractGray(tracker.ctx, minX, minY, tracker.searchWindow, tracker.searchWindow);
            
            let bestScore = Infinity;
            let bestDx = 0, bestDy = 0;
            const maxI = tracker.searchWindow - tracker.size;
            
            // Raw SAD for stability
            for (let dy=0; dy<=maxI; dy+=2) {
                for (let dx=0; dx<=maxI; dx+=2) {
                    let sad = 0;
                    for (let ty=0; ty<tracker.size; ty+=2) {
                        for (let tx=0; tx<tracker.size; tx+=2) {
                            sad += Math.abs(tracker.template[ty*tracker.size + tx] - searchData[(dy+ty)*tracker.searchWindow + (dx+tx)]);
                        }
                    }
                    if (sad < bestScore) {
                        bestScore = sad; bestDx = dx; bestDy = dy;
                    }
                }
            }
            
            if (bestScore < 25000) {
                const targetX = minX + bestDx + halfT;
                const targetY = minY + bestDy + halfT;
                
                // Dead-zone: Only update if the movement is more than 1.5 pixels
                const dist = Math.sqrt(Math.pow(targetX - tracker.currentX, 2) + Math.pow(targetY - tracker.currentY, 2));
                if (dist > 1.5) {
                    // High-stability smoothing
                    tracker.currentX = tracker.currentX * 0.9 + targetX * 0.1;
                    tracker.currentY = tracker.currentY * 0.9 + targetY * 0.1;
                }
            }
            
            const dxPixels = tracker.currentX - tracker.startX;
            const dyPixels = tracker.currentY - tracker.startY;
            
            const vFov = THREE.MathUtils.degToRad(camera.fov);
            const planeHeight = 2 * Math.tan(vFov / 2) * camera.position.z;
            const planeWidth = planeHeight * (400/225); 
            
            annotationGroup.position.x = (dxPixels / 400) * planeWidth;
            annotationGroup.position.y = -(dyPixels / 225) * planeHeight;
            
            if (socketRef.current) {
                socketRef.current.emit('tracking_update', {
                    sessionId: 'HAL-123',
                    dx: dxPixels,
                    dy: dyPixels,
                    canvasW: 400,
                    canvasH: 225
                });
            }
        }
        
        renderer.render(scene, camera);
      };
      animate();
      
      const handleResize = () => {
        if (!canvasRef.current) return;
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
      };
      window.addEventListener('resize', handleResize);
      handleResize();

       const socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:3000');
       socketRef.current = socket;
       setSocket(socket);
       
       socket.on('connect', () => {
         setConnectionStatus('Connected to Server');
         initCamera();
       });
       
       socket.on('user-joined', async (expertId: string) => {
         setupPeer(expertId);
       });

       socket.on('signal', async (data: any) => {
          if (data.signal.type === 'request-offer') {
             if (peerRef.current) peerRef.current.close();
             await setupPeer(data.from);
             return;
          }
          if (!peerRef.current) await setupPeer(data.from);
          const sig = data.signal;
          if (sig.type === 'answer' || sig.type === 'offer') {
             await peerRef.current.setRemoteDescription(new RTCSessionDescription(sig));
             if (sig.type === 'offer') {
                 const answer = await peerRef.current.createAnswer();
                 await peerRef.current.setLocalDescription(answer);
                 socket.emit('signal', { to: data.from, signal: { type: 'answer', sdp: answer.sdp }});
             }
          } else if (sig.type === 'candidate') {
             await peerRef.current.addIceCandidate(new RTCIceCandidate(sig.candidate));
          }
       });

        socket.on('annotation', (data: any) => {
           if (!sceneRef.current || !cameraRef.current) return;
           const tools = ['line', 'freehand', 'arrow', 'circle', 'rectangle'];
           if (tools.includes(data.tool)) {
             if (!tracker.active && videoRef.current && videoRef.current.readyState >= 2) {
                 tracker.ctx.drawImage(videoRef.current, 0, 0, 400, 225);
                 const vx = (data.x1 / data.canvasW) * 400;
                 const vy = (data.y1 / data.canvasH) * 225;
                 tracker.startX = vx;
                 tracker.startY = vy;
                 tracker.currentX = vx;
                 tracker.currentY = vy;
                 tracker.template = extractGray(tracker.ctx, vx - tracker.size/2, vy - tracker.size/2, tracker.size, tracker.size);
                 tracker.active = true;
                 annotationGroup.position.set(0,0,0);
             }

             const nx1 = (data.x1 / data.canvasW) * 2 - 1;
             const ny1 = -(data.y1 / data.canvasH) * 2 + 1;
             const nx2 = (data.x2 / data.canvasW) * 2 - 1;
             const ny2 = -(data.y2 / data.canvasH) * 2 + 1;
             const vec1 = new THREE.Vector3(nx1, ny1, 0.5).unproject(cameraRef.current);
             const vec2 = new THREE.Vector3(nx2, ny2, 0.5).unproject(cameraRef.current);
             const material = new THREE.MeshBasicMaterial({ color: data.color || 0x00ff00 });
             let mesh: any;

             if (data.tool === 'rectangle') {
                const group = new THREE.Group();
                const p1 = vec1.clone();
                const p2 = new THREE.Vector3(vec2.x, vec1.y, vec1.z);
                const p3 = vec2.clone();
                const p4 = new THREE.Vector3(vec1.x, vec2.y, vec1.z);
                [ [p1, p2], [p2, p3], [p3, p4], [p4, p1] ].forEach(([v1, v2]) => {
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

             mesh.userData.isAnnotation = true;
             mesh.position.x -= annotationGroup.position.x;
             mesh.position.y -= annotationGroup.position.y;
             annotationGroup.add(mesh);
           }
        });

        socket.on('laser_update', (data: any) => {
            setIsLaserActive(true);
            setLaserPosition({ x: (data.x / data.canvasW) * 100, y: (data.y / data.canvasH) * 100 });
            if (laserTimerRef.current) clearTimeout(laserTimerRef.current);
            laserTimerRef.current = setTimeout(() => setIsLaserActive(false), 2000);
        });

        socket.on('freeze_session', (data: any) => setIsFreezed(data.frozen));

        socket.on('clear-annotations', () => {
          tracker.active = false;
          annotationGroup.position.set(0,0,0);
          const toRemove: any[] = [];
          annotationGroup.children.forEach(c => { if (c.userData.isAnnotation) toRemove.push(c); });
          toRemove.forEach(c => { annotationGroup.remove(c); if((c as any).geometry) (c as any).geometry.dispose(); });
        });

    return () => {
       if (socketRef.current) socketRef.current.disconnect();
       if (peerRef.current) peerRef.current.close();
       cancelAnimationFrame(animationId);
       window.removeEventListener('resize', handleResize);
    };
  }, []);

  const flipCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: newMode } }, audio: true });
        if ((window as any).localStream) (window as any).localStream.getTracks().forEach((track: any) => track.stop());
        (window as any).localStream = newStream;
        if (videoRef.current) videoRef.current.srcObject = newStream;
        if (peerRef.current && peerRef.current.connectionState === 'connected') {
            const videoSender = peerRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
            if (videoSender) await videoSender.replaceTrack(newStream.getVideoTracks()[0]);
        }
    } catch (err) { console.error('Flip failed', err); }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain z-0" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />

      {isFreezed && <div className="absolute inset-0 border-4 border-[#5DCAA5] pointer-events-none z-50" />}
      <AIWarningBanner socket={socket} />

      <div className="absolute top-4 left-4 z-30 flex flex-col gap-2">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3">
          <div className="font-mono text-white text-sm">SES-20260419-001</div>
          <div className="text-white/60 text-xs mt-0.5">Live Remote Assistance</div>
        </div>
        <div className="bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 inline-flex items-center gap-2 self-start">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-white text-sm truncate max-w-[200px]">{connectionStatus}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-30 flex flex-col gap-2 items-end">
        <div className="bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 inline-flex items-center gap-2">
          <div className="w-2 h-2 bg-[#E24B4A] rounded-full animate-pulse" />
          <span className="font-mono text-white text-sm">{formatTime(recordingTime)}</span>
        </div>
        <div className="bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 inline-flex text-xs text-white/60">
          Latency: {latency}ms
        </div>
      </div>

      <div
        className={`absolute w-5 h-5 pointer-events-none z-30 transition-all duration-300 ${isLaserActive ? '' : 'hidden'}`}
        style={{ left: `${laserPosition.x}%`, top: `${laserPosition.y}%`, transform: 'translate(-50%, -50%)' }}
      >
        <div className="absolute inset-0 bg-[#5DCAA5] rounded-full animate-pulse opacity-80" />
        <div className="absolute inset-0 bg-[#5DCAA5] rounded-full scale-150 opacity-40 animate-pulse" />
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm rounded-full px-6 py-3 z-30">
        <div className="flex items-center justify-between gap-6">
          <button onClick={() => setIsMuted(!isMuted)} className={`w-12 h-12 rounded-full flex items-center justify-center ${isMuted ? 'bg-red-500' : 'bg-white/10'}`}>
            {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
          </button>
          <button onClick={flipCamera} className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
            <CameraIcon className="w-6 h-6 text-white" />
          </button>
          <button onClick={() => setShowEndConfirm(true)} className="px-6 py-3 bg-[#E24B4A] rounded-full text-white font-medium">End Session</button>
        </div>
      </div>

      <div className="absolute top-1/2 right-4 -translate-y-1/2 flex flex-col gap-2 z-50">
        <button onClick={() => setIsFreezed(!isFreezed)} className="px-3 py-2 bg-[#5DCAA5] rounded text-xs text-black font-medium">{isFreezed ? 'Unfreeze' : 'Freeze'}</button>
        <button onClick={() => socketRef.current?.emit('clear-annotations', { sessionId: 'HAL-123' })} className="px-3 py-2 bg-red-500 rounded text-xs text-white font-medium">Clear 3D</button>
      </div>
    </div>
  );
}