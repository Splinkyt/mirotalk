const state = {
  socket: null,
  roomId: null,
  displayName: null,
  localStream: null,
  screenStream: null,
  peers: new Map(), // peerId -> { pc, streams: { cam, screen }, videoEl }
  sharedPeerId: null,
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

// ---- Autoplay / Audio unlocking helpers ----
let audioCtx = null;
function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') {
    try { audioCtx.resume(); } catch {}
  }
}

function showEnableAudioUI() {
  const btn = document.getElementById('enableAudioBtn');
  const hint = document.getElementById('enableAudioHint');
  if (btn) btn.style.display = 'inline-flex';
  if (hint) hint.style.display = 'inline';
}

function hideEnableAudioUI() {
  const btn = document.getElementById('enableAudioBtn');
  const hint = document.getElementById('enableAudioHint');
  if (btn) btn.style.display = 'none';
  if (hint) hint.style.display = 'none';
}

function resumeAllPlayback() {
  const nodes = document.querySelectorAll('#remoteVideos video');
  nodes.forEach((v) => {
    try {
      v.muted = false;
      v.autoplay = true;
      v.playsInline = true;
      if (typeof v.play === 'function') v.play().catch(() => {});
    } catch {}
  });
}
// ---- End helpers ----

function updateControls() {
  const joinBtn = $('joinBtn');
  const leaveBtn = $('leaveBtn');
  const toggleCam = $('toggleCam');
  const toggleMic = $('toggleMic');
  const shareScreen = $('shareScreen');
  const stopShare = $('stopShare');
  const fullscreenShare = $('fullscreenShare');
  const sendChat = $('sendChat');

  const connected = !!state.socket && !!state.socket.connected;
  const camTrack = state.localStream?.getVideoTracks?.()[0];
  const micTrack = state.localStream?.getAudioTracks?.()[0];
  const camEnabled = !!camTrack && camTrack.enabled !== false;
  const micEnabled = !!micTrack && micTrack.enabled !== false;
  const sharing = !!state.screenStream;
  const isFs = !!document.fullscreenElement;

  // Join/Leave
  if (joinBtn) joinBtn.disabled = connected;
  if (leaveBtn) leaveBtn.disabled = !connected;

  // Chat send only when connected
  if (sendChat) sendChat.disabled = !connected;

  // Camera button
  if (toggleCam) {
    toggleCam.disabled = !state.localStream;
    toggleCam.classList.remove('on', 'off');
    toggleCam.classList.add(camEnabled ? 'on' : 'off');
    toggleCam.textContent = camEnabled ? 'Camera On' : 'Camera Off';
  }

  // Mic button
  if (toggleMic) {
    toggleMic.disabled = !state.localStream;
    toggleMic.classList.remove('on', 'off');
    toggleMic.classList.add(micEnabled ? 'on' : 'off');
    toggleMic.textContent = micEnabled ? 'Mic On' : 'Mic Off';
  }

  // Screen share
  if (shareScreen) {
    shareScreen.disabled = sharing || !connected;
    shareScreen.classList.remove('pulse');
    shareScreen.textContent = 'Share Screen';
  }
  if (stopShare) {
    stopShare.disabled = !sharing;
    stopShare.classList.toggle('pulse', sharing);
    stopShare.textContent = sharing ? 'Sharing… Stop' : 'Stop Share';
  }

  // Fullscreen button
  if (fullscreenShare) {
    const anyVideo = sharing || remoteVideos.childElementCount > 0 || !!localVideo.srcObject;
    fullscreenShare.disabled = !anyVideo;
    fullscreenShare.textContent = isFs ? 'Exit Fullscreen' : 'Fullscreen';
  }
}

