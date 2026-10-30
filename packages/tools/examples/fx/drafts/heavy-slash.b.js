// heavy-slash, draft b: the held crescent, with a white impact flash at its tip and speed lines streaking behind the swing.
// The crescent: pixels between the outer arc and an inner arc that is thickest late in the swing (where the blade is fastest) and tapers to points.
// "from" and "to" (0 to 1 along the swing) are the part shown: the tip draws in, the tail wears away.
function crescent(fx, o) {
  for (let py = 0; py < fx.h; py++)
    for (let px = 0; px < fx.w; px++) {
      const dx = px + 0.5 - o.x
      const dy = (py + 0.5 - o.y) / o.squash
      const u = (Math.atan2(dy, dx) - o.a0) / (o.a1 - o.a0)
      if (u < o.from || u > o.to) continue
      const r = Math.hypot(dx, dy)
      const thick = o.thick * Math.sin(Math.PI * u ** 1.5) ** 0.6
      // Thinner than a pixel, a tip breaks into specks: end it there.
      if (thick < 1) continue
      const depth = o.r - r
      if (depth < 0 || depth > thick) continue
      fx.px(px, py, depth > thick - 1.2 ? o.inner : depth < 1 ? o.edge : o.body)
    }
}

export default {
  label: "impact streaks",
  size: [64, 48],
  frames: 12,
  fps: 24,
  loop: false,
  // The swordsman, at the middle of the arc.
  anchor: [14, 20],
  params: {
    thick: { min: 4, max: 12, value: 9 },
    streaks: { min: 0, max: 8, value: 5, step: 1 },
    flash: { min: 0, max: 6, value: 4, step: 1 }
  },
  draw(fx) {
    const a0 = -1.5
    const shape = { x: 14, y: 20, r: 30, squash: 0.62, a0, a1: a0 + 2.7 }
    // Speed lines first, so the crescent covers them: long, horizontal, gone by frame 4.
    for (let i = 0; i < fx.p.streaks; i++) {
      const y = Math.round(fx.range(6, 34))
      const length = fx.range(10, 22)
      const end = fx.range(30, 44)
      const life = fx.frame / 4
      if (life >= 1) continue
      const left = end - length * (1 - life)
      fx.line(left, y, end - length * life * 0.6, y, life < 0.5 ? "white" : "ash")
    }
    const k = Math.max(0, (fx.frame - 4) / 7)
    if (k < 1)
      crescent(fx, {
        ...shape,
        from: fx.ease.in(k),
        to: fx.frame === 0 ? 0.7 : 1,
        thick: fx.p.thick * (1 - 0.7 * fx.ease.in(k)),
        body: k > 0.45 ? "ash" : "white",
        edge: "white",
        inner: k > 0.45 ? "smoke" : "ash"
      })
    // The flash where the blade's middle lands: a cross that is gone after frame 2.
    if (fx.frame <= 2 && fx.p.flash > 0) {
      const x = 44
      const y = 20
      const r = fx.p.flash * (fx.frame === 1 ? 1.4 : fx.frame === 2 ? 0.7 : 1)
      fx.line(x - r * 2, y, x + r * 2, y, "white")
      fx.line(x, y - r, x, y + r, "white")
      if (fx.frame < 2) fx.disc(x, y, r * 0.45, "white")
    }
  }
}
