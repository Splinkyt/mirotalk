const state = {
  socket: null,
  roomId: null,
  displayName: null,
  localStream: null,
  screenStream: null,
  peers: new Map(), // peerId -> { pc, streams: { cam, screen }, videoEl }
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const localVideo = $('localVideo');
const remoteVideos = $('remoteVideos');

function log(...args) {
  console.log('[MVP]', ...args);
}

function appendChat({ from, message, ts }) {
  const logEl = $('chatLog');
  const div = document.createElement('div');
  const time = new Date(ts || Date.now()).toLocaleTimeString();
  div.textContent = `[${time}] ${from === state.socket?.id ? 'You' : from}: ${message}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function initLocalMedia() {
  if (state.localStream) return state.localStream;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    state.localStream = stream;
    localVideo.srcObject = stream;
    return stream;
  } catch (e) {
    alert('Failed to get camera/mic: ' + e.message);
    throw e;
  }
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({ iceServers: state.iceServers });

  // Add local tracks
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => pc.addTrack(t, state.localStream));
  }
  if (state.screenStream) {
    state.screenStream.getTracks().forEach((t) => pc.addTrack(t, state.screenStream));
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      state.socket.emit('ice-candidate', { to: peerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = (ev) => {
    let peer = state.peers.get(peerId);
    if (!peer) {
      peer = { pc, streams: {}, videoEl: null };
      state.peers.set(peerId, peer);
    }
    if (!peer.videoEl) {
      const videoEl = document.createElement('video');
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.id = `remote-${peerId}`;
      remoteVideos.appendChild(videoEl);
      peer.videoEl = videoEl;
    }
    const [stream] = ev.streams;
    peer.videoEl.srcObject = stream;
  };

  pc.onconnectionstatechange = () => {
    log('pc state', peerId, pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
      removePeer(peerId);
    }
  };

  state.peers.set(peerId, { pc, streams: {}, videoEl: null });
  return pc;
}

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  try { peer.pc.getSenders().forEach((s) => { try { s.track && s.track.stop && s.track.readyState === 'ended'; } catch {} }); } catch {}
  try { peer.pc.close(); } catch {}
  if (peer.videoEl?.parentElement) peer.videoEl.parentElement.removeChild(peer.videoEl);
  state.peers.delete(peerId);
}

async function callPeer(peerId) {
  const pc = state.peers.get(peerId)?.pc || createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit('offer', { to: peerId, sdp: offer.sdp });
}

function addLocalTracksToAll() {
  for (const [peerId, peer] of state.peers.entries()) {
    const senders = peer.pc.getSenders();
    if (state.localStream) {
      for (const track of state.localStream.getTracks()) {
        const kind = track.kind;
        const sender = senders.find((s) => s.track && s.track.kind === kind);
        if (sender) sender.replaceTrack(track);
        else peer.pc.addTrack(track, state.localStream);
      }
    }
  }
}

function addScreenTracksToAll() {
  for (const [, peer] of state.peers.entries()) {
    if (state.screenStream) {
      for (const track of state.screenStream.getTracks()) {
        peer.pc.addTrack(track, state.screenStream);
      }
    }
  }
}

function stopScreenTracks() {
  if (!state.screenStream) return;
  state.screenStream.getTracks().forEach((t) => t.stop());
  state.screenStream = null;
}

function wireUI() {
  $('joinBtn').onclick = async () => {
    state.displayName = $('displayName').value || 'Guest';
    state.roomId = $('roomId').value || 'demo';
    await initLocalMedia();
    connectSocket();
  };

  $('leaveBtn').onclick = () => {
    if (state.roomId) {
      state.socket?.emit('leave');
    }
    for (const id of [...state.peers.keys()]) removePeer(id);
    setStatus('Disconnected');
    state.socket?.disconnect();
    stopScreenTracks();
  };

  $('sendChat').onclick = () => {
    const text = $('chatInput').value.trim();
    if (!text) return;
    state.socket?.emit('chat', { roomId: state.roomId, message: text });
    $('chatInput').value = '';
  };

  $('toggleCam').onclick = () => {
    if (!state.localStream) return;
    const v = state.localStream.getVideoTracks()[0];
    if (v) { v.enabled = !v.enabled; localVideo.classList.toggle('muted', !v.enabled); }
  };

  $('toggleMic').onclick = () => {
    if (!state.localStream) return;
    const a = state.localStream.getAudioTracks()[0];
    if (a) { a.enabled = !a.enabled; }
  };

  $('shareScreen').onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      state.screenStream = stream;
      addScreenTracksToAll();
      state.socket?.emit('screen-share', { roomId: state.roomId, action: 'start' });
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        $('stopShare').click();
      });
    } catch (e) {
      console.warn('Share screen cancelled or failed', e);
    }
  };

  $('stopShare').onclick = () => {
    stopScreenTracks();
    state.socket?.emit('screen-share', { roomId: state.roomId, action: 'stop' });
  };
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  const socket = window.io();
  state.socket = socket;

  socket.on('connect', () => {
    setStatus('Connected');
    socket.emit('join', { roomId: state.roomId, displayName: state.displayName });
  });

  socket.on('joined', async ({ participants }) => {
    log('joined', participants);
    // MVP anti-glare: do NOT initiate offers here. Existing participants will call us on 'participant-joined'.
  });

  socket.on('participant-joined', async ({ id, displayName }) => {
    log('participant-joined', id, displayName);
    // Initiator can start offer as well
    await callPeer(id);
  });

  socket.on('offer', async ({ from, sdp }) => {
    const pc = state.peers.get(from)?.pc || createPeerConnection(from);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.socket.emit('answer', { to: from, sdp: answer.sdp });
  });

  socket.on('answer', async ({ from, sdp }) => {
    const pc = state.peers.get(from)?.pc;
    if (!pc) return;
    // Guard against glare: only set remote answer if we are in have-local-offer state
    if (pc.signalingState !== 'have-local-offer') {
      console.warn('Ignoring answer: unexpected signalingState', pc.signalingState);
      return;
    }
    await pc.setRemoteDescription({ type: 'answer', sdp });
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = state.peers.get(from)?.pc;
    if (!pc) return;
    try { await pc.addIceCandidate(candidate); } catch (e) { console.warn('addIceCandidate failed', e); }
  });

  socket.on('chat', (payload) => appendChat(payload));

  socket.on('participant-left', ({ id }) => {
    removePeer(id);
  });

  socket.on('screen-share', ({ participantId, action }) => {
    appendChat({ from: participantId, message: `screen ${action}`, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    setStatus('Disconnected');
  });
}

(async function main() {
  wireUI();
  try {
    await initLocalMedia();
  } catch {}
})();
