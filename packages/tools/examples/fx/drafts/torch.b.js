// torch, draft b: round blobs of fire bubbling up from the stick and shrinking away; chunkier, more cartoon.
export default {
  label: "bubbles",
  size: [16, 28],
  // Two seconds a loop: six blobs over 12 frames would hand over every 2 frames, a strobe.
  frames: 24,
  fps: 12,
  loop: true,
  // The foot of the stick, where it hangs on the wall.
  anchor: [8, 27],
  params: {
    blobs: { min: 3, max: 9, value: 6, step: 1 },
    height: { min: 8, max: 18, value: 13 },
    size: { min: 2, max: 5, value: 3.5 }
  },
  draw(fx) {
    const base = fx.h - 4
    fx.rect(fx.cx - 1, base, 2, 4, "dusk")
    fx.rect(fx.cx - 2, base, 4, 1, "soot")
    const blobs = []
    for (let i = 0; i < fx.p.blobs; i++) blobs.push({ phase: i / fx.p.blobs + fx.range(-0.05, 0.05), side: fx.range(-1.2, 1.2) })
    // Oldest (highest, coolest) first, so younger blobs cover them.
    const live = blobs.map((blob) => ({ ...blob, life: (fx.t + blob.phase) % 1 })).sort((a, b) => b.life - a.life)
    for (const blob of live) {
      const y = base - 2 - fx.ease.out(blob.life) * fx.p.height
      // Each blob drifts in toward the middle as it rises, one way only: a wobble back and forth boils at this size.
      const x = fx.cx + blob.side * (1 - blob.life)
      const r = fx.p.size * (1 - blob.life * 0.9)
      if (r < 0.6) continue
      fx.disc(x, y, r, fx.ramp(["yellow", "gold", "orange", "red", "crimson"], blob.life))
    }
    // A steady hot core on the stick, so the flame never leaves it.
    fx.disc(fx.cx, base - 2, fx.p.size * 0.8, "gold")
    fx.disc(fx.cx, base - 2, fx.p.size * 0.4, "yellow")
  }
}
