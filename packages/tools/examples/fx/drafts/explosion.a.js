// explosion, draft a: a blast on the floor. A white flash, fire that cools to smoke in clumps that come apart, thrown debris, embers, and dust along the ground.
export default {
  label: "fireball",
  size: [48, 48],
  frames: 19,
  fps: 20,
  loop: false,
  params: {
    puffs: { min: 4, max: 14, value: 10, step: 1 },
    size: { min: 6, max: 14, value: 10 },
    rise: { min: 0, max: 12, value: 7 }
  },
  draw(fx) {
    const ramp = ["white", "yellow", "gold", "orange", "red", "crimson", "smoke", "soot", "dusk"]
    // The stand-in's feet are on the floor; the blast sits on it.
    const floor = fx.cy + 20
    const base = fx.cy + 9

    // Dust runs along the floor in dashes, each shorter as it slows.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const k = (fx.t - 0.05 - i * 0.09) / 0.58
        if (k < 0 || k >= 1) continue
        const far = fx.ease.out(k) * (fx.p.size * 2 - i * 5)
        const length = Math.round((1 - k) * 5)
        if (length > 0) fx.line(fx.cx + side * far, floor, fx.cx + side * (far - length), floor, k < 0.5 ? "smoke" : "soot")
      }
    }

    // Debris: thrown chunks that arc and drop to the floor, behind the fire so the flash stays clean.
    for (let i = 0; i < 7; i++) {
      const direction = i % 2 === 0 ? -1 : 1
      const reach = fx.range(9, 19)
      const height = fx.range(8, 20)
      const span = fx.range(0.5, 0.84)
      const size = fx.range(0, 1) < 0.5 ? 2 : 1
      const life = fx.t / span
      if (life >= 1) continue
      const x = fx.cx + direction * reach * fx.ease.out(life)
      const y = fx.lerp(base, floor - size, life) - height * 4 * life * (1 - life)
      fx.rect(x, y, size, size, life < 0.5 ? "soot" : "dusk")
    }

    // Puffs fly up and out, cool down the ramp, then come apart: each dies at its own time, so the smoke is clumps, not one blob.
    const puffs = []
    for (let i = 0; i < fx.p.puffs; i++) {
      const angle = fx.range(Math.PI * 1.02, Math.PI * 1.98)
      const dist = fx.range(0.35, 1) * fx.p.size
      const delay = fx.range(0, 0.14)
      const span = fx.range(0.72, 1)
      const scale = fx.range(0.55, 1)
      puffs.push({ angle, dist, delay, span, scale })
    }
    // Hot puffs last on top: draw the coolest first.
    const live = puffs
      .map((puff) => ({ ...puff, life: (fx.t - puff.delay) / puff.span }))
      .filter((puff) => puff.life >= 0 && puff.life < 1)
      .sort((a, b) => b.life - a.life)
    for (const puff of live) {
      const out = fx.ease.out(Math.min(1, puff.life * 2.5)) * (1 + Math.max(0, puff.life - 0.5) * 0.7)
      const x = fx.cx + Math.cos(puff.angle) * puff.dist * out * 1.5
      const y = base + Math.sin(puff.angle) * puff.dist * out - fx.ease.in(puff.life) * fx.p.rise
      const grow = fx.ease.out(Math.min(1, puff.life * 4))
      const fade = puff.life < 0.45 ? 1 : 1 - ((puff.life - 0.45) / 0.55) ** 2
      const r = puff.scale * fx.p.size * 0.6 * grow * fade
      if (r < 2) continue
      // Light from the top left: the darker step shows as a crescent below and to the right.
      fx.disc(x, y, r, fx.ramp(ramp, Math.min(1, puff.life + 0.13)))
      fx.disc(x - r * 0.25, y - r * 0.3, r * 0.75, fx.ramp(ramp, puff.life))
    }

    // Embers: bright specks that scatter upward, cool, and vanish.
    for (let i = 0; i < 9; i++) {
      const angle = fx.range(Math.PI * 1.1, Math.PI * 1.9)
      const reach = fx.range(11, 21)
      const delay = fx.range(0.07, 0.26)
      const span = fx.range(0.35, 0.64)
      const life = (fx.t - delay) / span
      if (life < 0 || life >= 1) continue
      const far = fx.ease.out(life) * reach
      const x = fx.cx + Math.cos(angle) * far
      const y = base + Math.sin(angle) * far + life * life * 5
      const color = fx.ramp(["yellow", "gold", "orange", "red"], life)
      fx.line(x, y, x - Math.cos(angle) * 2 * (1 - life), y - Math.sin(angle) * 2 * (1 - life), color)
    }

    // The flash, over everything: gone by a sixth of the way.
    if (fx.t < 0.16) {
      const k = fx.t / 0.16
      fx.disc(fx.cx, base, 5 + k * fx.p.size * 0.7, k < 0.5 ? "white" : "yellow")
    }
  }
}
