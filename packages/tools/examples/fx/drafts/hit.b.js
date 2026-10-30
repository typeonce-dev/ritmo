// hit, draft b: a crescent slash sweeps through, thick then thin, throwing sparks off its tip.
export default {
  label: "slash",
  size: [36, 24],
  frames: 8,
  fps: 24,
  loop: false,
  params: {
    radius: { min: 6, max: 11, value: 9 },
    sweep: { min: 1.5, max: 3.5, value: 2.6 },
    sparks: { min: 0, max: 10, value: 6, step: 1 }
  },
  draw(fx) {
    const start = -2.3
    // The blade's tip runs ahead (ease out, already a third through on frame 0), its tail follows (ease in): the arc grows, then shrinks to nothing.
    const head = start + fx.ease.out(Math.min(1, 0.3 + fx.t * 1.6)) * fx.p.sweep
    const tail = start + fx.ease.in(fx.t) * fx.p.sweep
    const thick = 3 * (1 - fx.t) + 0.8
    // Every pixel tested against the arc (not stepped along it), so its edges step evenly.
    for (let py = 0; py < fx.h; py++)
      for (let px = 0; px < fx.w; px++) {
        const dx = px + 0.5 - fx.cx
        const dy = (py + 0.5 - fx.cy) / 0.75
        const a = Math.atan2(dy, dx)
        if (head - tail <= 0.05 || a < tail || a > head) continue
        // Thickest just behind the tip.
        const along = (a - tail) / (head - tail)
        const w = thick * Math.sin(along * Math.PI * 0.9 + 0.1)
        const d = Math.hypot(dx, dy) - fx.p.radius
        if (Math.abs(d) > w) continue
        fx.px(px, py, Math.abs(d) > w - 1 ? fx.ramp(["yellow", "gold", "orange"], fx.t) : "white")
      }
    for (let i = 0; i < fx.p.sparks; i++) {
      const born = fx.range(0.1, 0.4)
      const angle = start + fx.range(0.3, 1) * fx.p.sweep
      const speed = fx.range(5, 9)
      const life = (fx.t - born) / 0.5
      if (life < 0 || life > 1) continue
      const r = fx.p.radius + fx.ease.out(life) * speed
      const x = fx.cx + Math.cos(angle + 0.25) * r
      const y = fx.cy + Math.sin(angle + 0.25) * r * 0.75 + life * life * 3
      fx.px(x, y, fx.ramp(["white", "yellow", "orange", "red"], life))
      if (life < 0.5) fx.px(x - Math.cos(angle + 0.25), y - Math.sin(angle + 0.25), "gold")
    }
  }
}
