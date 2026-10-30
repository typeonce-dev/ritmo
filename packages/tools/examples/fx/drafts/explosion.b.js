// explosion, draft b: a sharp shockwave and flying shards around a short fire core; little smoke.
export default {
  label: "shockwave",
  size: [48, 48],
  frames: 14,
  fps: 24,
  loop: false,
  params: {
    wave: { min: 10, max: 23, value: 20 },
    shards: { min: 4, max: 20, value: 12, step: 1 },
    core: { min: 3, max: 9, value: 6 }
  },
  draw(fx) {
    const t = fx.t
    if (t < 0.45) {
      const k = t / 0.45
      const r = fx.p.core * Math.sin(Math.min(1, k * 1.2) * Math.PI) + 1
      fx.disc(fx.cx, fx.cy, r + 1, fx.ramp(["yellow", "orange", "red", "crimson"], k))
      fx.disc(fx.cx, fx.cy, r - 1, fx.ramp(["white", "yellow", "gold", "orange"], k))
    }
    if (t < 0.6) {
      const r = 3 + fx.ease.out(t / 0.6) * (fx.p.wave - 3)
      fx.ring(fx.cx, fx.cy, r, fx.ramp(["white", "white", "ash", "smoke"], t / 0.6))
    }
    for (let i = 0; i < fx.p.shards; i++) {
      const angle = fx.range(0, Math.PI * 2)
      const speed = fx.range(0.6, 1) * fx.p.wave
      const length = fx.range(2, 4)
      const life = t / fx.range(0.6, 0.95)
      if (life >= 1) continue
      const d = fx.ease.out(life) * speed
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      const color = fx.ramp(["white", "yellow", "gold", "orange", "red"], life)
      fx.line(fx.cx + dx * d, fx.cy + dy * d, fx.cx + dx * (d - length * (1 - life)), fx.cy + dy * (d - length * (1 - life)), color)
    }
  }
}
