// ice-spike, draft b: a cluster of crystals erupts left to right, each taller than the last; the last one hits.
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
    const speed = fx.range(0.5, 1) * o.speed
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
    // A sliver that flies off the canvas is gone, not cut in half at its edge.
    if (x < 0 || x >= fx.w) continue
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
  label: "cluster",
  size: [80, 48],
  frames: 20,
  fps: 20,
  loop: false,
  // The caster's front foot, on the ground: the crystals come from there.
  anchor: [6, 44],
  params: {
    spikes: { min: 2, max: 6, value: 4, step: 1 },
    height: { min: 20, max: 40, value: 32 },
    splinters: { min: 2, max: 10, value: 5, step: 1 }
  },
  draw(fx) {
    const ground = 44
    const n = fx.p.spikes
    const shapes = []
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n
      const h = fx.p.height * (0.35 + 0.65 * k)
      shapes.push({ x: 12 + i * (34 / Math.max(1, n - 1)), ground, w: 5 + 6 * k, h, lean: h * 0.5, start: i })
    }
    const last = shapes[n - 1]
    const tip = { x: last.x + last.lean, y: ground - last.h }
    const burst = 10 + n - 1
    // Frost where the first crystal will come out, from frame 0.
    if (fx.frame < 3) fx.line(shapes[0].x - 3 - fx.frame, ground, shapes[0].x + 3 + fx.frame, ground, "cyan")
    for (const shape of shapes) {
      // One frame apart, each erupting in two.
      const rise = fx.ease.out(Math.min(1, Math.max(0, (fx.frame - shape.start) / 2)))
      if (rise > 0 && fx.frame < burst) spike(fx, { ...shape, rise, white: fx.frame === burst - 3, split: fx.frame >= burst - 2 ? (fx.frame - burst + 3) / 2 : 0 })
      if (fx.frame >= burst) splinters(fx, { ...shape, count: fx.p.splinters, speed: 10 + shape.h * 0.2, gravity: 12, life: (fx.frame - burst) / (fx.frames - 1 - burst) })
    }
    const hit = n + 1
    if (fx.frame === hit || fx.frame === hit + 1) flash(fx, tip.x, tip.y, fx.frame - hit)
  }
}
