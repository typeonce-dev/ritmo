/**
 * Making the fixed picture smaller: fewer, bigger pixels.
 *
 * Each new pixel covers a block of the old ones (any ratio, not only whole
 * ones) and takes the color covering most of the block. With "keep
 * outlines", the outline colors (`outline.ts`) are carried over as strokes
 * instead: every new pixel a stroke passes through is marked, the marks are
 * thinned back to one pixel without ever breaking a stroke, and the
 * one-pixel steps a shrink leaves in a stroke are turned into clean
 * diagonals. A lone dark pixel is no stroke and does not grow into a block.
 *
 * The stroke handling follows ToPixel's forced resize
 * (https://github.com/daisuqe/ToPixel).
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import { outlineColorsOfArt } from "./outline.ts"

export type ReduceMode = "common" | "outlines"

export const reduceModes: ReadonlyArray<{ readonly id: ReduceMode; readonly label: string }> = [
  { id: "outlines", label: "Keep outlines" },
  { id: "common", label: "Most common color" }
]

/** A new pixel at least this much covered by outline is outline, whatever thinning says. */
const SOLID_OUTLINE = 0.6

/** A block with no pixel of the kind asked for (distinct from transparent, which is a color here). */
const NONE = -2

/** The 8 neighbours in order around a pixel, from the one above, clockwise. */
const RING = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1]
] as const

/** The picture at `width` × `height` (at most its own size). */
export const reduce = (art: PixelArt, width: number, height: number, mode: ReduceMode): PixelArt => {
  const outWidth = Math.max(1, Math.min(art.width, Math.round(width)))
  const outHeight = Math.max(1, Math.min(art.height, Math.round(height)))
  if (outWidth === art.width && outHeight === art.height) return art
  const fx = art.width / outWidth
  const fy = art.height / outHeight
  const outline = mode === "outlines" ? outlineColorsOfArt(art) : art.palette.map(() => false)
  const isOutline = (index: number): boolean => index !== TRANSPARENT && outline[index] === true
  const size = outWidth * outHeight
  // Per new pixel: the most common outline color and the most common other color (or
  // transparent), and the share of the block the outline covers.
  const lineColor = new Int32Array(size).fill(NONE)
  const fillColor = new Int32Array(size).fill(NONE)
  const lineShare = new Float64Array(size)
  const lines = new Map<number, number>()
  const fills = new Map<number, number>()
  const top = (weights: Map<number, number>): number => {
    let best = NONE
    let most = -1
    for (const [index, weight] of weights) {
      if (weight > most) {
        best = index
        most = weight
      }
    }
    return best
  }
  for (let oy = 0; oy < outHeight; oy++) {
    const y0 = oy * fy
    const y1 = y0 + fy
    for (let ox = 0; ox < outWidth; ox++) {
      const x0 = ox * fx
      const x1 = x0 + fx
      lines.clear()
      fills.clear()
      let lineWeight = 0
      let total = 0
      for (let y = Math.floor(y0); y < Math.min(art.height, Math.ceil(y1)); y++) {
        const h = Math.min(y1, y + 1) - Math.max(y0, y)
        for (let x = Math.floor(x0); x < Math.min(art.width, Math.ceil(x1)); x++) {
          const w = (Math.min(x1, x + 1) - Math.max(x0, x)) * h
          const index = art.indices[y * art.width + x]!
          const weights = isOutline(index) ? lines : fills
          weights.set(index, (weights.get(index) ?? 0) + w)
          total += w
          if (isOutline(index)) lineWeight += w
        }
      }
      const cell = oy * outWidth + ox
      lineColor[cell] = top(lines)
      fillColor[cell] = top(fills)
      lineShare[cell] = total > 0 ? lineWeight / total : 0
    }
  }
  if (mode === "common") return { width: outWidth, height: outHeight, palette: art.palette, indices: fillColor }

  // Strokes: the new pixel holding each outline pixel's centre, and a straight path between
  // those of two touching outline pixels, so no link of a stroke can be lost. A lone outline
  // pixel (no outline neighbour) is no stroke.
  const marked = new Uint8Array(size)
  const cellX = (x: number): number => Math.min(outWidth - 1, Math.floor((x + 0.5) / fx))
  const cellY = (y: number): number => Math.min(outHeight - 1, Math.floor((y + 0.5) / fy))
  const darkAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < art.width && y < art.height && isOutline(art.indices[y * art.width + x]!)
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      if (!darkAt(x, y) || !RING.some(([dx, dy]) => darkAt(x + dx, y + dy))) continue
      const ax = cellX(x)
      const ay = cellY(y)
      marked[ay * outWidth + ax] = 1
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1]
      ] as const) {
        if (!darkAt(x + dx, y + dy)) continue
        const bx = cellX(x + dx)
        const by = cellY(y + dy)
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
        for (let s = 1; s < steps; s++) marked[Math.round(ay + ((by - ay) * s) / steps) * outWidth + Math.round(ax + ((bx - ax) * s) / steps)] = 1
      }
    }
  }
  for (let cell = 0; cell < size; cell++) if (lineShare[cell]! >= SOLID_OUTLINE) marked[cell] = 1

  // Thinning, least covered first: a mark goes only when the marks around it stay one
  // connected group and no hole opens; stroke ends and solid outline stay.
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < outWidth && y < outHeight && marked[y * outWidth + x] === 1
  const removable = (x: number, y: number): boolean => {
    const ring = RING.map(([dx, dy]) => on(x + dx, y + dy))
    if (ring.filter(Boolean).length < 2) return false
    const groups = (member: ReadonlyArray<boolean>, linked: (u: number, v: number) => boolean, starts: ReadonlyArray<number>): number => {
      const seen = new Array<boolean>(8).fill(false)
      let count = 0
      for (const start of starts) {
        if (!member[start] || seen[start]) continue
        count++
        const stack = [start]
        seen[start] = true
        while (stack.length > 0) {
          const u = stack.pop()!
          for (let v = 0; v < 8; v++) {
            if (member[v] && !seen[v] && linked(u, v)) {
              seen[v] = true
              stack.push(v)
            }
          }
        }
      }
      return count
    }
    const dx = (u: number, v: number): number => Math.abs(RING[u]![0] - RING[v]![0])
    const dy = (u: number, v: number): number => Math.abs(RING[u]![1] - RING[v]![1])
    const all = [0, 1, 2, 3, 4, 5, 6, 7]
    if (groups(ring, (u, v) => Math.max(dx(u, v), dy(u, v)) === 1, all) !== 1) return false
    // The background around it, joined only side by side, touches it in one place.
    return groups(ring.map((value) => !value), (u, v) => dx(u, v) + dy(u, v) === 1, [0, 2, 4, 6]) === 1
  }
  const candidates: Array<number> = []
  for (let cell = 0; cell < size; cell++) if (marked[cell] === 1 && lineShare[cell]! < SOLID_OUTLINE) candidates.push(cell)
  candidates.sort((a, b) => lineShare[a]! - lineShare[b]!)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const cell of candidates) {
      if (marked[cell] === 1 && removable(cell % outWidth, Math.floor(cell / outWidth))) {
        marked[cell] = 0
        changed = true
      }
    }
    if (!changed) break
  }

  // Colors: a stroke pixel its block's outline color, any other its block's other color. A
  // block with none of the color it needs borrows a neighbour's.
  const indices = new Int32Array(size)
  const neighbour = (cell: number, has: (other: number) => boolean): number => {
    const x = cell % outWidth
    const y = Math.floor(cell / outWidth)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], ...RING] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < outWidth && ny < outHeight && has(ny * outWidth + nx)) return ny * outWidth + nx
    }
    return -1
  }
  for (let cell = 0; cell < size; cell++) {
    const stroke = marked[cell] === 1
    const own = stroke ? lineColor[cell]! : fillColor[cell]!
    const from = own !== NONE ? cell : neighbour(cell, (other) => (marked[other] === 1) === stroke && (stroke ? lineColor : fillColor)[other] !== NONE)
    indices[cell] = from >= 0 ? (stroke ? lineColor : fillColor)[from]! : stroke ? fillColor[cell]! : lineColor[cell]!
  }
  smoothStairs(indices, outWidth, outHeight, isOutline)
  return { width: outWidth, height: outHeight, palette: art.palette, indices }
}

