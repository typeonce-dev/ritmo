// heavy-slash, draft c: the held crescent throws chunky shards off along the swing, which arc down and darken.
// The crescent: pixels between the outer arc and an inner arc that is thickest late in the swing (where the blade is fastest) and tapers to points.
// "from" and "to" (0 to 1 along the swing) are the part shown: the tip draws in, the tail wears away.
function crescent(fx, o) {
  for (let py = 0; py < fx.h; py++)
    for (let px = 0; px < fx.w; px++) {
      const dx = px + 0.5 - o.x
      const dy = (py + 0.5 - o.y) / o.squash
      const u = (Math.atan2(dy, dx) - o.a0) / (o.a1 - o.a0)
      if (u < o.from || u > o.to) continue
      const r = Math.hypot(dx, dy)
      const thick = o.thick * Math.sin(Math.PI * u ** 1.5) ** 0.6
      // Thinner than a pixel, a tip breaks into specks: end it there.
      if (thick < 1) continue
      const depth = o.r - r
      if (depth < 0 || depth > thick) continue
      fx.px(px, py, depth > thick - 1.2 ? o.inner : depth < 1 ? o.edge : o.body)
    }
}

export default {
  label: "shards",
  size: [64, 48],
  frames: 12,
  fps: 24,
  loop: false,
  // The swordsman, at the middle of the arc.
  anchor: [14, 20],
  params: {
    thick: { min: 4, max: 12, value: 9 },
    shards: { min: 0, max: 12, value: 7, step: 1 },
    gravity: { min: 0, max: 16, value: 9 }
  },
  draw(fx) {
    const a0 = -1.5
    const a1 = a0 + 2.7
    const shape = { x: 14, y: 20, r: 30, squash: 0.62, a0, a1 }
    const k = Math.max(0, (fx.frame - 3) / 8)
    if (k < 1)
      crescent(fx, {
        ...shape,
        from: fx.ease.in(k),
        to: fx.frame === 0 ? 0.7 : 1,
        thick: fx.p.thick * (1 - 0.7 * fx.ease.in(k)),
        body: k > 0.45 ? "ash" : "white",
        edge: "white",
        inner: k > 0.45 ? "smoke" : "ash"
      })
    // Shards leave the outer edge, flying out along the swing's direction (down and forward), then fall.
    for (let i = 0; i < fx.p.shards; i++) {
      const u = fx.range(0.5, 0.95)
      const a = a0 + u * (a1 - a0)
      const speed = fx.range(6, 11)
      const born = fx.range(0, 2)
      const life = (fx.frame - born) / (fx.frames - 2 - born)
      if (life < 0 || life >= 1) continue
      const startX = shape.x + Math.cos(a) * shape.r
      const startY = shape.y + Math.sin(a) * shape.r * shape.squash
      // Tangent to the swing, a little outward.
      const tx = -Math.sin(a) * 0.7 + Math.cos(a) * 0.5
      const ty = Math.cos(a) * 0.7 + Math.sin(a) * 0.5
      const d = fx.ease.out(life) * speed
      const x = startX + tx * d
      const size = life < 0.3 ? 3 : life < 0.7 ? 2 : 1
      // They fall to the floor (the canvas's bottom) and lie there as they fade.
      const y = Math.min(fx.h - size, startY + ty * d + life * life * fx.p.gravity)
      fx.rect(x, y, size, size, fx.ramp("steel", life))
    }
  }
}
