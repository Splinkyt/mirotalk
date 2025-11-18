import { state } from '../core/state.js';
import { startPipComposite } from './pipComposer.js';

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

export function getScreenAudioTrack() {
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

function addScreenTracksToAll() {
  // Replace current outbound video with composite (if available) otherwise raw screen. Keep mic as-is.
  if (!state.screenStream) return;
  const video = state.compositeTrack || state.screenStream.getVideoTracks?.()[0] || null;
  if (video) {
    try { if ('contentHint' in video) video.contentHint = 'detail'; } catch {}
    replaceVideoTrackForAll(video);
  }
  // Also attach screen audio if available
  addScreenAudioToAll();
}

export function stopScreenTracks() {
  // Stop composite if running
  if (state.stopComposite) {
    try { state.stopComposite(); } catch {}
    state.stopComposite = null;
  }
  if (state.compositeTrack) {
    try { state.compositeTrack.stop(); } catch {}
    state.compositeTrack = null;
  }
  // Stop raw screen tracks
  if (state.screenStream) {
    try { state.screenStream.getTracks().forEach((t) => t.stop()); } catch {}
    state.screenStream = null;
  }
}

// Start screen share with audio fallback and PiP composite; returns the captured stream
export async function startScreenShare() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    console.warn('getDisplayMedia with audio failed, retrying video-only', err);
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }
  state.screenStream = stream;

  // Build composite (screen + webcam PIP) and prefer it for outbound video
  const camTrack = state.localStream?.getVideoTracks?.()[0] || null;
  try {
    const { compositeTrack, stop } = startPipComposite(state.screenStream, camTrack, {
      corner: 'br', pipWidthRatio: 0.22, margin: 16, fps: 30, round: 12,
    });
    state.compositeTrack = compositeTrack;
    state.stopComposite = stop;
  } catch (e) {
    console.warn('Failed to start PIP composite, falling back to raw screen video', e);
    state.compositeTrack = null;
    state.stopComposite = null;
  }

  // Attach tracks to peers
  addScreenTracksToAll();
  return stream;
}
