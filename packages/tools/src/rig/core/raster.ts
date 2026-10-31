/**
 * The rasterizer, with no platform imports: placed parts as signed
 * distance fields, sampled 4 × 4 per pixel and averaged (anti-aliasing), into
 * transparent RGBA. Pixels far from an edge are filled or skipped whole;
 * only edge pixels are sampled. The same distance fields find the part
 * under a pixel (`partAt`). Deterministic: the same frame, the same bytes.
 */
import type { RgbaImage } from "../../pixel/core/grid.ts"
import type { Frame } from "./clip.ts"
import type { Drawn, Geom } from "./pose.ts"
import { tipOf, type Look, type Rig, type V } from "./rig.ts"

/** A color as red, green, and blue from 0 to 255, and alpha from 0 to 1. */
export type Rgba = readonly [number, number, number, number]

/** A `#rrggbb` or `#rrggbbaa` color as RGB 0 to 255 and alpha 0 to 1. */
export const rgbaOf = (color: string): Rgba => {
  const v = color.replace("#", "")
  const n = (i: number): number => parseInt(v.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), v.length >= 8 ? n(6) / 255 : 1]
}

const SS = 4
/** Half a pixel's diagonal, in samples, and a little more: a pixel whose middle is further than this from an edge is all in or all out. */
const REACH = SS * 0.7072 + 0.5

// ---------------------------------------------------------------------------
// Distance fields (after Inigo Quilez), in any units

const unevenCapsule = (px: number, py: number, a: V, b: V, ra: number, rb: number): number => {
  const bx = b[0] - a[0]
  const by = b[1] - a[1]
  const h = bx * bx + by * by
  if (h < 1e-9) return Math.hypot(px - a[0], py - a[1]) - Math.max(ra, rb)
  const x = px - a[0]
  const y = py - a[1]
  const qx = Math.abs(x * by - y * bx) / h
  const qy = (x * bx + y * by) / h
  const k0 = ra - rb
  if (k0 * k0 >= h) return Math.hypot(px - a[0], py - a[1]) - ra
  const cx = Math.sqrt(h - k0 * k0)
  const cy = k0
  const k = cx * qy - cy * qx
  const m = cx * qx + cy * qy
  const n = qx * qx + qy * qy
  if (k < 0) return Math.sqrt(h * n) - ra
  if (k > cx) return Math.sqrt(h * (n + 1 - 2 * qy)) - rb
  return m - ra
}

const ellipse = (px: number, py: number, c: V, rx: number, ry: number, angle: number): number => {
  const cs = Math.cos(angle)
  const sn = Math.sin(angle)
  const x = (px - c[0]) * cs + (py - c[1]) * sn
  const y = -(px - c[0]) * sn + (py - c[1]) * cs
  const k0 = Math.hypot(x / rx, y / ry)
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry))
  return k1 < 1e-9 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1
}

const polygon = (px: number, py: number, pts: ReadonlyArray<V>): number => {
  let d = Infinity
  let s = 1
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
    const [ax, ay] = pts[i]!
    const [bx, by] = pts[j]!
    const ex = bx - ax
    const ey = by - ay
    const wx = px - ax
    const wy = py - ay
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)))
    d = Math.min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2)
    const c1 = py >= ay
    const c2 = py < by
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
  }
  return s * Math.sqrt(d)
}

/** A placed shape's signed distance at a world point (world units, y up): below 0 inside. */
export const distance = (g: Geom, x: number, y: number): number =>
  g.kind === "capsule" ? unevenCapsule(x, y, g.a, g.b, g.ra, g.rb) : g.kind === "ellipse" ? ellipse(x, y, g.c, g.rx, g.ry, (g.angle * Math.PI) / 180) : polygon(x, y, g.points) - g.round

/** The topmost part drawn at a world point (its outline counts), or, with none there, the nearest within `slack`. */
export const partAt = (drawn: ReadonlyArray<Drawn>, x: number, y: number, slack = 0): string | undefined => {
  let near: string | undefined
  let best = slack
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i]!
    const gap = distance(d.geom, x, y) - (d.outline === null ? 0 : d.line)
    if (gap <= 0) return d.part
    if (gap <= best) {
      best = gap
      near = d.part
    }
  }
  return near
}

// ---------------------------------------------------------------------------
// The canvas

interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/**
 * A premultiplied RGBA canvas in world units: `scale` pixels per world unit,
 * the world origin on `anchor` (y up in the world, down on screen). Shapes
 * are sampled 4 × 4 per pixel (coordinates in samples), and each shape's
 * coverage blends into the pixel.
 */
const canvas = (width: number, height: number, scale: number, anchor: V) => {
  const buf = new Float32Array(width * height * 4)
  /** A world point in sample coordinates. */
  const toSamples = (p: V): V => [(anchor[0] + p[0] * scale) * SS, (anchor[1] - p[1] * scale) * SS]
  /** Blends `inside` covering `ci` of pixel `i` and `edge` covering `ce` (disjoint parts of it). */
  const put = (i: number, inside: Rgba, ci: number, edge: Rgba | null, ce: number): void => {
    const ai = inside[3] * ci
    const ae = edge === null ? 0 : edge[3] * ce
    const k = 1 - ai - ae
    buf[i] = buf[i]! * k + inside[0] * ai + (edge === null ? 0 : edge[0] * ae)
    buf[i + 1] = buf[i + 1]! * k + inside[1] * ai + (edge === null ? 0 : edge[1] * ae)
    buf[i + 2] = buf[i + 2]! * k + inside[2] * ai + (edge === null ? 0 : edge[2] * ae)
    buf[i + 3] = buf[i + 3]! * k + ai + ae
  }
  /** Paints where `sdf` (in samples) is at or below 0 with `inside`, and up to `band` outside it with `edge`. `box` is in samples. */
  const paint = (box: Box, sdf: (x: number, y: number) => number, inside: Rgba, edge: Rgba | null, band: number): void => {
    const outer = edge === null ? 0 : band
    const grow = outer + SS
    const px0 = Math.max(0, Math.floor((box.x0 - grow) / SS))
    const py0 = Math.max(0, Math.floor((box.y0 - grow) / SS))
    const px1 = Math.min(width - 1, Math.ceil((box.x1 + grow) / SS))
    const py1 = Math.min(height - 1, Math.ceil((box.y1 + grow) / SS))
    const n = SS * SS
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const i = (py * width + px) * 4
        const d0 = sdf((px + 0.5) * SS, (py + 0.5) * SS)
        if (d0 > outer + REACH) continue
        if (d0 < -REACH) {
          put(i, inside, 1, null, 0)
          continue
        }
        if (edge !== null && d0 > REACH && d0 < band - REACH) {
          put(i, edge, 1, null, 0)
          continue
        }
        let ni = 0
        let ne = 0
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++) {
            const d = sdf(px * SS + sx + 0.5, py * SS + sy + 0.5)
            if (d <= 0) ni++
            else if (edge !== null && d <= band) ne++
          }
        if (ni + ne > 0) put(i, inside, ni / n, edge, ne / n)
      }
    }
  }
  /** Straight-alpha RGBA. */
  const toImage = (): RgbaImage => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      const a = buf[i + 3]!
      if (a <= 1e-6) continue
      data[i] = Math.round(buf[i]! / a)
      data[i + 1] = Math.round(buf[i + 1]! / a)
      data[i + 2] = Math.round(buf[i + 2]! / a)
      data[i + 3] = Math.round(Math.min(1, a) * 255)
    }
    return { width, height, data }
  }
  return { scale, toSamples, paint, toImage }
}
type Canvas = ReturnType<typeof canvas>

const canvasFor = (rig: Rig, scale: number): Canvas => canvas(Math.round(rig.width * scale), Math.round(rig.height * scale), scale, [rig.anchor[0] * scale, rig.anchor[1] * scale])

