// =============================================================================
//  CONFETI  — celebración del podio (canvas, sin dependencias)
// -----------------------------------------------------------------------------
//  Dibuja papelitos cayendo durante un par de segundos y se autolimpia. Respeta
//  "movimiento reducido": si el sistema lo pide, no hace nada.
// =============================================================================

export function confetti(host, { count = 130, duration = 2800 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const canvas = document.createElement('canvas');
  canvas.className = 'quiz-confetti';
  host.appendChild(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = () => (canvas.width = host.clientWidth * dpr);
  const H = () => (canvas.height = host.clientHeight * dpr);
  let w = W(); let h = H();
  const onResize = () => { w = W(); h = H(); };
  window.addEventListener('resize', onResize);

  const ctx = canvas.getContext('2d');
  const colors = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#ffd23f', '#7b2ff7'];
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: -Math.random() * h * 0.6,
    r: (4 + Math.random() * 5) * dpr,
    c: colors[(Math.random() * colors.length) | 0],
    vy: (2 + Math.random() * 3.5) * dpr,
    vx: (-1 + Math.random() * 2) * dpr,
    rot: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4,
  }));

  const start = performance.now();
  let raf = 0;
  const cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); canvas.remove(); };

  function frame(now) {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    if (now - start < duration) raf = requestAnimationFrame(frame);
    else cleanup();
  }
  raf = requestAnimationFrame(frame);
  return cleanup;
}
