/**
 * Pixel art craft, measured: the rules pixel artists judge by eye that code
 * can count on a draft's frames. Each finds the frames and pixels where the
 * rule breaks, so the agent can fix that spot:
 *
 * - jaggies: uneven steps along an edge (runs of 3, 1, 3 where they should
 *   grow or shrink steadily), which make a curve look broken;
 * - doubles: the extra pixel in the corner of a one-pixel line, which makes
 *   it look two pixels thick there;
 * - flicker: pixels that change for a single frame and change back, which
 *   read as noise in motion though every frame looks clean;
 * - holes: single empty pixels inside a shape;
 * - contrast: pixels that barely differ from the game's own backgrounds.
 */
import { parseHex, toOklab } from "../../pixel/core/color.ts"
import type { Palette, Run } from "./effect.ts"

/** A pixel where a rule breaks. */
export interface Spot {
  readonly frame: number
  readonly x: number
  readonly y: number
}

/** Spots shown per issue: enough to find the pattern, few enough to read. */
export const SHOWN = 8

// ---------------------------------------------------------------------------
// Jaggies

/** A run of edge pixels along one row, in the oriented frame `edgeRuns` reads. */
interface EdgeRun {
  readonly y: number
  readonly x0: number
  readonly x1: number
}

/**
 * The top edges of every shape in a mask, as chains of runs that step one row
 * up or down at a time (a shallow curve or line).
 */
const topEdgeChains = (mask: Uint8Array, w: number, h: number): Array<ReadonlyArray<EdgeRun>> => {
  const runs: Array<EdgeRun> = []
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      const edge = (xx: number): boolean => mask[y * w + xx] === 1 && (y === 0 || mask[(y - 1) * w + xx] === 0)
      if (!edge(x)) {
        x++
        continue
      }
      const x0 = x
      while (x < w && edge(x)) x++
      runs.push({ y, x0, x1: x - 1 })
    }
  }
  const startingAt = new Map<string, EdgeRun>()
  const endingAt = new Set<string>()
  for (const run of runs) {
    startingAt.set(`${run.x0}:${run.y}`, run)
    endingAt.add(`${run.x1}:${run.y}`)
  }
  const chains: Array<ReadonlyArray<EdgeRun>> = []
  for (const first of runs) {
    for (const dy of [1, -1]) {
      // Read each chain once, from its first run: skip runs that another run leads into.
      if (endingAt.has(`${first.x0 - 1}:${first.y - dy}`)) continue
      const chain: Array<EdgeRun> = [first]
      let current = first
      for (;;) {
        const next = startingAt.get(`${current.x1 + 1}:${current.y + dy}`)
        if (next === undefined) break
        chain.push(next)
        current = next
      }
      if (chain.length >= 3) chains.push(chain)
    }
  }
  return chains
}

/** A mask turned so that one of its four edges is on top: the reads map spots back. */
interface Turn {
  readonly w: number
  readonly h: number
  readonly mask: Uint8Array
  readonly back: (x: number, y: number) => readonly [number, number]
}

const turns = (mask: Uint8Array, w: number, h: number): Array<Turn> => {
  const make = (tw: number, th: number, from: (x: number, y: number) => readonly [number, number]): Turn => {
    const turned = new Uint8Array(tw * th)
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const [sx, sy] = from(x, y)
        turned[y * tw + x] = mask[sy * w + sx]!
      }
    return { w: tw, h: th, mask: turned, back: from }
  }
  return [
    make(w, h, (x, y) => [x, y]), // top edges
    make(w, h, (x, y) => [x, h - 1 - y]), // bottom edges
    make(h, w, (x, y) => [y, x]), // left edges
    make(h, w, (x, y) => [w - 1 - y, x]) // right edges
  ]
}

/**
 * Jaggies: a run along an edge at least 2 pixels shorter or longer than both
 * runs beside it (3, 1, 3 or 1, 3, 1). Steady patterns (2, 1, 2, 1) are a
 * line's rhythm and pass; a chain's first and last runs are cut by where the
 * edge turns, and are not judged.
 */
export const jaggies = (run: Run): Array<Spot> => {
  const spots: Array<Spot> = []
  run.frames.forEach((frame, f) => {
    const mask = frame.map((v) => (v > 0 ? 1 : 0))
    for (const turn of turns(mask, run.width, run.height)) {
      for (const chain of topEdgeChains(turn.mask, turn.w, turn.h)) {
        const lengths = chain.map((part) => part.x1 - part.x0 + 1)
        for (let i = 1; i < lengths.length - 1; i++) {
          const before = lengths[i - 1]!
          const self = lengths[i]!
          const after = lengths[i + 1]!
          if ((self <= Math.min(before, after) - 2) || (self >= Math.max(before, after) + 2)) {
            const [x, y] = turn.back(chain[i]!.x0, chain[i]!.y)
            spots.push({ frame: f, x, y })
          }
        }
      }
    }
  })
  return spots
}

