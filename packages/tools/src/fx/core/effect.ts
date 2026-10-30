/**
 * Pixel art effects as code: each draft of an effect is a small JavaScript
 * module the agent writes, with no imports, whose default export says the
 * effect's size, frame count, speed, and tunable params, and draws one frame
 * at a time with the palette's color names:
 *
 *   export default {
 *     label: "star burst",
 *     size: [32, 32], frames: 10, fps: 20, loop: false, anchor: [16, 16],
 *     params: { spread: { min: 4, max: 14, value: 9 } },
 *     draw(fx) {
 *       for (let i = 0; i < 8; i++) {
 *         const angle = fx.random() * Math.PI * 2
 *         const r = fx.ease.out(fx.t) * fx.p.spread
 *         fx.px(fx.cx + Math.cos(angle) * r, fx.cy + Math.sin(angle) * r, fx.ramp(["white", "yellow", "orange"], fx.t))
 *       }
 *     }
 *   }
 *
 * `draw` runs once per frame, from nothing: an effect is a function of time,
 * not a simulation. `fx.random()` starts over from the draft's seed on every
 * frame, so its n-th number is the same in every frame: draw the n-th
 * particle's direction and speed from it, and its place from `fx.t`.
 *
 * The same runner draws the frames in the CLI and on the review page.
 */

/** A palette's colors by name, each a `#rrggbb`. */
export type Palette = Readonly<Record<string, string>>

/** A param the person tunes with a slider; `value` is the draft's own. */
export interface Param {
  readonly min: number
  readonly max: number
  readonly value: number
  readonly step?: number | undefined
}

/** What a draft's module exports, checked. */
export interface Effect {
  readonly label: string
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly fps: number
  /** Plays again from the start (a torch, a portal); otherwise it plays once and should end empty (a hit, a burst). */
  readonly loop: boolean
  /** The pixel the game places on the spot the effect belongs to (where a blow lands, a caster's feet, a torch's foot); the canvas's middle by default. */
  readonly anchor: { readonly x: number; readonly y: number }
  readonly params: Readonly<Record<string, Param>>
  readonly draw: (fx: Fx) => void
}

/** The easing curves `fx.ease` offers, each from 0 to 1. */
export interface Ease {
  readonly in: (t: number) => number
  readonly out: (t: number) => number
  readonly inOut: (t: number) => number
}

/** What `draw` gets each frame. Coordinates are rounded down to whole pixels; colors are palette names. */
export interface Fx {
  /** This frame's number, from 0. */
  readonly frame: number
  readonly frames: number
  /** How far through the effect this frame is: 0 on the first, 1 on the last (a loop never reaches 1, so its last frame leads back to its first). */
  readonly t: number
  readonly w: number
  readonly h: number
  /** The canvas's middle pixel. */
  readonly cx: number
  readonly cy: number
  /** The params, tuned. */
  readonly p: Readonly<Record<string, number>>
  /** A number from 0 to 1, from the seed; the n-th call gives the same number in every frame. */
  readonly random: () => number
  /** A number from `min` to `max`, from `random`. */
  readonly range: (min: number, max: number) => number
  readonly px: (x: number, y: number, color: string) => void
  readonly rect: (x: number, y: number, w: number, h: number, color: string) => void
  readonly line: (x0: number, y0: number, x1: number, y1: number, color: string) => void
  /** A filled circle, its radius rounded to a whole pixel; 0 or less draws nothing. */
  readonly disc: (x: number, y: number, r: number, color: string) => void
  /** A circle's clean outline (no doubles), its radius rounded to a whole pixel; 0 or less draws nothing. `width` (default 1) thickens it inward, with no gaps. */
  readonly ring: (x: number, y: number, r: number, color: string, width?: number) => void
  /** The color at `v` (0 to 1) along a list of colors: a ramp from hot to cold, from bright to dark. */
  readonly ramp: (colors: ReadonlyArray<string>, v: number) => string
  readonly ease: Ease
  readonly lerp: (a: number, b: number, t: number) => number
  readonly clamp: (v: number, min: number, max: number) => number
}

/** The frames an effect drew: each pixel 0 where empty, else its palette color's index plus one. */
export interface Run {
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly loop: boolean
  readonly anchor: { readonly x: number; readonly y: number }
  readonly frames: ReadonlyArray<Uint8Array>
  /** Pixels drawn outside the canvas, per frame: the effect is cut off there. */
  readonly clipped: ReadonlyArray<number>
  /** What went wrong while drawing: a thrown error, a color the palette does not have. */
  readonly errors: ReadonlyArray<string>
}