/**
 * Turns the one-pixel steps a shrink leaves in a stroke (■ over ■■■) into
 * diagonals (■ over □■■): the elbow pixel of a stroke goes when it has
 * exactly two outline neighbours, one beside and one above or below, and one
 * of its two arms is a single pixel (two long arms are a real corner). Of
 * two elbows next to each other, the one on longer arms goes. The pixel
 * takes the color on the stroke's open side.
 */
export const smoothStairs = (indices: Int32Array, width: number, height: number, isOutline: (index: number) => boolean): void => {
  const dark = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && isOutline(indices[y * width + x]!)
  const arm = (x: number, y: number, dx: number, dy: number): number => {
    let length = 0
    while (dark(x + dx * (length + 1), y + dy * (length + 1))) length++
    return length
  }
  const elbow = (x: number, y: number): { readonly vy: number; readonly hx: number; readonly score: number } | undefined => {
    if (!dark(x, y)) return undefined
    const up = dark(x, y - 1)
    const down = dark(x, y + 1)
    const left = dark(x - 1, y)
    const right = dark(x + 1, y)
    if (Number(up) + Number(down) + Number(left) + Number(right) !== 2 || !(up || down) || !(left || right)) return undefined
    // Any other outline neighbour (a diagonal) might hang on this pixel: it stays.
    if (RING.filter(([dx, dy]) => dark(x + dx, y + dy)).length !== 2) return undefined
    const vy = up ? -1 : 1
    const hx = left ? -1 : 1
    const vertical = arm(x, y, 0, vy)
    const horizontal = arm(x, y, hx, 0)
    if (vertical > 1 && horizontal > 1) return undefined
    return { vy, hx, score: vertical + horizontal }
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const here = elbow(x, y)
        if (here === undefined) continue
        const along = elbow(x, y + here.vy)
        const beside = elbow(x + here.hx, y)
        if ((along !== undefined && along.score > here.score) || (beside !== undefined && beside.score > here.score)) continue
        const sx = x - here.hx
        const sy = y - here.vy
        const from = sx >= 0 && sx < width ? y * width + sx : sy >= 0 && sy < height ? sy * width + x : -1
        indices[y * width + x] = from >= 0 ? indices[from]! : TRANSPARENT
        changed = true
      }
    }
    if (!changed) break
  }
}
