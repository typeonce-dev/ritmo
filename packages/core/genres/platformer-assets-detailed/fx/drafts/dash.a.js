// dash, draft a: a white flash where the dash starts, a ring that widens and
// cools through the gold glow, and sparks thrown backward.
export default {
  label: "ring",
  size: [60, 56],
  frames: 8,
  fps: 30,
  loop: false,
  anchor: [36, 28],
  params: {
    reach: { min: 10, max: 22, value: 16, step: 1 },
    sparks: { min: 0, max: 12, value: 7, step: 1 }
  },
  draw(fx) {
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, 6, "steel6")
    for (let i = 0; i < fx.p.sparks; i++) {
      const angle = Math.PI + fx.range(-1.1, 1.1)
      const speed = fx.range(0.6, 1)
      const life = fx.t / speed
      if (fx.frame === 0 || life >= 1) continue
      const d = 6 + fx.ease.out(life) * (fx.p.reach + 4)
      fx.streak(fx.cx + Math.cos(angle) * d, fx.cy + Math.sin(angle) * d, Math.cos(angle) * 4, Math.sin(angle) * 4, "spark")
    }
    // The ring last, over the sparks, so they never punch holes in it.
    const r = 4 + fx.ease.out(fx.t) * (fx.p.reach - 4)
    if (fx.frame > 0 && fx.t < 0.85) fx.ring(fx.cx, fx.cy, r, fx.ramp("glow", fx.t), 2)
  }
}
