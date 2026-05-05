const socket = io();
const SESSION_ID = 'HAL-123'; // Hardcoded for MVP
let peer;
const localVideo = document.getElementById('localVideo');
const canvas = document.getElementById('annotationCanvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

socket.on('connect', () => {
  statusText.innerText = 'Connected to Server. Waiting for camera...';
  // Removed immediate join-session so we only join after video is ready!
});

socket.on('user-joined', (expertId) => {
  statusText.innerText = 'Expert joined. Negotiating WebRTC...';
  // Initiating connection with expert
  setupPeer(expertId, true);
});

socket.on('signal', (data) => {
  if (!peer) {
    setupPeer(data.from, false);
  }
  peer.signal(data.signal);
});

socket.on('annotation', (data) => {
  if (data.tool === 'line') {
    const rx = canvas.width / data.canvasW;
    const ry = canvas.height / data.canvasH;
    ctx.beginPath();
    ctx.moveTo(data.x1 * rx, data.y1 * ry);
    ctx.lineTo(data.x2 * rx, data.y2 * ry);
    ctx.strokeStyle = data.color || '#00ff00';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
});

socket.on('clear-annotations', () => {
  ctx.clearRect(0,0, canvas.width, canvas.height);
});

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    localVideo.srcObject = stream;
    window.localStream = stream;
    socket.emit('join-session', SESSION_ID);
  } catch (err) {
    statusText.innerText = 'Camera Locked by another App!';
    console.error('Camera Error:', err);
    
    // Create a fake "No Camera" video stream as a fallback 
    // so WebRTC can still send data and you can test drawing!
    statusText.innerText = 'Camera broken! Booting Simulation...';
    
    const simCanvas = document.createElement('canvas');
    simCanvas.width = 800; simCanvas.height = 600;
    const simCtx = simCanvas.getContext('2d');
    
    let frame = 0;
    setInterval(() => {
        // Draw spinning radar / animated gradient
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
        simCtx.fillText('Camera Hardware Locked securely - Using AR Test Target', 60, 50);
        
        frame++;
    }, 1000 / 30);
    
    window.localStream = simCanvas.captureStream(30);
    localVideo.srcObject = window.localStream;
    statusText.innerText = 'AR Simulator Feed Connected';
    socket.emit('join-session', SESSION_ID);
  }
}

function setupPeer(expertSocketId, initiator) {
  peer = new SimplePeer({
    initiator: initiator,
    stream: window.localStream
  });

  peer.on('signal', signal => {
    socket.emit('signal', { to: expertSocketId, signal: signal });
  });

  peer.on('connect', () => {
    statusText.innerText = 'Streaming to Expert';
  });
  
  peer.on('error', err => console.log('Peer error', err));
}

initCamera();
