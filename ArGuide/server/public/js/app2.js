const socket = io();
const SESSION_ID = 'HAL-123';
let peer;
const localVideo = document.getElementById('localVideo');
const canvas = document.getElementById('annotationCanvas');
// 3D Engine Setup
const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// WebGL Render Loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
const statusText = document.getElementById('status');
const flipCamBtn = document.getElementById('flipCamBtn');
const clearBtn = document.getElementById('clearBtn');
let currentFacingMode = 'environment';

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (typeof THREE !== 'undefined' && camera && renderer) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
  }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

socket.on('connect', () => {
  statusText.innerText = 'Connected to Server. Waiting for camera...';
});

socket.on('user-joined', async (expertId) => {
  statusText.innerText = 'Expert joined. Negotiating Native WebRTC...';
  setupPeer(expertId);
});

socket.on('annotation', (data) => {
  if (data.tool === 'line') {
    // Convert 2D Canvas coords to Normalized Device Coordinates (-1 to +1)
    const nx1 = (data.x1 / data.canvasW) * 2 - 1;
    const ny1 = -(data.y1 / data.canvasH) * 2 + 1;
    const nx2 = (data.x2 / data.canvasW) * 2 - 1;
    const ny2 = -(data.y2 / data.canvasH) * 2 + 1;
    
    // Project exactly into the 3D space depth
    const vec1 = new THREE.Vector3(nx1, ny1, 0.5).unproject(camera);
    const vec2 = new THREE.Vector3(nx2, ny2, 0.5).unproject(camera);
    
    // Generate Neon Tube Geometry
    const path = new THREE.LineCurve3(vec1, vec2);
    const geometry = new THREE.TubeGeometry(path, 20, 0.05, 8, false);
    
    // Simple Solid Material
    const material = new THREE.MeshBasicMaterial({ 
        color: data.color || 0x00ff00
    });
    
    const tube = new THREE.Mesh(geometry, material);
    tube.userData.isAnnotation = true;
    scene.add(tube);
    
    if (!scene.getObjectByName('ambientLight')) {
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        ambient.name = 'ambientLight';
        scene.add(ambient);
    }
  }
});

function clear3DAnnotations() {
    const toRemove = [];
    scene.children.forEach(c => {
        if (c.userData.isAnnotation) toRemove.push(c);
    });
    toRemove.forEach(c => {
        scene.remove(c);
        if(c.geometry) c.geometry.dispose();
        if(c.material) c.material.dispose();
    });
}

socket.on('clear-annotations', () => {
    clear3DAnnotations();
});

clearBtn.addEventListener('click', () => {
    clear3DAnnotations();
    socket.emit('clear-annotations', { sessionId: SESSION_ID });
});

flipCamBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    try {
        let newStream;
        try {
            newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentFacingMode } }, audio: true });
        } catch (e) {
            newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        
        if (window.localStream) {
            window.localStream.getTracks().forEach(track => track.stop());
        }
        
        window.localStream = newStream;
        localVideo.srcObject = newStream;
        
        // Seamlessly swap WebRTC tracks without dropping connection!
        if (peer && peer.connectionState === 'connected') {
            const senders = peer.getSenders();
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
});

socket.on('signal', async (data) => {
  if (!peer) {
      await setupPeer(data.from);
  }
  const sig = data.signal;
  if (sig.type === 'answer') {
      await peer.setRemoteDescription(new RTCSessionDescription(sig));
  } else if (sig.type === 'candidate') {
      await peer.addIceCandidate(new RTCIceCandidate(sig.candidate));
  }
});

async function setupPeer(expertSocketId) {
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  
  peer.onicecandidate = e => {
    if (e.candidate) socket.emit('signal', { to: expertSocketId, signal: { type: 'candidate', candidate: e.candidate }});
  };
  
  peer.onconnectionstatechange = () => {
    statusText.innerText = 'Streaming to Expert: ' + peer.connectionState;
  };
  
  window.localStream.getTracks().forEach(track => peer.addTrack(track, window.localStream));
  
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit('signal', { to: expertSocketId, signal: { type: 'offer', sdp: offer.sdp }});
}

async function initCamera() {
  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: currentFacingMode } }, audio: true });
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    localVideo.srcObject = stream;
    window.localStream = stream;
    socket.emit('join-session', SESSION_ID);
  } catch (err) {
    statusText.innerText = 'Camera broken! Booting Simulation...';
    
    const simCanvas = document.createElement('canvas');
    simCanvas.width = 800; simCanvas.height = 600;
    const simCtx = simCanvas.getContext('2d');
    
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
    
    window.localStream = simCanvas.captureStream(30);
    localVideo.srcObject = window.localStream;
    statusText.innerText = 'AR Simulator Feed Connected. Connecting to Expert...';
    socket.emit('join-session', SESSION_ID);
  }
}

initCamera();
