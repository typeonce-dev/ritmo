// torch, draft a: tongues of flame that sway and lick upward, with embers rising off the tip.
export default {
  label: "tongues",
  size: [16, 28],
  frames: 12,
  fps: 12,
  loop: true,
  // The foot of the stick, where it hangs on the wall.
  anchor: [8, 27],
  params: {
    height: { min: 8, max: 18, value: 14 },
    width: { min: 2, max: 6, value: 4 },
    embers: { min: 0, max: 6, value: 3, step: 1 }
  },
  draw(fx) {
    const turn = fx.t * Math.PI * 2
    const base = fx.h - 4
    // The stick.
    fx.rect(fx.cx - 1, base, 2, 4, "dusk")
    fx.rect(fx.cx - 2, base, 4, 1, "soot")
    // Rows up the flame: narrower and hotter-to-cooler toward the tip, swaying more the higher they are.
    const height = fx.p.height + Math.sin(turn * 2) * 1.5
    for (let row = 0; row < height; row++) {
      const k = row / height
      const sway = Math.sin(turn + k * 3) * k * 1.8 + Math.sin(turn * 3 + k * 5) * k * 0.6
      const half = fx.p.width * Math.sin((1 - k) * Math.PI * 0.62) * (1 - k * 0.3)
      if (half < 0.4) continue
      const y = base - 1 - row
      const left = fx.cx + sway - half
      const right = fx.cx + sway + half
      for (let x = Math.floor(left); x < right; x++) {
        // Hot in the middle and low, cool at the edges and the tip.
        const edge = Math.abs(x + 0.5 - (fx.cx + sway)) / half
        const heat = k * 0.75 + edge * 0.45
        fx.px(x, y, fx.ramp("fire", heat))
      }
    }
    // Embers: each on its own phase, so the loop wraps.
    for (let i = 0; i < fx.p.embers; i++) {
      const phase = fx.random()
      const drift = fx.range(-2, 2)
      const life = (fx.t * 2 + phase) % 1
      const y = base - fx.p.height * 0.6 - life * (fx.h - fx.p.height)
      const x = fx.cx + drift * life + Math.sin(turn * 2 + phase * 6) * 0.8
      // Along the fire ramp, so they recolor with the flame: gold, then red.
      fx.px(x, y, fx.ramp("fire", life < 0.5 ? 0.4 : 0.8))
    }
  }
}
