// collect, draft a: the fruit is taken: a white flash, a gold ring, and glints
// that hang a moment where it was.
export default {
  label: "glints",
  size: [24, 24],
  frames: 12,
  fps: 20,
  loop: false,
  anchor: [12, 12],
  params: {
    glints: { min: 2, max: 7, value: 5, step: 1 },
    reach: { min: 5, max: 11, value: 9 }
  },
  draw(fx) {
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, 4, "white")
    if (fx.frame > 0 && fx.t < 0.45) fx.ring(fx.cx, fx.cy, 4 + (fx.t / 0.45) * (fx.p.reach - 3), fx.ramp("glow", fx.t / 0.45), 1)
    for (let i = 0; i < fx.p.glints; i++) {
      const angle = fx.range(0, Math.PI * 2)
      const dist = fx.range(0.4, 1) * fx.p.reach
      const start = fx.range(0.05, 0.3)
      const life = (fx.t - start) / (1 - start)
      if (life < 0 || life >= 1) continue
      const x = fx.cx + Math.cos(angle) * dist
      const y = fx.cy + Math.sin(angle) * dist - life * 2
      if (life < 0.5) fx.sparkle(x, y, 1, fx.ramp("glow", life), "gold")
      else fx.px(x, y, fx.ramp("glow", life))
    }
  }
}
