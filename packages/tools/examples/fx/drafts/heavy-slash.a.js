// heavy-slash, draft a: a wide white crescent that sweeps in within two frames, holds its full shape, then wears away from its tail.
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
  label: "held crescent",
  size: [64, 48],
  frames: 12,
  fps: 24,
  loop: false,
  // The swordsman, at the middle of the arc.
  anchor: [14, 20],
  params: {
    thick: { min: 4, max: 12, value: 9 },
    hold: { min: 0, max: 4, value: 2, step: 1 },
    sweep: { min: 1.8, max: 3.2, value: 2.7 }
  },
  draw(fx) {
    const a0 = -fx.p.sweep / 2 - 0.15
    const shape = { x: 14, y: 20, r: 30, squash: 0.62, a0, a1: a0 + fx.p.sweep }
    const inFrames = 2
    const wear = fx.frames - 1 - inFrames - fx.p.hold
    const to = fx.frame < inFrames ? 0.55 + 0.45 * fx.ease.out((fx.frame + 1) / inFrames) : 1
    const k = Math.max(0, (fx.frame - inFrames - fx.p.hold) / wear)
    if (k >= 1) return
    const fading = k > 0.45
    crescent(fx, {
      ...shape,
      from: fx.ease.in(k),
      to,
      thick: fx.p.thick * (1 - 0.7 * fx.ease.in(k)),
      body: fading ? "ash" : "white",
      edge: "white",
      inner: fading ? "smoke" : "ash"
    })
  }
}
