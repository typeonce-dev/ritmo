// ice-spike, draft a: one big crystal erupts from the ground at an angle into the target, cracks, and bursts into splinters.
// A crystal: a prism from its base on the ground (straight sides, then a pointed tip), slid back into the ground by
// (1 - rise) along its own axis, so it erupts rather than grows. Rows below the ground are not drawn. Lit from the
// left: a white edge line, a pale face, a cyan and a blue face, and a dark outline so it reads on light ground too.
// `split` (0 to 1) cracks it into four chunks drifting apart, the moment before it bursts.
function spike(fx, o) {
  const back = 1 - o.rise
  const x0 = o.x - o.lean * back
  const y0 = o.ground + o.h * back
  const tip = 0.4
  for (let py = 0; py < Math.min(fx.h, o.ground); py++)
    for (let px = 0; px < fx.w; px++) {
      const t = (y0 - (py + 0.5)) / o.h
      if (t < 0 || t > 1) continue
      const chunk = Math.min(3, Math.floor(t * 4))
      const drift = (o.split ?? 0) * (chunk - 1.5) * 2
      const center = x0 + o.lean * t + drift
      const half = (o.w / 2) * (t < 1 - tip ? 1 : (1 - t) / tip)
      const d = px + 0.5 - center
      if (Math.abs(d) > half) continue
      // The cracks between chunks show as gaps once it splits.
      if ((o.split ?? 0) > 0 && Math.abs(t * 4 - Math.round(t * 4)) * o.h < 4 * 0.5 * (o.split ?? 0) && t > 0.05) continue
      let color = Math.abs(d) > half - 1 ? "dusk" : d < -half + 2 ? "white" : d < 0 ? "ash" : d < half * 0.5 ? "cyan" : "blue"
      if (o.white && color !== "dusk") color = "white"
      fx.px(px, py, color)
    }
}

// Splinters: slivers two pixels wide, thrown from points along a crystal, outward and up, falling, cooling from
// white to dark blue, and thinning to one pixel as they fade.
function splinters(fx, o) {
  for (let i = 0; i < o.count; i++) {
    const along = fx.range(0.1, 0.95)
    const side = fx.random() < 0.5 ? -1 : 1
    const speed = fx.range(0.5, 0.85) * o.speed
    const tilt = fx.range(-0.5, 0.5)
    const length = fx.random() < 0.5 ? 4 : 3
    const life = o.life / fx.range(0.8, 1)
    if (life < 0 || life >= 1) continue
    const sx = o.x + o.lean * along
    const sy = o.ground - o.h * along
    // Away from the crystal's axis, plus up.
    const norm = Math.hypot(o.h, o.lean) || 1
    const dx = (side * o.h) / norm + tilt
    const dy = (-side * o.lean) / norm - 0.9
    const d = fx.ease.out(life) * speed
    const x = Math.round(sx + dx * d)
    const y = Math.round(Math.min(o.ground - 2, sy + dy * d + life * life * o.gravity))
    const len = Math.max(1, Math.round(length * (1 - life * 0.7)))
    const color = fx.ramp("frost", life)
    // Each sliver lies along the way it flies, in whole steps, so it stays one clean shape frame to frame.
    const ux = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0
    const uy = ux === 0 ? Math.sign(dy) : 0
    for (let k = 0; k < len; k++) fx.px(x - ux * k, y - uy * k, color)
    if (life < 0.5) for (let k = 0; k < len - 1; k++) fx.px(x - ux * k + uy, y - uy * k + ux, life < 0.25 ? "white" : "ash")
  }
}

// A hit flash: a white cross with a cyan heart, gone in two frames.
function flash(fx, x, y, k) {
  const r = k === 0 ? 4 : 2
  fx.line(x - r * 1.5, y, x + r * 1.5, y, "white")
  fx.line(x, y - r, x, y + r, "white")
  if (k === 0) fx.disc(x, y, 1, "cyan")
}

export default {
  label: "great spike",
  size: [80, 48],
  frames: 20,
  fps: 20,
  loop: false,
  // The caster's front foot, on the ground: the crystals come from there.
  anchor: [6, 44],
  params: {
    height: { min: 20, max: 40, value: 34 },
    width: { min: 6, max: 18, value: 13 },
    splinters: { min: 4, max: 24, value: 12, step: 1 }
  },
  draw(fx) {
    const ground = 44
    const shape = { x: 22, ground, w: fx.p.width, h: fx.p.height, lean: fx.p.height * 0.75 }
    const tip = { x: shape.x + shape.lean, y: ground - shape.h }
    // Frost spreads on the ground where it will come out, for two frames before it does.
    if (fx.frame < 4) fx.line(shape.x - 4 - fx.frame * 2, ground, shape.x + 4 + fx.frame * 2, ground, fx.frame < 2 ? "cyan" : "ash")
    if (fx.frame < 2) return
    // Erupts in three frames (ease out), holds, flashes white, cracks into chunks, then bursts.
    if (fx.frame <= 10) spike(fx, { ...shape, rise: fx.ease.out(Math.min(1, (fx.frame - 1) / 3)), white: fx.frame === 8, split: fx.frame >= 9 ? (fx.frame - 8) / 2 : 0 })
    if (fx.frame === 4 || fx.frame === 5) flash(fx, tip.x, tip.y, fx.frame - 4)
    if (fx.frame >= 11) splinters(fx, { ...shape, count: fx.p.splinters, speed: 16, gravity: 14, life: (fx.frame - 11) / 8 })
  }
}
