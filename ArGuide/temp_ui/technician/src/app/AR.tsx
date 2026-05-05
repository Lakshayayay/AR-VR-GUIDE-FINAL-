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

    useEffect(() => {
        const interval = setInterval(() => {
            setLaserPosition({
                x: Math.random() * 80 + 10,
                y: Math.random() * 80 + 10
            });
        }, 2000);
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
                socketRef.current.emit('signal', { to: expertSocketId, signal: { type: 'candidate', candidate: e.candidate } });
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
            socketRef.current.emit('signal', { to: expertSocketId, signal: { type: 'offer', sdp: offer.sdp } });
        }
    };

    const initCamera = async () => {
        try {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: true });
            } catch (e) {
                // Fallback if ideal constraint or audio fails (e.g. on laptops)
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            if (videoRef.current) videoRef.current.srcObject = stream;
            (window as any).localStream = stream;
            if (socketRef.current) socketRef.current.emit('join-session', 'HAL-123');
        } catch (err) {
            setConnectionStatus('Camera broken! Using mock feed...');
            const simCanvas = document.createElement('canvas');
            simCanvas.width = 800; simCanvas.height = 600;
            const simCtx = simCanvas.getContext('2d')!;
            let frame = 0;
            setInterval(() => {
                simCtx.fillStyle = '#111';
                simCtx.fillRect(0, 0, 800, 600);
                simCtx.strokeStyle = '#0f0';
                simCtx.lineWidth = 2;
                simCtx.beginPath();
                simCtx.moveTo(0, 300); simCtx.lineTo(800, 300);
                simCtx.moveTo(400, 0); simCtx.lineTo(400, 600);
                simCtx.stroke();
                simCtx.fillStyle = `hsl(${frame % 360}, 100%, 50%)`;
                simCtx.beginPath();
                simCtx.arc(400 + Math.cos(frame * 0.05) * 150, 300 + Math.sin(frame * 0.05) * 150, 30, 0, Math.PI * 2);
                simCtx.fill();
                simCtx.fillStyle = '#fff';
                simCtx.font = '24px monospace';
                simCtx.fillText('Camera Hardware Locked - Using AR Test Target', 100, 50);
                frame += 5;
            }, 1000 / 30);

            (window as any).localStream = (simCanvas as any).captureStream(30);
            if (videoRef.current) videoRef.current.srcObject = (window as any).localStream;
            setConnectionStatus('AR Simulator Feed Connected. Connecting to Expert...');
            if (socketRef.current) socketRef.current.emit('join-session', 'HAL-123');
        }
    };

    useEffect(() => {
        if (!canvasRef.current) return;
        const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
            size: 32,
            searchWindow: 64,
            ctx: document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
        };
        tracker.ctx.canvas.width = 320;
        tracker.ctx.canvas.height = 240;

        const extractGray = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
            x = Math.max(0, Math.min(Math.floor(x), 320 - w));
            y = Math.max(0, Math.min(Math.floor(y), 240 - h));
            const imgData = ctx.getImageData(x, y, w, h).data;
            const gray = new Float32Array(w * h);
            for (let i = 0; i < gray.length; i++) {
                gray[i] = imgData[i * 4] * 0.299 + imgData[i * 4 + 1] * 0.587 + imgData[i * 4 + 2] * 0.114;
            }
            return gray;
        };

        let animationId: number;
        const animate = () => {
            animationId = requestAnimationFrame(animate);

            if (tracker.active && videoRef.current && videoRef.current.readyState >= 2) {
                tracker.ctx.drawImage(videoRef.current, 0, 0, 320, 240);
                const halfS = tracker.searchWindow / 2;
                const halfT = tracker.size / 2;
                const minX = Math.floor(tracker.currentX - halfS);
                const minY = Math.floor(tracker.currentY - halfS);

                const searchData = extractGray(tracker.ctx, minX, minY, tracker.searchWindow, tracker.searchWindow);

                let bestSad = Infinity;
                let bestDx = 0, bestDy = 0;
                const maxI = tracker.searchWindow - tracker.size;

                for (let dy = 0; dy <= maxI; dy += 2) {
                    for (let dx = 0; dx <= maxI; dx += 2) {
                        let sad = 0;
                        for (let ty = 0; ty < tracker.size; ty += 2) {
                            for (let tx = 0; tx < tracker.size; tx += 2) {
                                sad += Math.abs(tracker.template[ty * tracker.size + tx] - searchData[(dy + ty) * tracker.searchWindow + (dx + tx)]);
                            }
                        }
                        if (sad < bestSad) {
                            bestSad = sad; bestDx = dx; bestDy = dy;
                        }
                    }
                }

                const SAD_THRESHOLD = 50000;

                if (bestSad < SAD_THRESHOLD) {
                    const targetX = minX + bestDx + halfT;
                    const targetY = minY + bestDy + halfT;

                    // Low-pass filter for smoothing
                    tracker.currentX = tracker.currentX * 0.7 + targetX * 0.3;
                    tracker.currentY = tracker.currentY * 0.7 + targetY * 0.3;

                    // Adaptive template blending
                    const newTemplateX = Math.floor(tracker.currentX - halfT);
                    const newTemplateY = Math.floor(tracker.currentY - halfT);
                    const newTemplateData = extractGray(tracker.ctx, newTemplateX, newTemplateY, tracker.size, tracker.size);
                    for (let i = 0; i < tracker.template.length; i++) {
                        tracker.template[i] = tracker.template[i] * 0.95 + newTemplateData[i] * 0.05;
                    }
                }

                const dxPixels = tracker.currentX - tracker.startX;
                const dyPixels = tracker.currentY - tracker.startY;

                const vFov = THREE.MathUtils.degToRad(camera.fov);
                const vHeight = 2 * Math.tan(vFov / 2) * camera.position.z;
                const vWidth = vHeight * camera.aspect;

                annotationGroup.position.x = (dxPixels / 320) * vWidth;
                annotationGroup.position.y = -(dyPixels / 240) * vHeight;

                if (socketRef.current) {
                    socketRef.current.emit('tracking_update', {
                        sessionId: 'HAL-123',
                        dx: dxPixels,
                        dy: dyPixels,
                        canvasW: 320,
                        canvasH: 240
                    });
                }
                annotationGroup.position.y = -(dyPixels / 240) * vHeight;
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

        const socket = io(import.meta.env.VITE_SERVER_URL || 'https://arguide.onrender.com');
        socketRef.current = socket;
        setSocket(socket);

        socket.on('connect', () => {
            setConnectionStatus('Connected to Server. Waiting for camera...');
            initCamera();
        });

        socket.on('user-joined', async (expertId: string) => {
            setConnectionStatus('Expert joined. Negotiating Native WebRTC...');
            setupPeer(expertId);
        });

        socket.on('signal', async (data: any) => {
            if (data.signal.type === 'request-offer') {
                if (peerRef.current) peerRef.current.close();
                await setupPeer(data.from);
                return;
            }
            if (!peerRef.current) {
                await setupPeer(data.from);
            }
            const sig = data.signal;
            if (sig.type === 'answer' || sig.type === 'offer') {
                await peerRef.current.setRemoteDescription(new RTCSessionDescription(sig));
                if (sig.type === 'offer') {
                    const answer = await peerRef.current.createAnswer();
                    await peerRef.current.setLocalDescription(answer);
                    socket.emit('signal', { to: data.from, signal: { type: 'answer', sdp: answer.sdp } });
                }
            } else if (sig.type === 'candidate') {
                await peerRef.current.addIceCandidate(new RTCIceCandidate(sig.candidate));
            }
        });

        socket.on('annotation', (data: any) => {
            if (!sceneRef.current || !cameraRef.current) return;
            if (data.tool === 'line') {
                if (!tracker.active && videoRef.current && videoRef.current.readyState >= 2) {
                    tracker.ctx.drawImage(videoRef.current, 0, 0, 320, 240);
                    const vx = (data.x1 / data.canvasW) * 320;
                    const vy = (data.y1 / data.canvasH) * 240;
                    tracker.startX = vx;
                    tracker.startY = vy;
                    tracker.currentX = vx;
                    tracker.currentY = vy;
                    const half = tracker.size / 2;
                    tracker.template = extractGray(tracker.ctx, vx - half, vy - half, tracker.size, tracker.size);
                    tracker.active = true;
                    annotationGroup.position.set(0, 0, 0);
                }

                const nx1 = (data.x1 / data.canvasW) * 2 - 1;
                const ny1 = -(data.y1 / data.canvasH) * 2 + 1;
                const nx2 = (data.x2 / data.canvasW) * 2 - 1;
                const ny2 = -(data.y2 / data.canvasH) * 2 + 1;

                const vec1 = new THREE.Vector3(nx1, ny1, 0.5).unproject(cameraRef.current);
                const vec2 = new THREE.Vector3(nx2, ny2, 0.5).unproject(cameraRef.current);

                const path = new THREE.LineCurve3(vec1, vec2);
                const geometry = new THREE.TubeGeometry(path, 20, 0.005, 8, false);
                const material = new THREE.MeshBasicMaterial({ color: data.color || 0x00ff00 });
                const tube = new THREE.Mesh(geometry, material) as any;
                tube.userData.isAnnotation = true;

                // Offset tube back by annotationGroup position so it stays at the physical point where drawn
                tube.position.x = -annotationGroup.position.x;
                tube.position.y = -annotationGroup.position.y;

                annotationGroup.add(tube);

                if (!sceneRef.current.getObjectByName('ambientLight')) {
                    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
                    ambient.name = 'ambientLight';
                    sceneRef.current.add(ambient);
                }
            }
        });

        socket.on('clear-annotations', () => {
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
        });

        // AI Co-Pilot: capture a frame every 30 seconds (safe for free-tier quota)
        const FRAME_INTERVAL_MS = 30000;
        const captureAndSendFrame = () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            const captureCanvas = document.createElement('canvas');
            captureCanvas.width = 320;
            captureCanvas.height = 240;
            const ctx = captureCanvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(videoRef.current, 0, 0, 320, 240);
            const base64 = captureCanvas.toDataURL('image/jpeg', 0.7).split(',')[1];
            socket.emit('request_frame_analysis', {
                sessionId: 'HAL-123',
                frameBase64: base64,
                sessionContext: {
                    technicianName: 'Technician',
                    repairType: 'general',
                    location: 'Field',
                    equipmentType: 'Unknown'
                }
            });
        };
        const frameCaptureInterval = setInterval(captureAndSendFrame, FRAME_INTERVAL_MS);

        return () => {
            clearInterval(frameCaptureInterval);
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
            let newStream;
            try {
                newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: newMode } }, audio: true });
            } catch (e) {
                newStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }

            if ((window as any).localStream) {
                (window as any).localStream.getTracks().forEach((track: any) => track.stop());
            }

            (window as any).localStream = newStream;
            if (videoRef.current) videoRef.current.srcObject = newStream;

            if (peerRef.current && peerRef.current.connectionState === 'connected') {
                const senders = peerRef.current.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                const newVideoTrack = newStream.getVideoTracks()[0];
                if (videoSender && newVideoTrack) await videoSender.replaceTrack(newVideoTrack);

                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                const newAudioTrack = newStream.getAudioTracks()[0];
                if (audioSender && newAudioTrack) await audioSender.replaceTrack(newAudioTrack);
            }
        } catch (err) {
            console.error('Camera flip failed', err);
        }
    };

    return (
        <>
            <div className="relative w-full h-screen bg-black overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover z-0" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />

                {isFreezed && (
                    <div className="absolute inset-0 border-4 border-[#5DCAA5] pointer-events-none z-50" />
                )}

                <AIWarningBanner socket={socket} />

                <div className="absolute top-4 left-4 z-30 flex flex-col gap-2">
                    <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3">
                        <div className="font-mono text-white text-sm">SES-20260419-001</div>
                        <div className="text-white/60 text-xs mt-0.5">Expert: Dr. Sarah Chen</div>
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
                    <div className="bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 inline-flex">
                        <span className={`font-mono text-sm ${getLatencyColor()}`}>
                            Latency: {latency}ms
                        </span>
                    </div>
                </div>

                {isFreezed && (
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40">
                        <div className="px-4 py-2 bg-black/70 rounded-full border border-[#5DCAA5]">
                            <span className="text-[#5DCAA5] font-semibold">FREEZE</span>
                        </div>
                    </div>
                )}

                <div className="absolute top-36 left-4 z-40 max-w-sm">
                    <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3 inline-flex flex-col w-full">
                        <div className="text-white text-sm">
                            <span className="text-white/60">Expert:</span> Check the hydraulic seal on the left side
                        </div>
                        <div className="mt-2 h-1 bg-white/20 rounded-full overflow-hidden w-full">
                            <div className="h-full bg-[#5DCAA5] rounded-full w-3/5" />
                        </div>
                    </div>
                </div>

                <div
                    className="absolute w-5 h-5 pointer-events-none z-30 transition-all duration-500 hidden"
                    style={{
                        left: `${laserPosition.x}%`,
                        top: `${laserPosition.y}%`,
                        transform: 'translate(-50%, -50%)'
                    }}
                >
                    <div className="absolute inset-0 bg-[#5DCAA5] rounded-full animate-pulse opacity-80" />
                    <div className="absolute inset-0 bg-[#5DCAA5] rounded-full scale-150 opacity-40 animate-pulse" />
                </div>

                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm rounded-full px-6 py-3 z-30">
                    <div className="flex items-center justify-between gap-6">
                        <button
                            onClick={() => setIsMuted(!isMuted)}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 border border-white/5 shadow-md ${isMuted
                                ? 'bg-[#E24B4A]/80'
                                : 'bg-black/40 hover:bg-[#5DCAA5]/30'
                                }`}
                        >
                            {isMuted ? (
                                <MicOff className="w-5 h-5 text-white" />
                            ) : (
                                <Mic className="w-5 h-5 text-white" />
                            )}
                        </button>

                        <button
                            onClick={() => setTorchOn(!torchOn)}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 border border-white/5 shadow-md ${torchOn
                                ? 'bg-[#EF9F27]/80'
                                : 'bg-black/40 hover:bg-white/20'
                                }`}
                        >
                            {torchOn ? (
                                <Flashlight className="w-5 h-5 text-white" />
                            ) : (
                                <FlashlightOff className="w-5 h-5 text-white" />
                            )}
                        </button>

                        <button
                            onClick={flipCamera}
                            className="w-14 h-14 rounded-full bg-black/50 border border-white/5 shadow-md flex items-center justify-center hover:bg-white/20 transition-all active:scale-95 z-50 relative"
                        >
                            <CameraIcon className="w-6 h-6 text-white" />
                        </button>

                        {!showEndConfirm ? (
                            <button
                                onClick={() => setShowEndConfirm(true)}
                                className="px-6 py-3 bg-[#E24B4A] rounded-full flex items-center gap-2 hover:bg-[#E24B4A]/80 transition-all active:scale-95 shadow-md"
                            >
                                <PhoneOff className="w-4 h-4 text-white" />
                                <span className="text-white font-medium">End</span>
                            </button>
                        ) : (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowEndConfirm(false)}
                                    className="px-4 py-2 bg-white/20 rounded-full text-white text-sm hover:bg-white/30 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    className="px-4 py-2 bg-[#E24B4A] rounded-full text-white text-sm font-medium hover:bg-[#E24B4A]/80 transition-all"
                                >
                                    Confirm
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {showConnectionLost && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center">
                        <div className="text-center">
                            <WifiOff className="w-16 h-16 text-[#EF9F27] mx-auto animate-pulse" />
                            <h2 className="text-white text-2xl font-semibold mt-4">Connection Lost</h2>
                            <p className="text-white/60 text-sm mt-2">Reconnecting to server...</p>
                            <button className="mt-6 px-8 py-3 bg-[#EF9F27] text-black font-medium rounded-full hover:bg-[#EF9F27]/80 transition-all">
                                Retry Now
                            </button>
                        </div>
                    </div>
                )}

                <div className="absolute top-1/2 right-4 -translate-y-1/2 flex flex-col gap-2 z-50">
                    <button
                        onClick={() => setIsFreezed(!isFreezed)}
                        className="px-3 py-2 bg-[#5DCAA5]/80 rounded text-xs text-black font-medium"
                    >
                        {isFreezed ? 'Unfreeze' : 'Freeze'}
                    </button>
                    <button
                        onClick={() => setShowConnectionLost(!showConnectionLost)}
                        className="px-3 py-2 bg-[#EF9F27]/80 rounded text-xs text-black font-medium"
                    >
                        {showConnectionLost ? 'Reconnect' : 'Disconnect'}
                    </button>
                    <button
                        onClick={() => {
                            if (socketRef.current) {
                                socketRef.current.emit('clear-annotations', { sessionId: 'HAL-123' });
                            }
                        }}
                        className="px-3 py-2 bg-[#E24B4A]/80 rounded text-xs text-white font-medium"
                    >
                        Clear 3D
                    </button>
                </div>
            </div>
        </>
    );
}