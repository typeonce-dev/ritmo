// dust, draft a: puffs kicked out to both sides of the feet on a jump or a
// landing, rising a little as they shrink.
export default {
  label: "puffs",
  size: [28, 10],
  frames: 7,
  fps: 20,
  loop: false,
  anchor: [14, 9],
  params: {
    puffs: { min: 2, max: 6, value: 4, step: 1 },
    spread: { min: 4, max: 9, value: 8 }
  },
  draw(fx) {
    for (let i = 0; i < fx.p.puffs; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const reach = fx.range(0.5, 1) * fx.p.spread
      const size = fx.range(1.5, 2.4)
      const x = fx.cx + side * (4 + fx.ease.out(fx.t) * reach)
      const y = 6.5 - fx.ease.out(fx.t) * fx.range(0.5, 2.5)
      const r = size * (1 - fx.ease.in(fx.t))
      if (r < 0.5) continue
      fx.disc(x, y, r, fx.ramp("dust", fx.t))
    }
  }
}
