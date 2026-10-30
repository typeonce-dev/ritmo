// hit, draft a: a white flash, then rays that shoot out and burn down to red.
export default {
  label: "starburst",
  size: [24, 24],
  frames: 8,
  fps: 24,
  loop: false,
  params: {
    rays: { min: 3, max: 10, value: 7, step: 1 },
    reach: { min: 5, max: 11, value: 10 },
    flash: { min: 1, max: 4, value: 3, step: 1 }
  },
  draw(fx) {
    if (fx.frame === 0) fx.disc(fx.cx, fx.cy, fx.p.flash, "white")
    if (fx.frame === 1) fx.disc(fx.cx, fx.cy, fx.p.flash - 1, "yellow")
    for (let i = 0; i < fx.p.rays; i++) {
      const angle = (i / fx.p.rays) * Math.PI * 2 + fx.range(-0.35, 0.35)
      const length = fx.p.reach * fx.range(0.6, 1)
      const far = fx.ease.out(fx.t) * length
      const near = fx.ease.in(fx.t) * length
      if (far - near < 1) continue
      const color = fx.ramp("fire", fx.t)
      fx.line(fx.cx + Math.cos(angle) * near, fx.cy + Math.sin(angle) * near, fx.cx + Math.cos(angle) * far, fx.cy + Math.sin(angle) * far, color)
    }
  }
}
