// collect, draft a: a cog is taken: a white flash, a gold ring, and sparks
// that fly out and fall a little.
export default {
  label: "flash ring",
  size: [40, 40],
  frames: 12,
  fps: 24,
  loop: false,
  anchor: [20, 20],
  params: {
    sparks: { min: 2, max: 10, value: 7, step: 1 },
    reach: { min: 8, max: 18, value: 15 }
  },
  draw(fx) {
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, 7, "steel6")
    if (fx.frame === 1) fx.disc(fx.cx, fx.cy, 7, "gold2")
    if (fx.frame > 0 && fx.t < 0.5) fx.ring(fx.cx, fx.cy, 6 + (fx.t / 0.5) * (fx.p.reach - 4), fx.ramp("glow", fx.t / 0.5), 2)
    for (let i = 0; i < fx.p.sparks; i++) {
      const angle = fx.range(0, Math.PI * 2)
      const dist = fx.range(0.5, 1) * fx.p.reach
      const start = fx.range(0.05, 0.25)
      const life = (fx.t - start) / (1 - start)
      if (life < 0 || life >= 1) continue
      const x = fx.cx + Math.cos(angle) * dist * fx.ease.out(life)
      const y = fx.cy + Math.sin(angle) * dist * fx.ease.out(life) + life * life * 6
      if (life < 0.5) fx.sparkle(x, y, 1, fx.ramp("spark", life), "gold1")
      else fx.px(x, y, fx.ramp("spark", life))
    }
  }
}
