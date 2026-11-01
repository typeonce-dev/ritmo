// dash, draft b: a starburst of short rays from where the dash starts, the
// rays sliding outward and shortening as they cool.
export default {
  label: "rays",
  size: [28, 28],
  frames: 7,
  fps: 24,
  loop: false,
  anchor: [14, 14],
  params: {
    rays: { min: 4, max: 10, value: 8, step: 1 },
    reach: { min: 6, max: 11, value: 10, step: 1 }
  },
  draw(fx) {
    if (fx.frame === 0) {
      fx.disc(fx.cx, fx.cy, 2, "white")
      return
    }
    for (let i = 0; i < fx.p.rays; i++) {
      const angle = (i / fx.p.rays) * Math.PI * 2
      const far = 3 + fx.ease.out(fx.t) * fx.p.reach
      const near = 3 + fx.ease.in(fx.t) * fx.p.reach
      if (far - near < 1) continue
      fx.line(
        fx.cx + Math.cos(angle) * near,
        fx.cy + Math.sin(angle) * near,
        fx.cx + Math.cos(angle) * far,
        fx.cy + Math.sin(angle) * far,
        fx.ramp("glow", fx.t)
      )
    }
  }
}