export type Decoded<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** Checks a module's default export, naming every field that is wrong. */
export const decodeEffect = (module: unknown): Decoded<Effect> => {
  const value = isRecord(module) && "default" in module ? module.default : module
  if (!isRecord(value)) return { ok: false, error: "the module must `export default { size, frames, fps, loop, params, draw }`" }
  const errors: Array<string> = []
  const size = value.size
  const width = Array.isArray(size) ? size[0] : undefined
  const height = Array.isArray(size) ? size[1] : undefined
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 1 || (height as number) < 1 || (width as number) > 256 || (height as number) > 256)
    errors.push("size must be [width, height], whole pixels from 1 to 256")
  if (!Number.isInteger(value.frames) || (value.frames as number) < 1 || (value.frames as number) > 240) errors.push("frames must be a whole number from 1 to 240")
  if (!isNumber(value.fps) || value.fps < 1 || value.fps > 60) errors.push("fps must be from 1 to 60")
  if (value.loop !== undefined && typeof value.loop !== "boolean") errors.push("loop must be true or false")
  if (typeof value.draw !== "function") errors.push("draw must be a function: draw(fx) { ... }")
  if (value.label !== undefined && typeof value.label !== "string") errors.push("label must be a string")
  const anchor = value.anchor
  const ax = Array.isArray(anchor) ? anchor[0] : undefined
  const ay = Array.isArray(anchor) ? anchor[1] : undefined
  if (anchor !== undefined && (!Number.isInteger(ax) || !Number.isInteger(ay) || (ax as number) < 0 || (ay as number) < 0 || (ax as number) >= (width as number) || (ay as number) >= (height as number)))
    errors.push("anchor must be [x, y], a pixel inside size: the spot the game places on the effect's place (where the blow lands, the caster's feet)")
  const params: Record<string, Param> = {}
  if (value.params !== undefined && !isRecord(value.params)) errors.push("params must be an object of { min, max, value }")
  for (const [name, param] of Object.entries(isRecord(value.params) ? value.params : {})) {
    if (!isRecord(param) || !isNumber(param.min) || !isNumber(param.max) || !isNumber(param.value) || param.min >= param.max) {
      errors.push(`params.${name} must be { min, max, value } with min below max`)
      continue
    }
    if (param.value < param.min || param.value > param.max) errors.push(`params.${name}.value must be from ${param.min} to ${param.max}`)
    if (param.step !== undefined && (!isNumber(param.step) || param.step <= 0)) errors.push(`params.${name}.step must be above 0`)
    params[name] = { min: param.min, max: param.max, value: param.value, step: isNumber(param.step) ? param.step : undefined }
  }
  if (errors.length > 0) return { ok: false, error: errors.join("; ") }
  return {
    ok: true,
    value: {
      label: typeof value.label === "string" ? value.label : "",
      width: width as number,
      height: height as number,
      frames: value.frames as number,
      fps: value.fps as number,
      loop: value.loop === true,
      anchor: anchor === undefined ? { x: Math.floor((width as number) / 2), y: Math.floor((height as number) / 2) } : { x: ax as number, y: ay as number },
      params,
      draw: value.draw as (fx: Fx) => void
    }
  }
}

/** The params with a tune laid over them, each kept in its range; names the effect does not have are ignored. */
export const tuned = (effect: Effect, tune: Readonly<Record<string, number>> = {}): Record<string, number> => {
  const values: Record<string, number> = {}
  for (const [name, param] of Object.entries(effect.params)) {
    const value = tune[name]
    values[name] = value === undefined ? param.value : Math.min(param.max, Math.max(param.min, value))
  }
  return values
}

/** splitmix32: each number a strong hash of a counter, so every n-th draw is as random as the next (strided draws do not cluster). */
const mix = (value: number): number => {
  let z = value >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
  return (z ^ (z >>> 15)) >>> 0
}

const generator = (seed: number): (() => number) => {
  // The seed is mixed first, so seed 2 is not seed 1 one draw along.
  let state = mix(seed ^ 0x5bd1e995)
  return () => {
    state = (state + 0x9e3779b9) >>> 0
    return mix(state) / 4294967296
  }
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
const ease: Ease = {
  in: (t) => clamp(t, 0, 1) ** 3,
  out: (t) => 1 - (1 - clamp(t, 0, 1)) ** 3,
  inOut: (t) => {
    const x = clamp(t, 0, 1)
    return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2
  }
}

/**
 * A circle's one-pixel outline around (0, 0), as pixel artists draw it: the
 * midpoint circle at the radius rounded to a whole pixel, with every
 * "double" taken out (a pixel whose only two neighbours sit at a right angle
 * to it, which thickens the line into an L). A radius of 0 or less is no
 * pixels, so a shape that shrinks to 0 is gone; one under a half is a dot.
 */
const circles = new Map<number, ReadonlyArray<readonly [number, number]>>()
const circle = (r: number): ReadonlyArray<readonly [number, number]> => {
  if (!(r > 0)) return []
  const radius = Math.round(r)
  const known = circles.get(radius)
  if (known !== undefined) return known
  const points = new Set<string>()
  let x = 0
  let y = radius
  let d = 1 - radius
  while (x <= y) {
    for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]] as const) points.add(`${a},${b}`)
    x++
    if (d < 0) d += 2 * x + 1
    else {
      y--
      d += 2 * (x - y) + 1
    }
  }
  const has = (a: number, b: number): boolean => points.has(`${a},${b}`)
  for (const key of [...points]) {
    const [a, b] = key.split(",").map(Number) as [number, number]
    let around = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && has(a + dx, b + dy)) around++
    if (around === 2 && (has(a - 1, b) || has(a + 1, b)) && (has(a, b - 1) || has(a, b + 1))) points.delete(key)
  }
  const outline = [...points].map((key) => key.split(",").map(Number) as unknown as readonly [number, number])
  circles.set(radius, outline)
  return outline
}

