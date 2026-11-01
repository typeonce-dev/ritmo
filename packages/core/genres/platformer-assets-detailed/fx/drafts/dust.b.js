// dust, draft b: a skid: a low wave of dust thrown back along the ground, with
// grit flicked up.
export default {
  label: "skid",
  size: [56, 16],
  frames: 7,
  fps: 20,
  loop: false,
  anchor: [40, 15],
  params: {
    grit: { min: 0, max: 8, value: 5, step: 1 }
  },
  draw(fx) {
    const back = fx.ease.out(fx.t) * 16
    const r = 4 * (1 - fx.ease.in(fx.t))
    if (r >= 1) {
      fx.oval(fx.cx - 4 - back, 11, r * 2, r * 0.8, fx.ramp("dust", fx.t * 0.8 + 0.2))
      fx.oval(fx.cx - 3 - back, 10, r * 1.2, r * 0.5, fx.ramp("dust", fx.t * 0.8))
    }
    for (let i = 0; i < fx.p.grit; i++) {
      const life = fx.t / fx.range(0.6, 1)
      if (life >= 1) continue
      const x = fx.cx - 2 - fx.ease.out(life) * fx.range(8, 20)
      const y = 13 - Math.sin(life * Math.PI) * fx.range(4, 9)
      fx.px(x, y, fx.ramp("dust", life))
    }
  }
}
