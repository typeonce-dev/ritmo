// explosion, draft a: a white core swells into puffs of fire that cool to smoke and drift up.
export default {
  label: "fireball",
  size: [48, 48],
  frames: 18,
  fps: 20,
  loop: false,
  params: {
    puffs: { min: 4, max: 14, value: 9, step: 1 },
    size: { min: 6, max: 14, value: 10 },
    rise: { min: 0, max: 12, value: 6 }
  },
  draw(fx) {
    const ramp = ["white", "yellow", "gold", "orange", "red", "crimson", "smoke", "soot", "dusk"]
    // The core: a flash that is gone by a fifth of the way.
    if (fx.t < 0.2) {
      const k = fx.t / 0.2
      fx.disc(fx.cx, fx.cy, 4 + k * fx.p.size * 0.6, k < 0.5 ? "white" : "yellow")
    }
    // Puffs: each flies out from the middle, grows, cools down the ramp, rises, then shrinks away.
    const puffs = []
    for (let i = 0; i < fx.p.puffs; i++) {
      const angle = fx.range(0, Math.PI * 2)
      const dist = fx.range(0.3, 1) * fx.p.size
      const delay = fx.range(0, 0.15)
      const scale = fx.range(0.5, 1)
      puffs.push({ angle, dist, delay, scale })
    }
    // Hot puffs last on top: draw the coolest first.
    const live = puffs
      .map((puff) => ({ ...puff, life: (fx.t - puff.delay) / (1 - puff.delay) }))
      .filter((puff) => puff.life >= 0 && puff.life < 1)
      .sort((a, b) => b.life - a.life)
    for (const puff of live) {
      const out = fx.ease.out(Math.min(1, puff.life * 2.5))
      const x = fx.cx + Math.cos(puff.angle) * puff.dist * out
      const y = fx.cy + Math.sin(puff.angle) * puff.dist * out * 0.8 - fx.ease.in(puff.life) * fx.p.rise
      const r = puff.scale * fx.p.size * 0.55 * Math.sin(Math.min(1, puff.life * 1.04) * Math.PI) + 0.5
      if (r < 1) continue
      // A darker rim under a lighter body reads as volume.
      fx.disc(x, y + 1, r, fx.ramp(ramp, Math.min(1, puff.life + 0.12)))
      fx.disc(x, y, r - 1, fx.ramp(ramp, puff.life))
    }
  }
}
