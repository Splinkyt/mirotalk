import { $ } from '../core/dom.js';
import { log } from '../core/logger.js';
import { state } from '../core/state.js';
import { unlockAudio, showEnableAudioUI, hideEnableAudioUI, resumeAllPlayback } from '../media/audioUnlock.js';
import { createChat } from '../ui/chat.js';
import { connect as connectSignaling } from '../signaling/socket.js';
import { initLocalMedia as initLocalMediaModule, toggleCam as toggleCamControl, toggleMic as toggleMicControl } from '../media/localMedia.js';
import { startScreenShare, stopScreenTracks } from '../media/screenShare.js';
import { initPeerManager, createPeerConnection, removePeer, callPeer } from '../rtc/peerManager.js';

export async function init() {
  const statusEl = $('status');
  const localVideo = $('localVideo');
  const remoteVideos = $('remoteVideos');
  const chatLogEl = $('chatLog');
  const chatInputEl = $('chatInput');
  const sendChatBtn = $('sendChat');

  // Initialize chat UI module
  const chatUI = createChat({
    logEl: chatLogEl,
    inputEl: chatInputEl,
    sendBtn: sendChatBtn,
    getSelfId: () => state.socket?.id,
    onSend: (text) => {
      // Prefer signaling wrapper if available; fall back to raw socket
      if (state.signaling?.sendChat) state.signaling.sendChat(text);
      else state.socket?.emit('chat', { roomId: state.roomId, message: text });
    }
  });

  // Initialize peer manager (handles remote video elements and autoplay UI)
  initPeerManager({
    remoteContainerEl: remoteVideos,
    showEnableAudioUI,
    hideEnableAudioUI,
  });

  function appendChat({ from, message, ts }) {
    chatUI.append({ from, message, ts });
  }

  function setStatus(text) { statusEl.textContent = text; }

  function updateControls() {
    const joinBtn = $('joinBtn');
    const leaveBtn = $('leaveBtn');
    const toggleCam = $('toggleCam');
    const toggleMic = $('toggleMic');
    const shareScreen = $('shareScreen');
    const stopShare = $('stopShare');
    const shareToggle = document.getElementById('shareToggle');
    const sendChat = $('sendChat');

    const connected = !!state.socket && !!state.socket.connected;
    const camTrack = state.localStream?.getVideoTracks?.()[0];
    const micTrack = state.localStream?.getAudioTracks?.()[0];
    const camEnabled = !!camTrack && camTrack.enabled !== false;
    const micEnabled = !!micTrack && micTrack.enabled !== false;
    const sharing = !!state.screenStream;
    const isFs = !!document.fullscreenElement;

    if (joinBtn) joinBtn.disabled = connected;
    if (leaveBtn) leaveBtn.disabled = !connected;
    if (sendChat) sendChat.disabled = !connected;

    if (toggleCam) {
      toggleCam.disabled = !state.localStream;
      toggleCam.classList.remove('on', 'off');
      toggleCam.classList.add(camEnabled ? 'on' : 'off');
      // icon-only — do not change inner content
      // HIG-friendly: reflect toggle state for assistive tech
      try { toggleCam.setAttribute('aria-pressed', String(!!camEnabled)); } catch {}
    }

    if (toggleMic) {
      toggleMic.disabled = !state.localStream;
      toggleMic.classList.remove('on', 'off');
      toggleMic.classList.add(micEnabled ? 'on' : 'off');
      // icon-only — do not change inner content
      // HIG-friendly: reflect toggle state for assistive tech
      try { toggleMic.setAttribute('aria-pressed', String(!!micEnabled)); } catch {}
    }

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

    if (shareToggle) {
      shareToggle.disabled = !connected;
      shareToggle.classList.toggle('danger', sharing);
      shareToggle.classList.toggle('is-sharing', sharing);
      shareToggle.classList.toggle('pulse', sharing);
      try {
        shareToggle.setAttribute('aria-label', sharing ? 'Stop sharing' : 'Share screen');
        shareToggle.title = sharing ? 'Stop sharing' : 'Share screen';
      } catch {}
    }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  async function enterFullscreen(elem) {
    try {
      if (elem.requestFullscreen) await elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    } catch (e) { console.warn('enterFullscreen failed', e); }
  }
  async function exitFullscreen() {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) { console.warn('exitFullscreen failed', e); }
  }
  function findSharedVideoEl() {
    if (state.sharedPeerId) {
      const peer = state.peers.get(state.sharedPeerId);
      if (peer?.videoEl) return peer.videoEl;
    }
    const anyRemote = remoteVideos.querySelector('video');
    if (anyRemote) return anyRemote;
    if (localVideo?.srcObject) return localVideo;
    return null;
  }
  // local tile fullscreen button handler will request fullscreen on local tile

  function wireUI() {
    $('joinBtn').onclick = async () => {
      const joinScreen = document.getElementById('join-screen');
      try {
        state.displayName = $('displayName').value || 'Guest';
        state.roomId = $('roomId').value || 'demo';
        
        // Hide Join Screen temporarily (optimistic)
        if (joinScreen) joinScreen.classList.add('hidden');
        
        await initLocalMediaModule(localVideo, updateControls);
        connectSocket();
        updateControls();
      } catch (e) {
        console.error('Join failed', e);
        // Restore Join Screen on error
        if (joinScreen) joinScreen.classList.remove('hidden');
      }
    };

    $('leaveBtn').onclick = () => {
      if (state.roomId) {
        if (state.signaling?.leave) state.signaling.leave();
        else state.socket?.emit('leave');
      }
      for (const id of [...state.peers.keys()]) removePeer(id);
      setStatus('Disconnected');
      state.socket?.disconnect();
      stopScreenTracks();
      updateControls();
      
      // Show Join Screen
      const joinScreen = document.getElementById('join-screen');
      if (joinScreen) joinScreen.classList.remove('hidden');
    };

    // Chat send is handled by chat module initialization

    $('toggleCam').onclick = () => { toggleCamControl(localVideo, updateControls); };
    $('toggleMic').onclick = () => { toggleMicControl(updateControls); };

    let isSharingStarting = false;
    $('shareScreen').onclick = async () => {
      if (isSharingStarting) return;
      isSharingStarting = true;
      try {
        const stream = await startScreenShare();
        try {
          const hasScreenAudio = !!(stream?.getAudioTracks?.().length);
          if (!hasScreenAudio) {
            appendChat({ from: 'system', message: 'No screen audio captured. In Chrome/Edge share a Tab and enable “Share tab audio”. On Windows Entire screen, enable “Share system audio”. On macOS only Tab audio works.', ts: Date.now() });
          }
        } catch {}
        if (state.signaling?.emitScreenShare) state.signaling.emitScreenShare('start');
        else state.socket?.emit('screen-share', { roomId: state.roomId, action: 'start' });
        state.sharedPeerId = state.socket?.id || null;
        updateControls();
        stream.getVideoTracks()[0].addEventListener('ended', () => { $('stopShare').click(); });
      } catch (e) { console.warn('Share screen cancelled or failed', e); }
      finally { isSharingStarting = false; }
    };

    $('stopShare').onclick = () => {
      // Switch back to camera on all peers
      try {
        const camTrack = state.localStream?.getVideoTracks?.()[0];
        if (camTrack) {
          for (const [, peer] of state.peers.entries()) {
            const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
            if (sender) {
              try { sender.replaceTrack(camTrack); } catch (e) { console.warn('replaceTrack(cam) failed', e); }
            }
          }
        }
      } catch {}

      // Detach any screen audio sender before stopping tracks
      try {
        for (const [, peer] of state.peers.entries()) {
          const sender = peer.screenAudioSender;
          if (!sender) continue;
          try { peer.pc.removeTrack(sender); } catch (e) { console.warn('removeTrack(screen audio) failed', e); }
          peer.screenAudioSender = null;
        }
      } catch {}

      stopScreenTracks();
      if (state.signaling?.emitScreenShare) state.signaling.emitScreenShare('stop');
      else state.socket?.emit('screen-share', { roomId: state.roomId, action: 'stop' });
      if (state.sharedPeerId === state.socket?.id) state.sharedPeerId = null;
      updateControls();
    };

    // New unified share toggle (icon button in bottom toolbar)
    const shareToggle = document.getElementById('shareToggle');
    if (shareToggle) {
      shareToggle.onclick = () => {
        if (state.screenStream) $('stopShare').onclick();
        else $('shareScreen').onclick();
      };
    }

    // Local tile fullscreen button
    const localFsBtn = document.getElementById('localFsBtn');
    const localTile = document.getElementById('localTile');
    if (localFsBtn && localTile) {
      localFsBtn.onclick = async () => {
        if (isFullscreen()) await exitFullscreen();
        else await enterFullscreen(localTile);
      };
    }
    document.addEventListener('fullscreenchange', updateControls);

    const enableBtn = document.getElementById('enableAudioBtn');
    if (enableBtn) {
      enableBtn.onclick = () => {
        unlockAudio();
        resumeAllPlayback();
        hideEnableAudioUI();
      };
    }

    // Global one-time gesture to unlock audio and resume playback (convenience)
    document.addEventListener('click', () => {
      unlockAudio();
      resumeAllPlayback();
      hideEnableAudioUI();
    }, { once: true });
  }

  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    const signaling = connectSignaling({
      roomId: state.roomId,
      displayName: state.displayName,
      handlers: {
        onConnect: (sock) => { state.socket = sock; setStatus('Connected'); updateControls(); },
        onJoined: ({ participants }) => { log('joined', participants); },
        onParticipantJoined: async ({ id, displayName }) => { log('participant-joined', id, displayName); await callPeer(id); },
        onOffer: async ({ from, sdp }) => {
          const pc = state.peers.get(from)?.pc || createPeerConnection(from);
          const peer = state.peers.get(from);
          if (!peer) return;
          const offer = { type: 'offer', sdp };
          const offerCollision = peer.makingOffer || pc.signalingState !== 'stable';
          const ignore = !peer.polite && offerCollision;
          if (ignore) { console.warn('[signaling] Ignoring offer due to collision'); return; }
          try {
            if (offerCollision) {
              try { await pc.setLocalDescription({ type: 'rollback' }); } catch (e) { console.warn('rollback failed (safe to ignore)', e); }
            }
            await pc.setRemoteDescription(offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (state.signaling?.emitAnswer) state.signaling.emitAnswer(from, answer.sdp);
            else state.socket.emit('answer', { to: from, sdp: answer.sdp });
          } catch (e) { console.warn('Error handling remote offer', e); }
        },
        onAnswer: async ({ from, sdp }) => {
          const pc = state.peers.get(from)?.pc; if (!pc) return;
          if (pc.signalingState !== 'have-local-offer') { console.warn('Ignoring answer: unexpected signalingState', pc.signalingState); return; }
          await pc.setRemoteDescription({ type: 'answer', sdp });
        },
        onIceCandidate: async ({ from, candidate }) => {
          const pc = state.peers.get(from)?.pc; if (!pc) return;
          try { await pc.addIceCandidate(candidate); } catch (e) { console.warn('addIceCandidate failed', e); }
        },
        onChat: (payload) => appendChat(payload),
        onParticipantLeft: ({ id }) => {
          removePeer(id);
          if (state.sharedPeerId === id) { state.sharedPeerId = null; updateControls(); }
        },
        onScreenShare: ({ participantId, action }) => {
          appendChat({ from: participantId, message: `screen ${action}`, ts: Date.now() });
          if (action === 'start') state.sharedPeerId = participantId;
          else if (action === 'stop') { if (state.sharedPeerId === participantId) state.sharedPeerId = null; }
          updateControls();
        },
        onDisconnect: () => { setStatus('Disconnected'); updateControls(); },
      },
    });
    state.signaling = signaling;
    state.socket = signaling.socket;
  }

  // Wire UI and attempt local media for preview
  wireUI();
  try { await initLocalMediaModule(localVideo, updateControls); } catch {}
  updateControls();
}
