// dash, draft b: a burst that kicks backward: a white star, then speed lines
// streaming back behind the player, cooling from gold to ember as they thin.
export default {
  label: "speed lines",
  size: [56, 40],
  frames: 8,
  fps: 30,
  loop: false,
  anchor: [40, 20],
  params: {
    lines: { min: 3, max: 9, value: 6, step: 1 },
    length: { min: 10, max: 34, value: 26, step: 1 }
  },
  draw(fx) {
    if (fx.frame === 0) {
      fx.disc(fx.cx + 16, fx.cy, 5, "steel6")
      fx.sparkle(fx.cx + 16, fx.cy, 8, "gold2", "gold1")
      return
    }
    if (fx.frame === 1) fx.disc(fx.cx + 16, fx.cy, 4, "gold1")
    for (let i = 0; i < fx.p.lines; i++) {
      const y = fx.cy + Math.round(fx.range(-12, 12))
      const delay = fx.range(0, 0.3)
      const life = (fx.t - delay) / (1 - delay)
      if (life <= 0 || life >= 1) continue
      const head = fx.cx + 14 - fx.ease.out(life) * 22
      const len = fx.p.length * (1 - life) * fx.range(0.5, 1)
      fx.streak(head, y, len, 0, "glow")
    }
  }
}
