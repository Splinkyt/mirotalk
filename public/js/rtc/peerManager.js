import { state } from '../core/state.js';
import { getScreenAudioTrack } from '../media/screenShare.js';
import { log } from '../core/logger.js';

let config = {
  remoteContainerEl: null,
  showEnableAudioUI: () => {},
  hideEnableAudioUI: () => {},
};

export function initPeerManager({ remoteContainerEl, showEnableAudioUI, hideEnableAudioUI } = {}) {
  config.remoteContainerEl = remoteContainerEl || null;
  config.showEnableAudioUI = showEnableAudioUI || (() => {});
  config.hideEnableAudioUI = hideEnableAudioUI || (() => {});
}

export function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({ iceServers: state.iceServers });

  // Track transient disconnects per PeerConnection
  let disconnectTimer = null;
  let triedIceRestart = false;

  // Add local tracks in a deterministic order to keep m-line ordering stable
  let videoSender = null;
  if (state.localStream) {
    const audios = state.localStream.getAudioTracks ? state.localStream.getAudioTracks() : [];
    const videos = state.localStream.getVideoTracks ? state.localStream.getVideoTracks() : [];
    if (audios[0]) {
      pc.addTrack(audios[0], state.localStream);
    }
    if (videos[0]) {
      videoSender = pc.addTrack(videos[0], state.localStream);
    }
  }
  // If we are currently sharing, immediately switch the outbound video to the composite (or screen) track
  if (state.screenStream) {
    const outVideo = state.compositeTrack || state.screenStream.getVideoTracks?.()[0] || null;
    if (outVideo && videoSender) {
      try { videoSender.replaceTrack(outVideo); } catch (e) { console.warn('replaceTrack(share video) failed', e); }
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
      if (state.signaling?.emitIceCandidate) state.signaling.emitIceCandidate(peerId, ev.candidate);
      else state.socket.emit('ice-candidate', { to: peerId, candidate: ev.candidate });
    }
  };

  pc.onnegotiationneeded = async () => {
    const peer = state.peers.get(peerId);
    if (!peer) return;
    if (pc.signalingState !== 'stable') return; // avoid glare/double-offers
    try {
      peer.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (state.signaling?.emitOffer) state.signaling.emitOffer(peerId, offer.sdp);
      else state.socket.emit('offer', { to: peerId, sdp: offer.sdp });
    } catch (e) {
      console.warn('negotiationneeded offer failed', e);
    } finally {
      peer.makingOffer = false;
    }
  };

  pc.ontrack = (ev) => {
    let peer = state.peers.get(peerId);
    if (!peer) {
      peer = { pc, videoEl: null, tileEl: null, screenAudioSender: null };
      state.peers.set(peerId, peer);
    }
    if (!peer.videoEl) {
      // Create tile wrapper with a per‑tile fullscreen button
      const tile = document.createElement('div');
      tile.className = 'tile';
      const videoEl = document.createElement('video');
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      // Sanitize id to be CSS/DOM-safe
      try {
        const safe = `remote-${String(peerId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
        videoEl.id = safe;
      } catch {
        videoEl.id = `remote-${Date.now()}`;
      }
      tile.appendChild(videoEl);
      const actions = document.createElement('div');
      actions.className = 'tile-actions';
      const fsBtn = document.createElement('button');
      fsBtn.className = 'secondary fs-btn';
      fsBtn.title = 'Fullscreen';
      fsBtn.setAttribute('aria-label', 'Fullscreen');
      fsBtn.type = 'button';
      fsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6" /></svg>';
      fsBtn.onclick = () => {
        try {
          const canTile = !!(tile.requestFullscreen || tile.webkitRequestFullscreen);
          const target = canTile ? tile : videoEl;
          if (target.requestFullscreen) target.requestFullscreen();
          else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
        } catch (e) { console.warn('requestFullscreen failed for remote tile', e); }
      };
      actions.appendChild(fsBtn);
      tile.appendChild(actions);
      config.remoteContainerEl?.appendChild(tile);
      peer.videoEl = videoEl;
      peer.tileEl = tile;
    }
    const [stream] = ev.streams;
    const v = peer.videoEl;
    v.srcObject = stream;
    v.muted = false;
    v.autoplay = true;
    v.playsInline = true;

    const tryPlay = () => v.play().then(() => {
      config.hideEnableAudioUI?.();
    }).catch((err) => {
      console.warn('Autoplay blocked for remote media:', err);
      config.showEnableAudioUI?.();
    });

    if (v.readyState >= 2) tryPlay();
    else v.addEventListener('loadeddata', tryPlay, { once: true });
  };

  // Debounce transient disconnects and try ICE restart before tearing down
  pc.onconnectionstatechange = async () => {
    log('pc state', peerId, pc.connectionState);

    // On recovery or while connecting again, clear pending timers
    if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      triedIceRestart = false;
      return;
    }

    if (pc.connectionState === 'disconnected') {
      // Many networks cause brief disconnects; wait to see if it recovers
      if (disconnectTimer) return; // already waiting
      disconnectTimer = setTimeout(async () => {
        disconnectTimer = null;
        // If it recovered in the meantime, do nothing
        if (pc.connectionState !== 'disconnected') return;

        // Attempt a single ICE restart to recover before teardown
        if (!triedIceRestart) {
          triedIceRestart = true;
          try {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            if (state.signaling?.emitOffer) state.signaling.emitOffer(peerId, offer.sdp);
            else state.socket.emit('offer', { to: peerId, sdp: offer.sdp });
            // Give the restart time to complete; if still not connected, remove
            setTimeout(() => { if (pc.connectionState !== 'connected') removePeer(peerId); }, 10000);
          } catch (e) {
            console.warn('ICE restart failed – removing peer', e);
            removePeer(peerId);
          }
          return;
        }

        // Already tried restart and still disconnected
        removePeer(peerId);
      }, 3000);
      return;
    }

    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removePeer(peerId);
    }
  };

  // Additional visibility for ICE health
  pc.oniceconnectionstatechange = () => log('ice state', peerId, pc.iceConnectionState);
  pc.onicecandidateerror = (e) => console.warn('icecandidateerror', peerId, e);

  const polite = (state.socket?.id || '') < peerId;
  state.peers.set(peerId, { pc, videoEl: null, screenAudioSender: screenAudioSender || null, makingOffer: false, polite });
  const p = state.peers.get(peerId);
  if (screenAudioSender && p) p.screenAudioSender = screenAudioSender;
  return pc;
}

export function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  try { peer.pc.close(); } catch {}
  if (peer.tileEl?.parentElement) peer.tileEl.parentElement.removeChild(peer.tileEl);
  else if (peer.videoEl?.parentElement) peer.videoEl.parentElement.removeChild(peer.videoEl);
  state.peers.delete(peerId);
}

export async function callPeer(peerId) {
  const pc = state.peers.get(peerId)?.pc || createPeerConnection(peerId);
  const peer = state.peers.get(peerId);
  if (!peer) return;
  if (pc.signalingState !== 'stable') return; // avoid glare
  try {
    peer.makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (state.signaling?.emitOffer) state.signaling.emitOffer(peerId, offer.sdp);
    else state.socket.emit('offer', { to: peerId, sdp: offer.sdp });
  } catch (e) {
    console.warn('callPeer offer failed', e);
  } finally {
    peer.makingOffer = false;
  }
}
