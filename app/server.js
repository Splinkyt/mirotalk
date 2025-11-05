import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Simple in-memory rooms registry
const rooms = new Map(); // roomId -> Map(socketId -> { displayName })

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// Serve static client
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

io.on('connection', (socket) => {
  let joinedRoomId = null;

  socket.on('join', ({ roomId, displayName }) => {
    if (!roomId) return;

    joinedRoomId = String(roomId);
    if (!rooms.has(joinedRoomId)) {
      rooms.set(joinedRoomId, new Map());
    }
    const room = rooms.get(joinedRoomId);
    room.set(socket.id, { displayName: displayName || `Guest-${socket.id.slice(0, 4)}` });

    socket.join(joinedRoomId);

    // Notify the new client about current participants
    const participants = Array.from(room.entries()).map(([id, meta]) => ({ id, displayName: meta.displayName }));
    socket.emit('joined', { participants });

    // Notify others
    socket.to(joinedRoomId).emit('participant-joined', { id: socket.id, displayName: room.get(socket.id).displayName });
  });

  socket.on('offer', ({ to, sdp }) => {
    if (to && sdp) io.to(to).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ to, sdp }) => {
    if (to && sdp) io.to(to).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    if (to && candidate) io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat', ({ roomId, message }) => {
    if (!roomId || !message) return;
    io.to(roomId).emit('chat', { from: socket.id, message, ts: Date.now() });
  });

  socket.on('screen-share', ({ roomId, action }) => {
    if (!roomId || !action) return;
    socket.to(roomId).emit('screen-share', { participantId: socket.id, action });
  });

  const leaveRoom = () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (room) {
      room.delete(socket.id);
      socket.to(joinedRoomId).emit('participant-left', { id: socket.id });
      if (room.size === 0) rooms.delete(joinedRoomId);
    }
    socket.leave(joinedRoomId);
    joinedRoomId = null;
  };

  socket.on('leave', () => leaveRoom());
  socket.on('disconnect', () => leaveRoom());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
