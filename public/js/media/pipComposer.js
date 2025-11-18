// Composite screen + webcam (PIP) into a single video track
// Extracted from main.js to keep it reusable and testable.
export function startPipComposite(screenStream, camTrack, {
  pipWidthRatio = 0.22, // width of PIP relative to canvas width
  margin = 16,
  corner = 'br', // 'br' | 'bl' | 'tr' | 'tl'
  fps = 30,
  round = 12,
} = {}) {
  const screenTrack = screenStream?.getVideoTracks?.()[0];
  if (!screenTrack) throw new Error('No screen video track');

  const screenVideo = document.createElement('video');
  screenVideo.muted = true; screenVideo.playsInline = true; screenVideo.autoplay = true;
  screenVideo.srcObject = screenStream;

  const camStream = new MediaStream(camTrack ? [camTrack] : []);
  const camVideo = document.createElement('video');
  camVideo.muted = true; camVideo.playsInline = true; camVideo.autoplay = true;
  camVideo.srcObject = camStream;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let running = true;

  const updateCanvasSize = () => {
    const s = screenTrack.getSettings?.() || {};
    const w = s.width || 1280;
    const h = s.height || 720;
    canvas.width = w; canvas.height = h;
  };
  updateCanvasSize();

  const draw = () => {
    if (!running) return;
    try { ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height); } catch {}

    if (camTrack && camTrack.readyState === 'live') {
      const pipW = Math.round(canvas.width * pipWidthRatio);
      const aspect = camVideo.videoWidth && camVideo.videoHeight ? (camVideo.videoHeight / camVideo.videoWidth) : (9/16);
      const pipH = Math.round(pipW * aspect);
      let x = canvas.width - pipW - margin;
      let y = canvas.height - pipH - margin;
      if (corner === 'bl') { x = margin; y = canvas.height - pipH - margin; }
      if (corner === 'tr') { x = canvas.width - pipW - margin; y = margin; }
      if (corner === 'tl') { x = margin; y = margin; }

      ctx.save();
      if (round > 0) {
        const r = Math.min(round, Math.min(pipW, pipH) / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + pipW, y, x + pipW, y + pipH, r);
        ctx.arcTo(x + pipW, y + pipH, x, y + pipH, r);
        ctx.arcTo(x, y + pipH, x, y, r);
        ctx.arcTo(x, y, x + pipW, y, r);
        ctx.closePath();
        ctx.clip();
      }
      try { ctx.drawImage(camVideo, x, y, pipW, pipH); } catch {}
      ctx.restore();

      // optional subtle border
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, pipW - 3, pipH - 3);
    }

    setTimeout(() => requestAnimationFrame(draw), Math.max(0, 1000 / fps - 4));
  };

  const ensurePlay = (v) => v.play().catch(() => {});
  screenVideo.addEventListener('loadeddata', () => ensurePlay(screenVideo), { once: true });
  camVideo.addEventListener('loadeddata', () => ensurePlay(camVideo), { once: true });

  running = true;
  requestAnimationFrame(draw);

  const compositeStream = canvas.captureStream(fps);
  const compositeTrack = compositeStream.getVideoTracks()[0];
  try { if ('contentHint' in compositeTrack) compositeTrack.contentHint = 'detail'; } catch {}

  const stop = () => { running = false; try { compositeTrack.stop(); } catch {} };
  screenTrack.addEventListener('ended', stop, { once: true });

  return { compositeStream, compositeTrack, stop };
}