/** Each row of an outline, from its leftmost pixel to its rightmost. */
const spans = (outline: ReadonlyArray<readonly [number, number]>): Map<number, readonly [number, number]> => {
  const rows = new Map<number, readonly [number, number]>()
  for (const [dx, dy] of outline) {
    const row = rows.get(dy)
    rows.set(dy, row === undefined ? [dx, dx] : [Math.min(row[0], dx), Math.max(row[1], dx)])
  }
  return rows
}

export interface RunOptions {
  readonly seed?: number | undefined
  readonly tune?: Readonly<Record<string, number>> | undefined
}

/** Draws every frame of an effect on a palette. Never throws: what goes wrong is in `errors`. */
export const runEffect = (effect: Effect, palette: Palette, options: RunOptions = {}): Run => {
  const names = Object.keys(palette)
  const slots = new Map(names.map((name, i) => [name, i + 1]))
  const { width: w, height: h } = effect
  const p = tuned(effect, options.tune)
  const seed = options.seed ?? 1
  const errors = new Set<string>()
  const frames: Array<Uint8Array> = []
  const clipped: Array<number> = []
  for (let frame = 0; frame < effect.frames; frame++) {
    const pixels = new Uint8Array(w * h)
    let outside = 0
    const slot = (color: string): number => {
      const found = slots.get(color)
      if (found === undefined) errors.add(`no color named "${color}" in the palette (${names.join(", ")})`)
      return found ?? 0
    }
    const put = (x: number, y: number, s: number): void => {
      const ix = Math.floor(x)
      const iy = Math.floor(y)
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) return
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) {
        outside++
        return
      }
      if (s > 0) pixels[iy * w + ix] = s
    }
    const random = generator(seed)
    const fx: Fx = {
      frame,
      frames: effect.frames,
      t: effect.loop ? frame / effect.frames : effect.frames === 1 ? 0 : frame / (effect.frames - 1),
      w,
      h,
      cx: Math.floor(w / 2),
      cy: Math.floor(h / 2),
      p,
      random,
      range: (min, max) => min + random() * (max - min),
      px: (x, y, color) => put(x, y, slot(color)),
      rect: (x, y, rw, rh, color) => {
        const s = slot(color)
        for (let yy = Math.floor(y); yy < Math.floor(y + rh); yy++) for (let xx = Math.floor(x); xx < Math.floor(x + rw); xx++) put(xx, yy, s)
      },
      line: (x0, y0, x1, y1, color) => {
        const s = slot(color)
        let x = Math.floor(x0)
        let y = Math.floor(y0)
        const ex = Math.floor(x1)
        const ey = Math.floor(y1)
        if (![x, y, ex, ey].every(Number.isFinite)) return
        const dx = Math.abs(ex - x)
        const dy = -Math.abs(ey - y)
        const sx = x < ex ? 1 : -1
        const sy = y < ey ? 1 : -1
        let err = dx + dy
        for (let guard = 0; guard < 4096; guard++) {
          put(x, y, s)
          if (x === ex && y === ey) break
          const e2 = 2 * err
          if (e2 >= dy) {
            err += dy
            x += sx
          }
          if (e2 <= dx) {
            err += dx
            y += sy
          }
        }
      },
      disc: (x, y, r, color) => {
        const s = slot(color)
        // Each row filled between the outline's ends, so a disc has the same clean edge as a ring.
        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        for (const [dy, [from, to]] of spans(circle(r))) for (let dx = from; dx <= to; dx++) put(x0 + dx, y0 + dy, s)
      },
      ring: (x, y, r, color, width = 1) => {
        const s = slot(color)
        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        const thick = Math.max(1, Math.round(width))
        if (thick === 1) {
          for (const [dx, dy] of circle(r)) put(x0 + dx, y0 + dy, s)
          return
        }
        // A thick ring is the disc minus the disc inside it, so it has no gaps (two outlines a pixel apart leave pinholes).
        const outer = spans(circle(r))
        const inner = spans(circle(Math.round(r) - thick))
        for (const [dy, [from, to]] of outer) {
          const hole = inner.get(dy)
          for (let dx = from; dx <= to; dx++) if (hole === undefined || dx < hole[0] || dx > hole[1]) put(x0 + dx, y0 + dy, s)
        }
      },
      ramp: (colors, v) => colors[Math.min(colors.length - 1, Math.max(0, Math.floor(clamp(v, 0, 1) * colors.length)))] ?? "",
      ease,
      lerp: (a, b, t) => a + (b - a) * t,
      clamp
    }
    try {
      effect.draw(fx)
    } catch (error) {
      errors.add(`draw threw on frame ${frame}: ${error instanceof Error ? error.message : String(error)}`)
    }
    frames.push(pixels)
    clipped.push(outside)
  }
  return { width: w, height: h, fps: effect.fps, loop: effect.loop, anchor: effect.anchor, frames, clipped, errors: [...errors] }
}
