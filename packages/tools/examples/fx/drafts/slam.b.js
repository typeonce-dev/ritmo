// slam, draft b: a heavy landing as a burst of dust. Two clouds roll out low along the floor and climb as they slow,
// pebbles arc out of them, and glints wink where the ground cracked.
export default {
  label: "dust burst",
  size: [72, 36],
  frames: 13,
  fps: 20,
  loop: false,
  // The feet, on the floor: where the body lands.
  anchor: [36, 30],
  params: {
    spread: { min: 14, max: 30, value: 24 },
    pebbles: { min: 0, max: 8, value: 5, step: 1 }
  },
  draw(fx) {
    const [x0, ground] = [36, 30]
    // Release: a flat white flash under the feet, two frames.
    if (fx.frame < 2) fx.oval(x0, ground, 14 - fx.frame * 4, 2, "white")
    // Two clouds, each a cluster of puffs: lit on top (a paler disc a pixel up), darker below. A cloud cools as
    // one (every puff the same color at once, so they do not hand colors back and forth), and its small puffs go first.
    const cloud = fx.clamp(fx.t, 0, 1)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const life = fx.clamp((fx.t - i * 0.03) / (1 - i * 0.03), 0, 1)
        if (life <= 0 || life >= 1) continue
        const out = Math.round(fx.ease.out(life) * fx.p.spread * (0.45 + i * 0.14))
        const rise = Math.round(fx.ease.in(life) * (3 + i))
        const r = (4.5 - i * 0.5) * Math.min(1, life * 5) * Math.sqrt(1 - life)
        // A puff under 1 pixel is a speck, not a cloud: it is gone (the biggest last, at the very end).
        if (r < 1) continue
        const x = x0 + side * (3 + out)
        const y = ground - 2 - rise
        fx.disc(x, y + 1, r, fx.ramp(["smoke", "soot", "dusk"], cloud))
        fx.disc(x, y, r - 1, fx.ramp(["ash", "smoke", "soot"], cloud))
      }
    }
    // Pebbles: arcs out of the clouds, a short streak behind each.
    for (let i = 0; i < fx.p.pebbles; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const vx = side * fx.range(18, 34)
      const vy0 = -fx.range(40, 60)
      const time = fx.t * 1.05
      const vy = vy0 + 120 * time
      const x = x0 + vx * time
      const y = ground - 2 + vy0 * time + 60 * time * time
      if (y > ground) continue
      fx.streak(x, y, vx * 0.05, vy * 0.05, "steel")
    }
    // Glints where the ground cracked: one each side, a beat after the landing.
    for (const side of [-1, 1]) {
      const glint = (fx.t - 0.15) / 0.3
      if (glint > 0 && glint < 1) fx.sparkle(x0 + side * (8 + fx.range(0, 4)), ground - 1, glint < 0.5 ? 2 : 1, "white", "ash")
    }
  }
}
