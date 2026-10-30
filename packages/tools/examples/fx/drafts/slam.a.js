// slam, draft a: a heavy landing. A white flash at the feet, a shock ring that races out flat along the floor and
// cools, dust that rolls out to both sides, and a few sparks and pebbles kicked up that fall back.
export default {
  label: "shock ring",
  size: [72, 36],
  frames: 14,
  fps: 20,
  loop: false,
  // The feet, on the floor: where the body lands.
  anchor: [36, 30],
  params: {
    reach: { min: 16, max: 34, value: 30 },
    sparks: { min: 0, max: 10, value: 6, step: 1 }
  },
  draw(fx) {
    const [x0, ground] = [36, 30]
    // Release: the hero frame, the whole impact in white for two frames.
    if (fx.frame < 2) {
      fx.oval(x0, ground, 12 - fx.frame * 3, 3, "white")
      fx.sparkle(x0, ground - 6, 4 - fx.frame * 2, "white", "ash")
    }
    // The shock ring: fast out, slowing as it spreads, flat on the floor (far wider than tall), thick then thin.
    const ring = fx.t / 0.6
    if (ring > 0.05 && ring < 1) {
      const rx = 6 + fx.ease.out(ring) * (fx.p.reach - 6)
      fx.ovalRing(x0, ground, rx, rx * 0.14, fx.ramp("steel", ring), ring < 0.3 ? 2 : 1)
    }
    // Dust rolling out to both sides: puffs that swell, drift up a little, cool, and shrink away.
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const delay = fx.range(0, 0.15)
      const speed = fx.range(0.5, 1)
      // Each puff fades out by the last frame: the dust is the long decay after the hit.
      const life = fx.clamp((fx.t - delay) / (0.97 - delay), 0, 1)
      if (life <= 0 || life >= 1) continue
      const out = fx.ease.out(life) * fx.p.reach * 0.75 * speed
      const r = Math.sin(Math.PI * life) * fx.range(2.5, 4)
      const y = ground - 1 - life * fx.range(2, 5)
      fx.disc(x0 + side * (4 + out), y, r, fx.ramp(["ash", "smoke", "soot"], life))
    }
    // Sparks and pebbles kicked up: thrown out, pulled back down, each with a streak behind it along its motion.
    for (let i = 0; i < fx.p.sparks; i++) {
      const angle = -Math.PI / 2 + fx.range(-1.1, 1.1)
      const speed = fx.range(30, 55)
      const time = fx.t * 0.8
      const vx = Math.cos(angle) * speed
      const vy = Math.sin(angle) * speed + 90 * time
      const x = x0 + Math.cos(angle) * speed * time
      const y = ground - 2 + Math.sin(angle) * speed * time + 45 * time * time
      if (y > ground - 1 || fx.t > 0.75) continue
      fx.streak(x, y, vx * 0.06, vy * 0.06, i % 2 === 0 ? "fire" : "steel")
    }
  }
}
