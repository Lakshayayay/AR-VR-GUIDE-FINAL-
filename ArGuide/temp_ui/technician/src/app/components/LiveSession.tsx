import { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Camera as CameraIcon,
  Flashlight,
  FlashlightOff,
  PhoneOff,
  WifiOff,
  Bot,
  Video,
  VideoOff
} from 'lucide-react';
import io from 'socket.io-client';
import { useLocation, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import AIWarningBanner from './AIWarningBanner';
import { Hands, HAND_CONNECTIONS, Results } from '@mediapipe/hands';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Camera } from '@mediapipe/camera_utils';

export default function LiveSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionId = location.state?.sessionId || 'HAL-123';
  const [isMuted, setIsMuted] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [latency, setLatency] = useState(42);
  const [isFreezed, setIsFreezed] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [showConnectionLost, setShowConnectionLost] = useState(false);
  const [laserPosition, setLaserPosition] = useState({ x: 50, y: 50 });
  const [isHandPinching, setIsHandPinching] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<any>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [callStatus, setCallStatus] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [socket, setSocket] = useState<any>(null);
  const [isLaserActive, setIsLaserActive] = useState(false);
  const laserTimerRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const streamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Hand Tracking Refs
  const handsRef = useRef<Hands | null>(null);
  const isDrawingHand = useRef(false);
  const lastHandPos = useRef<{ x: number, y: number } | null>(null);
  const waveHistory = useRef<{ x: number, t: number }[]>([]);
  const lastClearTime = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

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

    peer.ontrack = e => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(err => console.error('Remote audio play failed:', err));
      }
    };

    if ((window as any).localStream) {
      console.log('Adding tracks to peer:', (window as any).localStream.getTracks().length);
      (window as any).localStream.getTracks().forEach((track: any) => peer.addTrack(track, (window as any).localStream));
    } else {
      console.warn('No local stream available for setupPeer yet. Will add later if ready.');
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (socketRef.current) {
       socketRef.current.emit('signal', { to: expertSocketId, signal: { type: 'offer', sdp: offer.sdp }});
    }
  };

  const initCamera = async () => {
     streamPromiseRef.current = (async () => {
      try {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, 
              audio: true 
            });
        } catch (e) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        localStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        (window as any).localStream = stream;
        
        // If peer exists, add tracks now
        if (peerRef.current && peerRef.current.connectionState !== 'closed') {
          stream.getTracks().forEach(t => peerRef.current!.addTrack(t, stream));
          // Renegotiate
          const offer = await peerRef.current.createOffer();
          await peerRef.current.setLocalDescription(offer);
          socketRef.current.emit('signal', { to: 'expert', signal: { type: 'offer', sdp: offer.sdp }}); // Simplified 'to' for this context
        }

        if (socketRef.current) socketRef.current.emit('join-session', sessionId);
        setConnectionStatus('Connected & Audio Active');
        return stream;
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
        }, 33);
        
        const videoStream = (simCanvas as any).captureStream(30);
        try {
           const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
           audioStream.getAudioTracks().forEach(t => videoStream.addTrack(t));
        } catch(e) {}
        
        localStreamRef.current = videoStream;
        (window as any).localStream = videoStream;
        if (videoRef.current) videoRef.current.srcObject = videoStream;
        if (socketRef.current) socketRef.current.emit('join-session', sessionId);
        return videoStream;
      }
     })();
     await streamPromiseRef.current;
     if (socketRef.current) {
       socketRef.current.emit('call-expert', { sessionId, techName: 'Field Technician' });
     }
  };

  useEffect(() => {
      if (!canvasRef.current) return;
       const renderer = new THREE.WebGLRenderer({ 
           canvas: canvasRef.current, 
           alpha: true, 
           antialias: true, 
           powerPreference: 'high-performance' 
       });
       const scene = new THREE.Scene();
       const camera = new THREE.PerspectiveCamera(85, 1280 / 720, 0.1, 1000);
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
          velX: 0,
          velY: 0,
          size: 64, // Increased for better feature density
          searchWindow: 144,
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
       
       // Tracking loop (Interval-based to survive background tab throttling)
       const trackingInterval = setInterval(() => {
         if (tracker.active && videoRef.current && videoRef.current.readyState >= 2) {
            tracker.ctx.drawImage(videoRef.current, 0, 0, 400, 225);
            
            const halfS = tracker.searchWindow / 2;
            const halfT = tracker.size / 2;
            const minX = Math.floor(tracker.currentX - halfS);
            const minY = Math.floor(tracker.currentY - halfS);
            
            const getStats = (data: Float32Array) => {
                let sum = 0, sqSum = 0;
                for (let i = 0; i < data.length; i++) {
                    sum += data[i];
                    sqSum += data[i] * data[i];
                }
                const mean = sum / data.length;
                const std = Math.sqrt(Math.max(0, sqSum / data.length - mean * mean));
                return { mean, std };
            };

            const tStats = getStats(tracker.template);
            const searchData = extractGray(tracker.ctx, minX, minY, tracker.searchWindow, tracker.searchWindow);
            
            let bestScore = -1; // For ZNCC, 1.0 is perfect, -1 is worst
            let bestDx = 0, bestDy = 0;
            const maxI = tracker.searchWindow - tracker.size;
            const scores = new Float32Array((maxI + 1) * (maxI + 1));

            for (let dy=0; dy<=maxI; dy+=2) {
                for (let dx=0; dx<=maxI; dx+=2) {
                    let dot = 0, sSqSum = 0, sSum = 0;
                    const count = (tracker.size/2) * (tracker.size/2);
                    
                    for (let ty=0; ty<tracker.size; ty+=2) {
                        for (let tx=0; tx<tracker.size; tx+=2) {
                            const sVal = searchData[(dy+ty)*tracker.searchWindow + (dx+tx)];
                            const tVal = tracker.template[ty*tracker.size + tx];
                            dot += (tVal - tStats.mean) * sVal;
                            sSum += sVal;
                            sSqSum += sVal * sVal;
                        }
                    }
                    
                    const sMean = sSum / count;
                    const sStd = Math.sqrt(Math.max(0, sSqSum / count - sMean * sMean));
                    const score = (sStd < 1) ? 0 : dot / (count * tStats.std * sStd);
                    
                    scores[dy * (maxI + 1) + dx] = score;
                    if (score > bestScore) {
                        bestScore = score; bestDx = dx; bestDy = dy;
                    }
                }
            }
            
            // ZNCC threshold (0.7 is usually a very good match)
            if (bestScore > 0.65) {
                let subX = bestDx;
                let subY = bestDy;
                
                const targetX = minX + subX + halfT;
                const targetY = minY + subY + halfT;
                
                const dist = Math.sqrt(Math.pow(targetX - tracker.currentX, 2) + Math.pow(targetY - tracker.currentY, 2));
                if (dist > 0.5) {
                    const alpha = 0.4;
                    tracker.currentX = tracker.currentX * (1 - alpha) + targetX * alpha;
                    tracker.currentY = tracker.currentY * (1 - alpha) + targetY * alpha;
                }

                // Adaptive Learning: Slowly blend the new match into the template
                // This handles rotation and slight scale changes
                if (bestScore > 0.85) {
                    const matchData = extractGray(tracker.ctx, targetX - halfT, targetY - halfT, tracker.size, tracker.size);
                    for (let i=0; i<tracker.template.length; i++) {
                        tracker.template[i] = tracker.template[i] * 0.98 + matchData[i] * 0.02;
                    }
                }
            }
            
            const dxPixels = tracker.currentX - tracker.startX;
            const dyPixels = tracker.currentY - tracker.startY;
            
            const vFov = THREE.MathUtils.degToRad(camera.fov);
            const planeHeight = 2 * Math.tan(vFov / 2) * camera.position.z;
            const planeWidth = planeHeight * (16 / 9); // Use unified 16:9 reference for sync

            annotationGroup.position.x = (dxPixels / 400) * planeWidth;
            annotationGroup.position.y = -(dyPixels / 225) * planeHeight;
            
            if (socketRef.current) {
                socketRef.current.emit('tracking_update', {
                    sessionId: sessionId,
                    dx: dxPixels,
                    dy: dyPixels,
                    canvasW: 400,
                    canvasH: 225
                });
            }
        }
       }, 33); // ~30 FPS background tracking

       let animationId: number;
       const animate = () => {
         animationId = requestAnimationFrame(animate);
         renderer.render(scene, camera);
       };
       animate();
      
      const handleResize = () => {
        if (!canvasRef.current || !handCanvasRef.current) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvasRef.current.width = w;
        canvasRef.current.height = h;
        handCanvasRef.current.width = w;
        handCanvasRef.current.height = h;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        renderer.setPixelRatio(window.devicePixelRatio);
      };
      window.addEventListener('resize', handleResize);
      handleResize();

       const socket = io('https://ar-vr-guide-final.onrender.com');
       socketRef.current = socket;
       setSocket(socket);
       
       socket.on('connect', () => {
         setConnectionStatus('Connected to Server');
         // Join expert-room FIRST so Expert Dashboard gets user-joined event (works with existing server, no redeploy needed)
         socket.emit('join-session', 'expert-room');
         socket.emit('join-session', sessionId);
         initCamera();
       });

       socket.on('call-accepted', () => {
         setCallStatus('connected');
       });
       
       socket.on('user-joined', async (expertId: string) => {
         setupPeer(expertId);
       });

       socket.on('signal', async (data: any) => {
          // Handle call-accepted signal from Expert (fallback for existing server)
          if (data.signal.type === 'call-accepted') {
            setCallStatus('connected');
            return;
          }
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

        const addAnnotationToScene = (data: any) => {
            if (!sceneRef.current || !cameraRef.current) return;
            
            const nx1 = (data.x1 / data.canvasW) * 2 - 1;
            const ny1 = -(data.y1 / data.canvasH) * 2 + 1;
            const nx2 = (data.x2 / data.canvasW) * 2 - 1;
            const ny2 = -(data.y2 / data.canvasH) * 2 + 1;
            
            // Project to a depth that is clearly visible (0.5 is center of frustum)
            const vec1 = new THREE.Vector3(nx1, ny1, 0.5).unproject(cameraRef.current);
            const vec2 = new THREE.Vector3(nx2, ny2, 0.5).unproject(cameraRef.current);
            
            console.log('Drawing segment:', { 
                tool: data.tool, 
                vec1: [vec1.x.toFixed(2), vec1.y.toFixed(2), vec1.z.toFixed(2)],
                vec2: [vec2.x.toFixed(2), vec2.y.toFixed(2), vec2.z.toFixed(2)] 
            });

            const material = new THREE.MeshBasicMaterial({ 
                color: data.color || 0x00ff00,
                transparent: true,
                opacity: 0.8
            });
            
            let mesh: any;
            const lineThickness = data.fromHand ? 0.003 : 0.005;

            if (data.tool === 'rectangle') {
               const group = new THREE.Group();
               const p1 = vec1.clone();
               const p2 = new THREE.Vector3(vec2.x, vec1.y, vec1.z);
               const p3 = vec2.clone();
               const p4 = new THREE.Vector3(vec1.x, vec2.y, vec1.z);
               [[p1, p2], [p2, p3], [p3, p4], [p4, p1]].forEach(([v1, v2]) => {
                 const path = new THREE.LineCurve3(v1, v2);
                 group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 1, lineThickness, 8, false), material));
               });
               mesh = group;
            } else if (data.tool === 'circle') {
               const radius = vec1.distanceTo(vec2);
               mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, lineThickness, 8, 50), material);
               mesh.position.copy(vec1);
               mesh.lookAt(cameraRef.current.position);
            } else if (data.tool === 'arrow') {
               const group = new THREE.Group();
               group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(vec1, vec2), 1, lineThickness, 8, false), material));
               const dir = new THREE.Vector3().subVectors(vec2, vec1).normalize();
               const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 8), material);
               head.position.copy(vec2);
               head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
               group.add(head);
               mesh = group;
            } else {
               mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(vec1, vec2), 8, lineThickness, 8, false), material);
            }

            mesh.userData.isAnnotation = true;
            mesh.position.x -= annotationGroup.position.x;
            mesh.position.y -= annotationGroup.position.y;
            annotationGroup.add(mesh);
        };

        socket.on('annotation', (data: any) => {
            // If it's fromHand, the technician has already drawn it locally to avoid lag
            if (data.fromHand) return;
            
            console.log('Technician received expert annotation:', data.tool);
            
            // Only activate tracker for expert annotations (not fromHand)
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

            addAnnotationToScene(data);
         });
         
         // Store function in a ref so it can be called from MediaPipe loop
         (window as any).addAnnotation = addAnnotationToScene;

        // Laser Pointer Implementation
        const laserGroup = new THREE.Group();
        const laserGeo = new THREE.SphereGeometry(0.02, 16, 16);
        const laserMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const laserMesh = new THREE.Mesh(laserGeo, laserMat);
        const laserLight = new THREE.PointLight(0xff0000, 1, 1);
        laserGroup.add(laserMesh);
        laserGroup.add(laserLight);
        laserGroup.visible = false;
        scene.add(laserGroup);

        let laserTimeout: any;

        socket.on('laser_update', (data: any) => {
            if (!cameraRef.current) return;
            
            laserGroup.visible = true;
            clearTimeout(laserTimeout);

            const nx = (data.x / data.canvasW) * 2 - 1;
            const ny = -(data.y / data.canvasH) * 2 + 1;
            const vec = new THREE.Vector3(nx, ny, 0.5).unproject(cameraRef.current);
            
            laserGroup.position.copy(vec);

            laserTimeout = setTimeout(() => {
                laserGroup.visible = false;
            }, 1500);
        });

        socket.on('freeze_session', (data: any) => setIsFreezed(data.frozen));

        const clearAllAnnotations = () => {
            tracker.active = false;
            annotationGroup.position.set(0, 0, 0);
            const toRemove: any[] = [];
            annotationGroup.children.forEach(c => { 
                if (c.userData.isAnnotation) toRemove.push(c); 
            });
            toRemove.forEach(c => { 
                annotationGroup.remove(c); 
                if ((c as any).geometry) (c as any).geometry.dispose(); 
                if ((c as any).material) (c as any).material.dispose();
            });
            console.log('Annotations cleared locally');
        };

        socket.on('clear-annotations', () => {
          clearAllAnnotations();
        });
         
        // Store functions in refs for MediaPipe loop and UI
        (window as any).addAnnotation = addAnnotationToScene;
        (window as any).clearAnnotations = clearAllAnnotations;

    return () => {
       if (socketRef.current) socketRef.current.disconnect();
       if (peerRef.current) peerRef.current.close();
       if (handsRef.current) handsRef.current.close();
       cancelAnimationFrame(animationId);
       window.removeEventListener('resize', handleResize);
    };
  }, []);

  // MediaPipe Hands Initialization
  useEffect(() => {
    if (!videoRef.current || !handCanvasRef.current) {
        console.log('Waiting for elements before hand init...', { video: !!videoRef.current, canvas: !!handCanvasRef.current });
        return;
    }

    console.log('Initializing MediaPipe Hands...');
    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults((results: Results) => {
      if (!handCanvasRef.current || !videoRef.current || !cameraRef.current || !sceneRef.current) return;
      const ctx = handCanvasRef.current.getContext('2d')!;
      
      // Clear the overlay canvas
      ctx.clearRect(0, 0, handCanvasRef.current.width, handCanvasRef.current.height);
      
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        const wrist = landmarks[0];

        // Draw landmarks for feedback
        ctx.save();
        ctx.scale(handCanvasRef.current.width / 1, handCanvasRef.current.height / 1);
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 2 });
        ctx.restore();

        // Gesture Detection: Pinch (Thumb + Index)
        const pinchDist = Math.sqrt(
          Math.pow(indexTip.x - thumbTip.x, 2) + 
          Math.pow(indexTip.y - thumbTip.y, 2) + 
          Math.pow(indexTip.z - thumbTip.z, 2)
        );
        const isPinch = pinchDist < 0.1; // Increased threshold for better reliability
        setIsHandPinching(isPinch);

        if (isPinch) {
          console.log('Pinch detected! Drawing...');
        }

        // Gesture Detection: Wave to Clear
        const now = Date.now();
        waveHistory.current.push({ x: wrist.x, t: now });
        if (waveHistory.current.length > 20) waveHistory.current.shift();
        
        if (waveHistory.current.length > 10 && now - lastClearTime.current > 2000) {
          const xValues = waveHistory.current.map(h => h.x);
          const minX = Math.min(...xValues);
          const maxX = Math.max(...xValues);
          if (maxX - minX > 0.25) { // Increased threshold for stability
             console.log('Wave detected! Clearing annotations.');
             if ((window as any).clearAnnotations) (window as any).clearAnnotations();
             socketRef.current?.emit('clear-annotations', { sessionId: 'HAL-123' });
             lastClearTime.current = now;
          }
        }

        // Map normalized coordinates (0-1) to screen pixels for laser/drawing
        const screenX = indexTip.x * 100;
        const screenY = indexTip.y * 100;
        setLaserPosition({ x: screenX, y: screenY });
        setIsLaserActive(true);

        // Drawing Logic
        if (isPinch) {
          if (!isDrawingHand.current) {
            isDrawingHand.current = true;
            lastHandPos.current = { x: indexTip.x, y: indexTip.y };
          } else if (lastHandPos.current) {
            // Emit annotation
            const w = canvasRef.current.width;
            const h = canvasRef.current.height;
            // Draw locally immediately
            const annotationData = {
              sessionId: 'HAL-123',
              tool: 'freehand',
              x1: lastHandPos.current.x * w,
              y1: lastHandPos.current.y * h,
              x2: indexTip.x * w,
              y2: indexTip.y * h,
              color: '#00ff00',
              canvasW: w,
              canvasH: h,
              fromHand: true
            };
            
            const baseUrl = import.meta.env.VITE_AI_COPILOT_URL || `http://${window.location.hostname}:3001`;
            fetch(`${baseUrl}/api/analyze-live`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: 'HAL-123',
                frameData: null,
                activeSopId: null,
                timestamp: new Date().toISOString()
              })
            }).catch(err => console.log('Capture error:', err));
            
            if ((window as any).addAnnotation) {
                (window as any).addAnnotation(annotationData);
            }

            // Emit to expert
            socketRef.current?.emit('annotation', annotationData);
            lastHandPos.current = { x: indexTip.x, y: indexTip.y };
          }
        } else {
          isDrawingHand.current = false;
          lastHandPos.current = null;
        }
      } else {
        setIsHandPinching(false);
        setIsLaserActive(false);
        isDrawingHand.current = false;
      }
    });

    handsRef.current = hands;

    let processingLoop = true;
    const processFrame = async () => {
      if (!processingLoop) return;
      if (handsRef.current && videoRef.current && videoRef.current.readyState >= 2) {
        try {
          await handsRef.current.send({ image: videoRef.current });
        } catch (e) {
          console.error('MediaPipe send error:', e);
        }
      }
      requestAnimationFrame(processFrame);
    };
    processFrame();

    return () => {
      processingLoop = false;
      hands.close();
    };
  }, [facingMode]);

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
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans">
      {/* Ringing UI */}
      {callStatus === 'ringing' && (
        <div className="absolute inset-0 z-[100] bg-[#111] flex flex-col items-center justify-center">
          <div className="relative mb-12">
            <div className="absolute inset-0 bg-[#5DCAA5] rounded-full animate-ping opacity-20 scale-[2.5]" />
            <div className="absolute inset-0 bg-[#5DCAA5] rounded-full animate-ping opacity-40 scale-[1.8] delay-300" />
            <div className="w-32 h-32 bg-[#5DCAA5] rounded-full flex items-center justify-center relative z-10 shadow-2xl shadow-[#5DCAA5]/40">
              <Video className="w-12 h-12 text-black" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Calling Remote Expert</h2>
          <p className="text-white/60 text-sm animate-pulse">Waiting for expert to join session...</p>
          
          <button 
            onClick={() => navigate('/')}
            className="mt-12 px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full font-medium transition-all"
          >
            Cancel Call
          </button>
        </div>
      )}

      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain z-0" />
      <audio ref={remoteAudioRef} autoPlay />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
      <canvas ref={handCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-20" />

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
        <div className={`absolute inset-0 rounded-full animate-pulse opacity-80 ${isHandPinching ? 'bg-yellow-400' : 'bg-[#5DCAA5]'}`} />
        <div className={`absolute inset-0 rounded-full scale-150 opacity-40 animate-pulse ${isHandPinching ? 'bg-yellow-400' : 'bg-[#5DCAA5]'}`} />
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm rounded-full px-6 py-3 z-30">
        <div className="flex items-center justify-between gap-6">
          <button onClick={() => setIsMuted(!isMuted)} className={`w-12 h-12 rounded-full flex items-center justify-center ${isMuted ? 'bg-red-500' : 'bg-white/10'}`}>
            {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
          </button>
          <button 
            onClick={() => {
              const newState = !isCameraOff;
              setIsCameraOff(newState);
              if (localStreamRef.current) {
                localStreamRef.current.getVideoTracks().forEach(track => { track.enabled = !newState; });
              }
            }} 
            className={`w-12 h-12 rounded-full flex items-center justify-center ${isCameraOff ? 'bg-red-500' : 'bg-white/10'}`}
          >
            {isCameraOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>
          <button onClick={flipCamera} className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
            <CameraIcon className="w-6 h-6 text-white" />
          </button>
          <button onClick={() => setShowEndConfirm(true)} className="px-6 py-3 bg-[#E24B4A] rounded-full text-white font-medium">End Session</button>
        </div>
      </div>

      <div className="absolute top-1/2 right-4 -translate-y-1/2 flex flex-col gap-2 z-50">
        <button onClick={() => setIsFreezed(!isFreezed)} className="px-3 py-2 bg-[#5DCAA5] rounded text-xs text-black font-medium">{isFreezed ? 'Unfreeze' : 'Freeze'}</button>
        <button onClick={() => {
            if ((window as any).clearAnnotations) (window as any).clearAnnotations();
            socketRef.current?.emit('clear-annotations', { sessionId: 'HAL-123' });
        }} className="px-3 py-2 bg-red-500 rounded text-xs text-white font-medium">Clear 3D</button>
      </div>
    </div>
  );
}