async function initLocalMedia() {
  if (state.localStream) return state.localStream;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    state.localStream = stream;
    localVideo.srcObject = stream;
    // Provide processing hints to the browser
    try {
      const mic = stream.getAudioTracks?.()[0];
      if (mic && 'contentHint' in mic) mic.contentHint = 'speech';
      const cam = stream.getVideoTracks?.()[0];
      if (cam && 'contentHint' in cam) cam.contentHint = 'motion';
    } catch {}
    updateControls();
    return stream;
  } catch (e) {
    alert('Failed to get camera/mic: ' + e.message);
    throw e;
  }
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({ iceServers: state.iceServers });

  // Add local tracks in a deterministic order to keep m-line ordering stable
  let audioSender = null;
  let videoSender = null;
  if (state.localStream) {
    const audios = state.localStream.getAudioTracks ? state.localStream.getAudioTracks() : [];
    const videos = state.localStream.getVideoTracks ? state.localStream.getVideoTracks() : [];
    if (audios[0]) {
      audioSender = pc.addTrack(audios[0], state.localStream);
    }
    if (videos[0]) {
      videoSender = pc.addTrack(videos[0], state.localStream);
    }
  }
  // If we are currently sharing, immediately switch the outbound video to the screen track
  if (state.screenStream) {
    const screenVideo = state.screenStream.getVideoTracks?.()[0];
    if (screenVideo && videoSender) {
      try { videoSender.replaceTrack(screenVideo); } catch (e) { console.warn('replaceTrack(screen) failed', e); }
    }
  }
  // If we're sharing and have a screen audio track, attach it so late joiners hear it
  let screenAudioSender = null;
  const screenAudio = getScreenAudioTrack?.() || null;
  if (state.screenStream && screenAudio) {
    try {
      try { if ('contentHint' in screenAudio) screenAudio.contentHint = 'music'; } catch {}
      screenAudioSender = pc.addTrack(screenAudio, state.localStream);
    } catch (e) {
      console.warn('addTrack(screen audio) on new PC failed', e);
    }
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      state.socket.emit('ice-candidate', { to: peerId, candidate: ev.candidate });
    }
  };

  pc.onnegotiationneeded = async () => {
    const peer = state.peers.get(peerId);
    if (!peer) return;
    // Only negotiate from a stable state to avoid glare/double-offers
    if (pc.signalingState !== 'stable') return;
    try {
      peer.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      state.socket.emit('offer', { to: peerId, sdp: offer.sdp });
    } catch (e) {
      console.warn('negotiationneeded offer failed', e);
    } finally {
      peer.makingOffer = false;
    }
  };

  pc.ontrack = (ev) => {
    let peer = state.peers.get(peerId);
    if (!peer) {
      peer = { pc, streams: {}, videoEl: null, screenAudioSender: null };
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
    const v = peer.videoEl;
    v.srcObject = stream;
    v.muted = false;
    v.autoplay = true;
    v.playsInline = true;

    const tryPlay = () => v.play().then(() => {
      hideEnableAudioUI();
    }).catch((err) => {
      console.warn('Autoplay blocked for remote media:', err);
      showEnableAudioUI();
    });

    if (v.readyState >= 2) tryPlay();
    else v.addEventListener('loadeddata', tryPlay, { once: true });
  };

  pc.onconnectionstatechange = () => {
    log('pc state', peerId, pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
      removePeer(peerId);
    }
  };

  const polite = (state.socket?.id || '') < peerId;
  state.peers.set(peerId, { pc, streams: {}, videoEl: null, screenAudioSender: null, makingOffer: false, ignoreOffer: false, isSettingRemoteAnswerPending: false, polite });
  const p = state.peers.get(peerId);
  if (screenAudioSender && p) p.screenAudioSender = screenAudioSender;
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
  const peer = state.peers.get(peerId);
  if (!peer) return;
  if (pc.signalingState !== 'stable') return; // avoid glare
  try {
    peer.makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.socket.emit('offer', { to: peerId, sdp: offer.sdp });
  } catch (e) {
    console.warn('callPeer offer failed', e);
  } finally {
    peer.makingOffer = false;
  }
}

function addLocalTracksToAll() {
  for (const [peerId, peer] of state.peers.entries()) {
    const senders = peer.pc.getSenders();
    if (state.localStream) {
      const audios = state.localStream.getAudioTracks ? state.localStream.getAudioTracks() : [];
      const videos = state.localStream.getVideoTracks ? state.localStream.getVideoTracks() : [];
      // Audio first
      for (const track of audios) {
        const sender = senders.find((s) => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(track);
        else peer.pc.addTrack(track, state.localStream);
      }
      // Then video
      for (const track of videos) {
        const sender = senders.find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(track);
        else peer.pc.addTrack(track, state.localStream);
      }
    }
  }
}

function replaceVideoTrackForAll(newVideoTrack) {
  if (!newVideoTrack) return;
  for (const [, peer] of state.peers.entries()) {
    const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      try {
        sender.replaceTrack(newVideoTrack);
      } catch (e) {
        console.warn('replaceTrack failed', e);
      }
    }
  }
}

