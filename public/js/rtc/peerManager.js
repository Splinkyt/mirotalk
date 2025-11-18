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
      peer = { pc, videoEl: null, screenAudioSender: null };
      state.peers.set(peerId, peer);
    }
    if (!peer.videoEl) {
      const videoEl = document.createElement('video');
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.id = `remote-${peerId}`;
      config.remoteContainerEl?.appendChild(videoEl);
      peer.videoEl = videoEl;
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

  pc.onconnectionstatechange = () => {
    log('pc state', peerId, pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
      removePeer(peerId);
    }
  };

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
  if (peer.videoEl?.parentElement) peer.videoEl.parentElement.removeChild(peer.videoEl);
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
