// Socket.IO signaling wrapper without bundler
// Exposes a connect() that wires events and returns helpers

export function connect({ roomId, displayName, handlers = {} }) {
  const socket = window.io();

  socket.on('connect', () => {
    try { handlers.onConnect?.(socket); } catch {}
    socket.emit('join', { roomId, displayName });
  });

  socket.on('joined', (payload) => {
    try { handlers.onJoined?.(payload); } catch {}
  });

  socket.on('participant-joined', (payload) => {
    try { handlers.onParticipantJoined?.(payload); } catch {}
  });

  socket.on('offer', (payload) => {
    try { handlers.onOffer?.(payload); } catch {}
  });

  socket.on('answer', (payload) => {
    try { handlers.onAnswer?.(payload); } catch {}
  });

  socket.on('ice-candidate', (payload) => {
    try { handlers.onIceCandidate?.(payload); } catch {}
  });

  socket.on('chat', (payload) => {
    try { handlers.onChat?.(payload); } catch {}
  });

  socket.on('participant-left', (payload) => {
    try { handlers.onParticipantLeft?.(payload); } catch {}
  });

  socket.on('screen-share', (payload) => {
    try { handlers.onScreenShare?.(payload); } catch {}
  });

  socket.on('disconnect', () => {
    try { handlers.onDisconnect?.(); } catch {}
  });

  return {
    socket,
    sendChat(message) { socket.emit('chat', { roomId, message }); },
    leave() { socket.emit('leave'); },
    emitOffer(to, sdp) { socket.emit('offer', { to, sdp }); },
    emitAnswer(to, sdp) { socket.emit('answer', { to, sdp }); },
    emitIceCandidate(to, candidate) { socket.emit('ice-candidate', { to, candidate }); },
    emitScreenShare(action) { socket.emit('screen-share', { roomId, action }); },
    disconnect() { socket.disconnect(); }
  };
}