function getScreenAudioTrack() {
  return state.screenStream?.getAudioTracks?.()[0] || null;
}

function addScreenAudioToAll() {
  const audio = getScreenAudioTrack();
  if (!audio) return;
  try { if ('contentHint' in audio) audio.contentHint = 'music'; } catch {}
  for (const [, peer] of state.peers.entries()) {
    if (peer.screenAudioSender && peer.pc.getSenders().includes(peer.screenAudioSender)) continue;
    try {
      // Attach using the same stream reference to keep MSID consistent with the camera stream.
      const sender = peer.pc.addTrack(audio, state.localStream);
      peer.screenAudioSender = sender;
    } catch (e) {
      console.warn('addTrack(screen audio) failed', e);
    }
  }
}

function removeScreenAudioFromAll() {
  for (const [, peer] of state.peers.entries()) {
    const sender = peer.screenAudioSender;
    if (!sender) continue;
    try {
      peer.pc.removeTrack(sender);
    } catch (e) {
      console.warn('removeTrack(screen audio) failed', e);
    }
    peer.screenAudioSender = null;
  }
}

function addScreenTracksToAll() {
  // Replace current outbound video with screen video (no extra transceivers). Keep mic as-is.
  if (!state.screenStream) return;
  const screenVideo = state.screenStream.getVideoTracks?.()[0];
  if (screenVideo) {
    // Hint: screen content benefits from "detail" hint for clarity.
    try { screenVideo.contentHint = 'detail'; } catch {}
    replaceVideoTrackForAll(screenVideo);
  }
  // Also attach screen audio if available
  addScreenAudioToAll();
}

