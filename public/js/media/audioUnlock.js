// Cross-browser audio unlock and UI helpers (Safari/iOS friendly)
let audioCtx = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume?.();
    }
  } catch (_) {
    // ignore
  }
}

export function showEnableAudioUI() {
  const btn = document.getElementById('enableAudioBtn');
  const hint = document.getElementById('enableAudioHint');
  if (btn) btn.style.display = 'inline-flex';
  if (hint) hint.style.display = 'inline';
}

export function hideEnableAudioUI() {
  const btn = document.getElementById('enableAudioBtn');
  const hint = document.getElementById('enableAudioHint');
  if (btn) btn.style.display = 'none';
  if (hint) hint.style.display = 'none';
}

export function resumeAllPlayback() {
	// Only unmute actual remote participant videos.
	// Remote tiles are created in peerManager with ids of the form `remote-${peerId}`.
	// The local preview (`localVideo`) lives in the same container but must remain
	// muted to avoid feeding the microphone back to the speakers.
	const nodes = document.querySelectorAll('#remoteVideos video[id^="remote-"]');
	nodes.forEach((v) => {
		try {
			v.muted = false; // allow audio
			v.autoplay = true;
			v.playsInline = true; // Safari iOS
			if (typeof v.play === 'function') {
				const p = v.play();
				if (p && typeof p.catch === 'function') p.catch(() => {});
			}
		} catch (_) {}
	});
}