const drawGeom = (cv: Canvas, g: Geom, fill: Rgba, outline: Rgba | null, line: number): void => {
  const k = cv.scale * SS
  const band = outline === null ? 0 : line * k
  if (g.kind === "capsule") {
    const a = cv.toSamples(g.a)
    const b = cv.toSamples(g.b)
    const ra = g.ra * k
    const rb = g.rb * k
    const r = Math.max(ra, rb)
    cv.paint({ x0: Math.min(a[0], b[0]) - r, y0: Math.min(a[1], b[1]) - r, x1: Math.max(a[0], b[0]) + r, y1: Math.max(a[1], b[1]) + r }, (x, y) => unevenCapsule(x, y, a, b, ra, rb), fill, outline, band)
  } else if (g.kind === "ellipse") {
    const c = cv.toSamples(g.c)
    const rx = g.rx * k
    const ry = g.ry * k
    const r = Math.max(rx, ry)
    // Screen y is flipped, so the angle turns the other way.
    cv.paint({ x0: c[0] - r, y0: c[1] - r, x1: c[0] + r, y1: c[1] + r }, (x, y) => ellipse(x, y, c, rx, ry, (-g.angle * Math.PI) / 180), fill, outline, band)
  } else {
    const pts = g.points.map((p) => cv.toSamples(p))
    const round = g.round * k
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    cv.paint({ x0: Math.min(...xs) - round, y0: Math.min(...ys) - round, x1: Math.max(...xs) + round, y1: Math.max(...ys) + round }, (x, y) => polygon(x, y, pts) - round, fill, outline, band)
  }
}

// ---------------------------------------------------------------------------
// Layers

/** The character alone on a transparent frame, `scale` pixels per world unit. */
export const renderArt = (rig: Rig, frame: Frame, scale: number): RgbaImage => {
  const cv = canvasFor(rig, scale)
  for (const d of frame.drawn) drawGeom(cv, d.geom, rgbaOf(d.fill), d.outline === null ? null : rgbaOf(d.outline), d.line)
  return cv.toImage()
}

const BONE = rgbaOf("#ffd166")
const JOINT = rgbaOf("#ef476f")
const TRAIL = rgbaOf("#06d6a0")

/** The shown bones (lines from start to tip, joints as dots), and the trail bone's tip on every frame, on a transparent frame. */
export const renderBones = (rig: Rig, frame: Frame, scale: number, trail?: { readonly points: ReadonlyArray<V | undefined>; readonly current: number }): RgbaImage => {
  const cv = canvasFor(rig, scale)
  const k = scale * SS
  const dot = (p: V, r: number, color: Rgba): void => cv.paint({ x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r }, (x, y) => Math.hypot(x - p[0], y - p[1]) - r, color, null, 0)
  for (const name of rig.order) {
    if (!frame.shown.has(name)) continue
    const m = frame.world[name]!
    const a = cv.toSamples([m.x, m.y])
    const b = cv.toSamples(tipOf(rig, frame.world, name))
    cv.paint({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) }, (x, y) => unevenCapsule(x, y, a, b, 0.7 * k, 0.35 * k), BONE, null, 0)
    dot(a, 1.6 * k, JOINT)
  }
  if (trail !== undefined)
    trail.points.forEach((p, i) => {
      if (p !== undefined) dot(cv.toSamples(p), (i === trail.current ? 2.4 : 1.2) * k, TRAIL)
    })
  return cv.toImage()
}

/** The background with the floor below the ground, and the ground line. Opaque. */
export const renderBackdrop = (rig: Rig, look: Look, scale: number): RgbaImage => {
  const w = Math.round(rig.width * scale)
  const h = Math.round(rig.height * scale)
  const gy = rig.anchor[1] * scale
  const data = new Uint8ClampedArray(w * h * 4)
  const bg = rgbaOf(look.background)
  const floor = rgbaOf(look.floor)
  const line = rgbaOf(look.ground)
  for (let y = 0; y < h; y++) {
    const c = Math.abs(y + 0.5 - gy) <= Math.max(0.6, 0.6 * scale) ? line : y + 0.5 >= gy ? floor : bg
    for (let x = 0; x < w; x++) data.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
  }
  return { width: w, height: h, data }
}

/** `layer` laid over `base` at `alpha`; the base's own alpha is kept. */
export const over = (base: RgbaImage, layer: RgbaImage, alpha = 1): RgbaImage => {
  const data = new Uint8ClampedArray(base.data)
  for (let i = 0; i < data.length; i += 4) {
    const a = (layer.data[i + 3]! / 255) * alpha
    if (a === 0) continue
    data[i] = Math.round(data[i]! * (1 - a) + layer.data[i]! * a)
    data[i + 1] = Math.round(data[i + 1]! * (1 - a) + layer.data[i + 1]! * a)
    data[i + 2] = Math.round(data[i + 2]! * (1 - a) + layer.data[i + 2]! * a)
  }
  return { width: base.width, height: base.height, data }
}
