// dust, draft b: a flat ring of dust spreading along the ground from the feet,
// breaking up as it goes.
export default {
  label: "flat ring",
  size: [28, 10],
  frames: 6,
  fps: 20,
  loop: false,
  anchor: [14, 9],
  params: { spread: { min: 5, max: 11, value: 10 } },
  draw(fx) {
    const rx = 2 + fx.ease.out(fx.t) * fx.p.spread
    const ry = 1 + fx.ease.out(fx.t) * 2
    if (fx.t < 0.85) fx.ovalRing(fx.cx, 6, rx, ry, fx.ramp("dust", fx.t), fx.t < 0.3 ? 2 : 1)
  }
}