function stopScreenTracks() {
  if (!state.screenStream) return;
  state.screenStream.getTracks().forEach((t) => t.stop());
  state.screenStream = null;
  updateControls();
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFullscreen(elem) {
  try {
    if (elem.requestFullscreen) {
      await elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    }
  } catch (e) {
    console.warn('enterFullscreen failed', e);
  }
}

async function exitFullscreen() {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch (e) {
    console.warn('exitFullscreen failed', e);
  }
}

function findSharedVideoEl() {
  // Prefer the remote video element of the participant who is sharing
  if (state.sharedPeerId) {
    const peer = state.peers.get(state.sharedPeerId);
    if (peer?.videoEl) return peer.videoEl;
  }
  // Fallback to any remote video if present
  const anyRemote = remoteVideos.querySelector('video');
  if (anyRemote) return anyRemote;
  // Fallback to local if available
  if (localVideo?.srcObject) return localVideo;
  return null;
}

function toggleFullscreen() {
  if (isFullscreen()) {
    exitFullscreen();
  } else {
    const target = findSharedVideoEl() || document.querySelector('main') || document.documentElement;
    enterFullscreen(target);
  }
  // Defer UI update until after the state changes
  setTimeout(updateControls, 0);
}

function wireUI() {
  $('joinBtn').onclick = async () => {
    state.displayName = $('displayName').value || 'Guest';
    state.roomId = $('roomId').value || 'demo';
    await initLocalMedia();
    connectSocket();
    updateControls();
  };

  $('leaveBtn').onclick = () => {
    if (state.roomId) {
      state.socket?.emit('leave');
    }
    for (const id of [...state.peers.keys()]) removePeer(id);
    setStatus('Disconnected');
    state.socket?.disconnect();
    stopScreenTracks();
    updateControls();
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
    updateControls();
  };

  $('toggleMic').onclick = () => {
    if (!state.localStream) return;
    const a = state.localStream.getAudioTracks()[0];
    if (a) { a.enabled = !a.enabled; }
    updateControls();
  };

  $('shareScreen').onclick = async () => {
    try {
      // Request screen with audio; browsers typically only provide system/tab audio for tab capture
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (err) {
        // Fallback: if audio capture is not permitted/supported, retry without audio
        console.warn('getDisplayMedia with audio failed, retrying video-only', err);
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      state.screenStream = stream;
      // Hint the sharer if no screen audio track was captured (common on desktop without enabling the toggle)
      try {
        const hasScreenAudio = !!(state.screenStream?.getAudioTracks?.().length);
        if (!hasScreenAudio) {
          appendChat({ from: 'system', message: 'No screen audio captured. In Chrome/Edge share a Tab and enable “Share tab audio”. On Windows Entire screen, enable “Share system audio”. On macOS only Tab audio works.', ts: Date.now() });
        }
      } catch {}
      addScreenTracksToAll();
      state.socket?.emit('screen-share', { roomId: state.roomId, action: 'start' });
      // Mark ourselves as the current sharer locally as well
      state.sharedPeerId = state.socket?.id || null;
      updateControls();
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        $('stopShare').click();
      });
    } catch (e) {
      console.warn('Share screen cancelled or failed', e);
    }
  };

  const enableBtn = document.getElementById('enableAudioBtn');
  if (enableBtn) {
    enableBtn.onclick = () => {
      unlockAudio();
      resumeAllPlayback();
      hideEnableAudioUI();
    };
  }

  // As a safety net, a one-time global click to unlock audio and resume playback
  document.addEventListener('click', () => {
    unlockAudio();
    resumeAllPlayback();
    hideEnableAudioUI();
  }, { once: true });

  $('stopShare').onclick = () => {
    // Switch outgoing video back to camera before stopping the screen stream
    const camTrack = state.localStream?.getVideoTracks?.()[0] || null;
    if (camTrack) {
      try { camTrack.contentHint = 'motion'; } catch {}
    }
    for (const [, peer] of state.peers.entries()) {
      const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        try { sender.replaceTrack(camTrack); } catch (e) { console.warn('replaceTrack(cam) failed', e); }
      }
    }

    // Detach any screen audio sender before stopping tracks
    removeScreenAudioFromAll();

    // Now stop the screen tracks and notify others
    stopScreenTracks();
    state.socket?.emit('screen-share', { roomId: state.roomId, action: 'stop' });
    if (state.sharedPeerId === state.socket?.id) state.sharedPeerId = null;
    updateControls();
  };

  const fsBtn = $('fullscreenShare');
  if (fsBtn) fsBtn.onclick = toggleFullscreen;

  // Update UI when fullscreen state changes (Esc or programmatically)
  document.addEventListener('fullscreenchange', updateControls);
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  const socket = window.io();
  state.socket = socket;

  socket.on('connect', () => {
    setStatus('Connected');
    socket.emit('join', { roomId: state.roomId, displayName: state.displayName });
    updateControls();
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
    const peer = state.peers.get(from);
    if (!peer) return;
    const offer = { type: 'offer', sdp };
    const offerCollision = peer.makingOffer || pc.signalingState !== 'stable';
    const ignore = !peer.polite && offerCollision;
    if (ignore) {
      console.warn('[signaling] Ignoring offer due to collision');
      return;
    }
    try {
      if (offerCollision) {
        try { await pc.setLocalDescription({ type: 'rollback' }); } catch (e) { console.warn('rollback failed (safe to ignore)', e); }
      }
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      state.socket.emit('answer', { to: from, sdp: answer.sdp });
    } catch (e) {
      console.warn('Error handling remote offer', e);
    }
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
    if (state.sharedPeerId === id) {
      state.sharedPeerId = null;
      updateControls();
    }
  });

  socket.on('screen-share', ({ participantId, action }) => {
    appendChat({ from: participantId, message: `screen ${action}`, ts: Date.now() });
    if (action === 'start') {
      state.sharedPeerId = participantId;
    } else if (action === 'stop') {
      if (state.sharedPeerId === participantId) state.sharedPeerId = null;
    }
    updateControls();
  });

  socket.on('disconnect', () => {
    setStatus('Disconnected');
    updateControls();
  });
}

(async function main() {
  wireUI();
  try {
    await initLocalMedia();
  } catch {}
  updateControls();
})();
