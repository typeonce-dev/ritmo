// heavy-slash, draft d: the crescent with a dim afterimage a few pixels behind it, as if the blade dragged its own weight.
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
  label: "afterimage",
  size: [64, 48],
  frames: 12,
  fps: 24,
  loop: false,
  // The swordsman, at the middle of the arc.
  anchor: [14, 20],
  params: {
    thick: { min: 4, max: 12, value: 9 },
    behind: { min: 2, max: 9, value: 5 },
    hold: { min: 0, max: 4, value: 2, step: 1 }
  },
  draw(fx) {
    const a0 = -1.5
    const shape = { x: 14, y: 20, r: 30, squash: 0.62, a0, a1: a0 + 2.7 }
    const inFrames = 2
    const wear = fx.frames - 1 - inFrames - fx.p.hold
    const at = (frame) => Math.max(0, (frame - inFrames - fx.p.hold) / wear)
    // The afterimage: the same crescent a few pixels back, in blue-greys, wearing away a frame earlier.
    const ghost = at(fx.frame + 1)
    if (fx.frame >= 1 && ghost < 1)
      crescent(fx, {
        ...shape,
        x: shape.x - fx.p.behind,
        from: fx.ease.in(ghost),
        to: 1,
        thick: fx.p.thick * (1 - 0.7 * fx.ease.in(ghost)),
        body: "smoke",
        edge: "ash",
        inner: "soot"
      })
    const k = at(fx.frame)
    if (k < 1)
      crescent(fx, {
        ...shape,
        from: fx.ease.in(k),
        to: fx.frame < inFrames ? 0.55 + 0.45 * fx.ease.out((fx.frame + 1) / inFrames) : 1,
        thick: fx.p.thick * (1 - 0.7 * fx.ease.in(k)),
        body: k > 0.45 ? "ash" : "white",
        edge: "white",
        inner: k > 0.45 ? "smoke" : "ash"
      })
  }
}
