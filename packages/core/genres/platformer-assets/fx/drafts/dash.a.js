// dash, draft a: a white flash where the dash starts, a ring that widens and
// cools through the scarf's glow, and a few sparks thrown out.
export default {
  label: "ring",
  size: [28, 28],
  frames: 8,
  fps: 24,
  loop: false,
  anchor: [14, 14],
  params: {
    reach: { min: 6, max: 11, value: 10, step: 1 },
    sparks: { min: 0, max: 8, value: 5, step: 1 }
  },
  draw(fx) {
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, 3, "white")
    const r = 2 + fx.ease.out(fx.t) * (fx.p.reach - 2)
    if (fx.frame > 0 && fx.t < 0.85) fx.ring(fx.cx, fx.cy, r, fx.ramp("glow", fx.t), fx.t < 0.4 ? 2 : 1)
    for (let i = 0; i < fx.p.sparks; i++) {
      const angle = (i / fx.p.sparks) * Math.PI * 2 + fx.range(-0.3, 0.3)
      const speed = fx.range(0.7, 1)
      const life = fx.t / speed
      if (fx.frame === 0 || life >= 1) continue
      const d = 3 + fx.ease.out(life) * (fx.p.reach + 1)
      fx.px(fx.cx + Math.cos(angle) * d, fx.cy + Math.sin(angle) * d, fx.ramp("glow", life))
    }
  }
}