// ---------------------------------------------------------------------------
// Doubles

/** A line this short is a speck (an ember, a chunk), not a line: its corner is its shape. */
const LINE = 5

/** Each drawn pixel's shape size (pixels touching, corners included). */
const shapeSizes = (frame: Uint8Array, w: number, h: number): Uint16Array => {
  const sizes = new Uint16Array(frame.length)
  const seen = new Uint8Array(frame.length)
  for (let start = 0; start < frame.length; start++) {
    if (frame[start] === 0 || seen[start] === 1) continue
    const shape: Array<number> = []
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const i = stack.pop()!
      shape.push(i)
      const x = i % w
      const y = Math.floor(i / w)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (frame[j]! > 0 && seen[j] === 0) {
            seen[j] = 1
            stack.push(j)
          }
        }
    }
    for (const i of shape) sizes[i] = Math.min(65535, shape.length)
  }
  return sizes
}

/**
 * Doubles: a pixel whose only two neighbours sit at a right angle to it
 * (one beside, one above or below). The two already touch at their corners,
 * so the pixel thickens a one-pixel line into an L. Specks under 5 pixels
 * are left alone: a 3-pixel ember shaped like an L is a chunk, not a line.
 */
export const doubles = (run: Run): Array<Spot> => {
  const spots: Array<Spot> = []
  const { width: w, height: h } = run
  run.frames.forEach((frame, f) => {
    const sizes = shapeSizes(frame, w, h)
    const lit = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && frame[y * w + x]! > 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!lit(x, y) || sizes[y * w + x]! < LINE) continue
        let count = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && lit(x + dx, y + dy)) count++
        if (count !== 2) continue
        const side = lit(x - 1, y) || lit(x + 1, y)
        const upDown = lit(x, y - 1) || lit(x, y + 1)
        if (side && upDown) spots.push({ frame: f, x, y })
      }
  })
  return spots
}

// ---------------------------------------------------------------------------
// Flicker

/**
 * Flicker: a pixel that is one color, then another (or empty) for a single
 * frame, then the first again. A loop wraps around its ends.
 */
export const flicker = (run: Run): { readonly spots: Array<Spot>; readonly share: number } => {
  const spots: Array<Spot> = []
  const frames = run.frames
  const n = frames.length
  let lit = 0
  for (const frame of frames) for (const v of frame) if (v > 0) lit++
  if (n < 3) return { spots, share: 0 }
  for (let f = 0; f < n; f++) {
    if (!run.loop && (f === 0 || f === n - 1)) continue
    const before = frames[(f - 1 + n) % n]!
    const self = frames[f]!
    const after = frames[(f + 1) % n]!
    for (let i = 0; i < self.length; i++) {
      const was = before[i]!
      if (was > 0 && after[i] === was && self[i] !== was) spots.push({ frame: f, x: i % run.width, y: Math.floor(i / run.width) })
    }
  }
  return { spots, share: lit === 0 ? 0 : spots.length / lit }
}

// ---------------------------------------------------------------------------
// Holes

/** Holes: an empty pixel with drawn pixels on all four sides, a pinhole inside a shape (two outlines a pixel apart leave rows of them). */
export const holes = (run: Run): Array<Spot> => {
  const spots: Array<Spot> = []
  const { width: w, height: h } = run
  run.frames.forEach((frame, f) => {
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (frame[i] === 0 && frame[i - 1]! > 0 && frame[i + 1]! > 0 && frame[i - w]! > 0 && frame[i + w]! > 0) spots.push({ frame: f, x, y })
      }
  })
  return spots
}

// ---------------------------------------------------------------------------
// Contrast

/** Colors closer than this (OKLab) to a background barely show on it. */
export const FAINT = 0.12

/** For each background, the share of drawn pixels that barely differ from it. */
export const faintOn = (run: Run, palette: Palette, backdrops: Readonly<Record<string, string>>): Array<{ readonly name: string; readonly hex: string; readonly share: number }> => {
  const labs = Object.values(palette).map((hex) => toOklab(parseHex(hex) ?? { r: 0, g: 0, b: 0 }))
  const counts = new Map<number, number>()
  let all = 0
  for (const frame of run.frames)
    for (const v of frame)
      if (v > 0) {
        counts.set(v, (counts.get(v) ?? 0) + 1)
        all++
      }
  return Object.entries(backdrops).map(([name, hex]) => {
    const back = toOklab(parseHex(hex) ?? { r: 0, g: 0, b: 0 })
    let faint = 0
    for (const [v, count] of counts) {
      const lab = labs[v - 1]!
      if (Math.hypot(lab.l - back.l, lab.a - back.a, lab.b - back.b) < FAINT) faint += count
    }
    return { name, hex, share: all === 0 ? 0 : faint / all }
  })
}
