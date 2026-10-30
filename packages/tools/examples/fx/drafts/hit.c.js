// hit, draft c: a hard flash, a shock ring that widens and fades, and chunks thrown out that fall.
export default {
  label: "impact ring",
  size: [28, 28],
  frames: 9,
  fps: 24,
  loop: false,
  params: {
    ring: { min: 5, max: 12, value: 10 },
    chunks: { min: 0, max: 8, value: 5, step: 1 },
    gravity: { min: 0, max: 12, value: 6 }
  },
  draw(fx) {
    if (fx.frame === 0) {
      fx.disc(fx.cx, fx.cy, 4, "white")
      return
    }
    const r = 3 + fx.ease.out(fx.t) * (fx.p.ring - 3)
    // A hot core filling the fresh ring, so no gap is left between them.
    if (fx.frame === 1) fx.disc(fx.cx, fx.cy, r - 1, "yellow")
    // Two pixels thick while it is fresh, one as it fades.
    if (fx.t < 0.75) fx.ring(fx.cx, fx.cy, r, fx.ramp(["white", "ash", "smoke", "soot"], fx.t / 0.75), fx.t < 0.3 ? 2 : 1)
    for (let i = 0; i < fx.p.chunks; i++) {
      const angle = fx.range(-Math.PI, 0)
      const speed = fx.range(6, 11)
      const life = fx.t
      const x = fx.cx + Math.cos(angle) * speed * fx.ease.out(life)
      const y = fx.cy + Math.sin(angle) * speed * fx.ease.out(life) + life * life * fx.p.gravity
      if (life > 0.9) continue
      const size = life < 0.5 ? 2 : 1
      fx.rect(x, y, size, size, fx.ramp(["yellow", "gold", "orange", "crimson"], life))
    }
  }
}
