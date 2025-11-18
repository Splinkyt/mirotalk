import { state } from '../core/state.js';

// Initialize local camera and microphone and attach to provided video element
export async function initLocalMedia(localVideoEl, onUpdate) {
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
    if (localVideoEl) localVideoEl.srcObject = stream;
    // Provide processing hints to the browser
    try {
      const mic = stream.getAudioTracks?.()[0];
      if (mic && 'contentHint' in mic) mic.contentHint = 'speech';
      const cam = stream.getVideoTracks?.()[0];
      if (cam && 'contentHint' in cam) cam.contentHint = 'motion';
    } catch {}
    onUpdate?.();
    return stream;
  } catch (e) {
    alert('Failed to get camera/mic: ' + e.message);
    throw e;
  }
}

export function toggleCam(localVideoEl, onUpdate) {
  if (!state.localStream) return;
  const v = state.localStream.getVideoTracks?.()[0];
  if (v) {
    v.enabled = !v.enabled;
    try { localVideoEl?.classList?.toggle('muted', !v.enabled); } catch {}
  }
  onUpdate?.();
}

export function toggleMic(onUpdate) {
  if (!state.localStream) return;
  const a = state.localStream.getAudioTracks?.()[0];
  if (a) a.enabled = !a.enabled;
  onUpdate?.();
}
