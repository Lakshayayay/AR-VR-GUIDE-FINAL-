const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
    // Notify others in room
    socket.to(sessionId).emit('user-joined', socket.id);
  });

  socket.on('signal', (data) => {
    // data.to, data.signal
    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on('annotation', (data) => {
    // broadcast drawing to everyone in the room (including sender)
    io.to(data.sessionId).emit('annotation', data);
  });
  
  socket.on('clear-annotations', (data) => {
    io.to(data.sessionId).emit('clear-annotations');
  });

  socket.on('tracking_update', (data) => {
    socket.to(data.sessionId).emit('tracking_update', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected', socket.id);
  });

  // ========== AI CO-PILOT EVENT RELAY ==========
  socket.on('register_ai_service', (data) => {
    console.log('[Server] AI Co-Pilot service registered:', data);
    socket.join('ai_service_room');
    socket.isAIService = true;
  });

  socket.on('ai_alert', (data) => {
    const { room, alert } = data;
    io.to(room).emit('ai_alert', alert);
    console.log(`[Server] AI alert relayed to room ${room}: ${alert.title}`);
  });

  socket.on('sop_step_update', (data) => {
    const { room, ...rest } = data;
    io.to(room).emit('sop_step_update', rest);
  });

  socket.on('sign_off_result', (data) => {
    const { room, ...rest } = data;
    io.to(room).emit('sign_off_result', rest);
  });

  socket.on('request_frame_analysis', (data) => {
    io.to('ai_service_room').emit('ai_frame_capture', data);
  });

  socket.on('sop_step_completed', (data) => {
    io.to('ai_service_room').emit('sop_step_completed', data);
  });

  socket.on('request_sign_off', (data) => {
    io.to('ai_service_room').emit('request_sign_off', data);
  });

  socket.on('end_session', (data) => {
    io.to('ai_service_room').emit('session_ended', data);
  });
  // ========== END AI CO-PILOT EVENT RELAY ==========
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ArGuide Edge Server running on port ${PORT}`);
});
