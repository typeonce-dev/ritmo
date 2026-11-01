// dust, draft a: chunky puffs kicked out to both sides of the boots, rising a
// little as they shrink; each puff is lit on its top.
export default {
  label: "puffs",
  size: [48, 16],
  frames: 8,
  fps: 20,
  loop: false,
  anchor: [24, 15],
  params: {
    puffs: { min: 2, max: 8, value: 6, step: 1 },
    spread: { min: 6, max: 18, value: 14 }
  },
  draw(fx) {
    for (let i = 0; i < fx.p.puffs; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const reach = fx.range(0.4, 1) * fx.p.spread
      const size = fx.range(2.5, 4.2)
      const x = fx.cx + side * (6 + fx.ease.out(fx.t) * reach)
      const y = 11 - fx.ease.out(fx.t) * fx.range(1, 4)
      const r = size * (1 - fx.ease.in(fx.t))
      if (r < 0.8) continue
      fx.disc(x, y, r, fx.ramp("dust", fx.t * 0.7 + 0.25))
      if (r > 2) fx.disc(x + 1, y - 1, r - 1.5, fx.ramp("dust", fx.t * 0.7))
    }
  }
}
