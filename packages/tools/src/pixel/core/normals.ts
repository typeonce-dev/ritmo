/**
 * Normal maps for pixel art: a second picture, the same size as the art, where
 * each pixel's color says which way that pixel faces, so a game's light can
 * shade it. Everything here is estimated from the art alone, and pure: the
 * command, the review page, and the tests share it.
 *
 * Pixels of one color that touch form a surface. A height is guessed for each
 * pixel from how far it is inside the silhouette and how bright it is, and a
 * surface faces the average way that height slopes, snapped to 8 directions
 * and 4 tilts, so the map stays in flat facets like the art instead of a
 * smooth bulge.
 *
 * That method is Pixel Art Lighter's, by Red Hat Sprite (MIT; see this
 * package's LICENSE). What this adds is the animation: a surface that carries
 * on from one frame to the next keeps one direction through the animation, so
 * a pixel that does not change does not change its light either, and
 * `flickerOf` measures how far that holds.
 *
 * The map is an estimate. It cannot tell painted shading from a dark material,
 * so a person looks at it under a light (`pixel review`) and corrections name
 * a surface and the way it should face.
 */
import type { RgbaImage } from "./grid.ts"
import type { Issue } from "./lint.ts"
import type { Decoded } from "./recipe.ts"

// ---------------------------------------------------------------------------
// What a map is made from

/** Which way a surface faces, as a person sees it on the picture. */
export type Facing = "front" | "up" | "up-right" | "right" | "down-right" | "down" | "down-left" | "left" | "up-left"
export const facings: ReadonlyArray<Facing> = ["up-left", "up", "up-right", "left", "front", "right", "down-left", "down", "down-right"]
export const isFacing = (value: unknown): value is Facing => facings.some((facing) => facing === value)

/** What the art is of, which sets how much of the height comes from the silhouette and how much from brightness. */
export type NormalPreset = "character" | "object" | "architecture" | "terrain"
export const normalPresets: ReadonlyArray<NormalPreset> = ["character", "object", "architecture", "terrain"]
export const isNormalPreset = (value: unknown): value is NormalPreset => normalPresets.some((preset) => preset === value)

/**
 * Says a surface faces another way. The area is where the person pointed, in
 * the frame's own pixels, with the frame counted from 0 in its animation (a
 * still has one frame, 0, and no animation), as a review comment gives it. It
 * picks whole surfaces, those mostly inside it or making up a good part of it,
 * and they take the direction in every frame of the animation they carry on
 * through: a patch of one surface on one frame would only flicker.
 */
export interface NormalCorrection {
  readonly animation?: string | undefined
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly facing: Facing
  /** How far from the viewer it leans, in degrees (45 when unset). "front" has none. */
  readonly tilt?: number | undefined
}

export interface NormalSettings {
  readonly preset: NormalPreset
  /** How steep the shape is, in percent (the preset's own when unset). */
  readonly strength?: number | undefined
  readonly corrections: ReadonlyArray<NormalCorrection>
}

/** One frame of the art: where it is on the picture, and its place in its animation. */
export interface NormalFrame {
  readonly animation?: string | undefined
  readonly index: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

interface PresetValues {
  /** How far inside the silhouette still adds height, in pixels. */
  readonly reach: number
  /** How much the silhouette adds to the height. */
  readonly silhouette: number
  /** How much brightness adds to the height. */
  readonly brightness: number
  /** How many times the height is blurred. */
  readonly blur: number
  /** How steep the shape is, in percent. */
  readonly strength: number
  /** How readily a large surface splits into facets, 0 to 100. */
  readonly facets: number
}

const PRESETS: Readonly<Record<NormalPreset, PresetValues>> = {
  character: { reach: 8, silhouette: 0.65, brightness: 1.2, blur: 2, strength: 65, facets: 15 },
  // Twice Pixel Art Lighter's silhouette: on a ball with known directions, 27 degrees off where its own is 38 and a flat map 45. Not on `character`: on animated sprites it breaks shapes up, and worst-case flicker went from 5% to 14%.
  object: { reach: 16, silhouette: 1.3, brightness: 2.1, blur: 3, strength: 100, facets: 35 },
  architecture: { reach: 16, silhouette: 0, brightness: 3.5, blur: 1, strength: 100, facets: 20 },
  terrain: { reach: 16, silhouette: 0.12, brightness: 4, blur: 3, strength: 110, facets: 50 }
}

// ---------------------------------------------------------------------------
// Vectors

type Vector = readonly [number, number, number]

const unit = (x: number, y: number, z: number): Vector => {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

/** The direction a facing and a tilt name: x to the right, y up the picture, z towards the viewer. */
export const vectorOfFacing = (facing: Facing, tilt = 45): Vector => {
  if (facing === "front") return [0, 0, 1]
  const across = facing.endsWith("right") ? 1 : facing.endsWith("left") ? -1 : 0
  const down = facing.startsWith("up") ? 1 : facing.startsWith("down") ? -1 : 0
  const lean = (tilt * Math.PI) / 180
  const side = Math.sin(lean) / Math.hypot(across, down)
  return [across * side, down * side, Math.cos(lean)]
}

/** A direction as flat facets: 8 ways round, and one of 4 tilts; nearly straight on is straight on. */
const snap = (vector: Vector, preset: NormalPreset, scale: number): Vector => {
  const [x, y, z] = unit(vector[0], vector[1], vector[2])
  const tilt = Math.hypot(x, y)
  if (tilt < 0.12 || z < 0) return [0, 0, 1]
  const angle = (Math.round(Math.atan2(y, x) / (Math.PI / 4)) * Math.PI) / 4
  const lean = preset === "architecture" ? Math.min(0.9, 0.6 * scale) : tilt < 0.3 ? 0.24 : tilt < 0.6 ? 0.48 : tilt < 0.85 ? 0.72 : 0.9
  return [Math.cos(angle) * lean, Math.sin(angle) * lean, Math.sqrt(1 - lean * lean)]
}

// ---------------------------------------------------------------------------
// One frame

/** A surface: pixels of one color that touch. */
interface Surface {
  readonly pixels: ReadonlyArray<number>
  /** Its color, as one number. */
  readonly color: number
  readonly brightness: number
  /** The average way it slopes. */
  mean: Vector
  /** Dark and one pixel thin: an outline, with no direction of its own. */
  thin: boolean
  /** The surface it carries on as through the animation. */
  parent: number
}

interface FrameRead {
  readonly frame: NormalFrame
  readonly width: number
  readonly height: number
  readonly size: number
  /** Whether each pixel is drawn. */
  readonly drawn: Uint8Array
  /** Each pixel's surface, -1 when it is not drawn. */
  readonly labels: Int32Array
  readonly surfaces: Array<Surface>
  /** Each pixel's own slope, three numbers each. */
  readonly slopes: Float32Array
  /** Each pixel's direction in the end, three numbers each. */
  readonly directions: Float32Array
}

const neighbours = (at: number, width: number, height: number): ReadonlyArray<number> => {
  const x = at % width
  const y = (at / width) | 0
  const out: Array<number> = []
  if (x > 0) out.push(at - 1)
  if (x < width - 1) out.push(at + 1)
  if (y > 0) out.push(at - width)
  if (y < height - 1) out.push(at + width)
  return out
}

const brightnessAt = (data: Uint8ClampedArray, i: number): number => (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255

/** The frame's surfaces and what is drawn. Their directions come later, once the animation's range of brightness is known. */
const surfacesOf = (image: RgbaImage, frame: NormalFrame): FrameRead => {
  const width = frame.w
  const height = frame.h
  const size = width * height
  const drawn = new Uint8Array(size)
  const labels = new Int32Array(size).fill(-1)
  const source = (at: number): number => ((frame.y + ((at / width) | 0)) * image.width + frame.x + at % width) * 4
  const colorAt = (at: number): number => {
    const i = source(at)
    return (image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!
  }
  for (let at = 0; at < size; at++) drawn[at] = image.data[source(at) + 3]! > 0 ? 1 : 0
  const queue = new Int32Array(size)
  const surfaces: Array<Surface> = []
  for (let start = 0; start < size; start++) {
    if (drawn[start] === 0 || labels[start]! >= 0) continue
    const id = surfaces.length
    const color = colorAt(start)
    const pixels: Array<number> = []
    let head = 0
    let tail = 1
    queue[0] = start
    labels[start] = id
    while (head < tail) {
      const at = queue[head++]!
      pixels.push(at)
      for (const next of neighbours(at, width, height)) {
        if (drawn[next] === 1 && labels[next]! < 0 && colorAt(next) === color) {
          labels[next] = id
          queue[tail++] = next
        }
      }
    }
    surfaces.push({ pixels, color, brightness: brightnessAt(image.data, source(start)), mean: [0, 0, 1], thin: false, parent: id })
  }
  return { frame, width, height, size, drawn, labels, surfaces, slopes: new Float32Array(size * 3), directions: new Float32Array(size * 3) }
}

/** Each pixel's slope from the height guessed for it, and each surface's average. `low` and `range` are the animation's brightness, so a frame's darkest pixel moving out of view changes nothing. */
const slopesOf = (read: FrameRead, preset: PresetValues, name: NormalPreset, scale: number, low: number, range: number): void => {
  const { width, height, size, drawn, labels, surfaces, slopes } = read
  const inside = new Float32Array(size).fill(size)
  const queue = new Int32Array(size)
  let head = 0
  let tail = 0
  for (let at = 0; at < size; at++) {
    if (drawn[at] === 0) continue
    const x = at % width
    const edge = x === 0 || x === width - 1 || at < width || at >= size - width || neighbours(at, width, height).some((next) => drawn[next] === 0)
    if (edge) {
      inside[at] = 1
      queue[tail++] = at
    }
  }
  while (head < tail) {
    const at = queue[head++]!
    for (const next of neighbours(at, width, height)) {
      if (drawn[next] === 1 && inside[next]! > inside[at]! + 1) {
        inside[next] = inside[at]! + 1
        queue[tail++] = next
      }
    }
  }
  let field = new Float32Array(size)
  for (let at = 0; at < size; at++) {
    if (drawn[at] === 0) continue
    const tone = range > 1e-5 ? (surfaces[labels[at]!]!.brightness - low) / range : 0.75
    field[at] = Math.sqrt(Math.min(inside[at]!, preset.reach)) * preset.silhouette + tone * preset.brightness
  }
  for (let pass = 0; pass < preset.blur; pass++) {
    const blurred = new Float32Array(size)
    for (let at = 0; at < size; at++) {
      if (drawn[at] === 0) continue
      let sum = field[at]! * 2
      let count = 2
      for (const next of neighbours(at, width, height)) {
        if (drawn[next] === 1) {
          sum += field[next]!
          count++
        }
      }
      blurred[at] = sum / count
    }
    field = blurred
  }
  for (let at = 0; at < size; at++) {
    if (drawn[at] === 0) continue
    const x = at % width
    const y = (at / width) | 0
    const heightAt = (next: number): number => (drawn[next] === 1 ? field[next]! : field[at]!)
    const dx = (x < width - 1 ? heightAt(at + 1) : field[at]!) - (x > 0 ? heightAt(at - 1) : field[at]!)
    const dy = (y < height - 1 ? heightAt(at + width) : field[at]!) - (y > 0 ? heightAt(at - width) : field[at]!)
    slopes.set(unit(-dx * scale, dy * scale, 1), at * 3)
  }
  for (const surface of surfaces) {
    let x = 0
    let y = 0
    let z = 0
    for (const at of surface.pixels) {
      if (name === "architecture" && Math.hypot(slopes[at * 3]!, slopes[at * 3 + 1]!) < 0.06) continue
      x += slopes[at * 3]!
      y += slopes[at * 3 + 1]!
      z += slopes[at * 3 + 2]!
    }
    surface.mean = z === 0 ? [0, 0, 1] : unit(x, y, z)
    // A dark line one pixel wide draws an edge: it is not a surface that faces anywhere.
    if (surface.brightness <= low + range * 0.24) {
      let solid = 0
      for (const at of surface.pixels) {
        const around = neighbours(at, width, height)
        if (around.length === 4 && around.every((next) => labels[next] === labels[at])) solid++
      }
      surface.thin = solid / surface.pixels.length < 0.15
    }
  }
}

/** Sets one surface's direction, splitting a large one that slopes clearly two ways into facets. */
const faceSurface = (read: FrameRead, surface: Surface, direction: Vector, preset: PresetValues, name: NormalPreset, scale: number): void => {
  const { slopes, directions } = read
  for (const at of surface.pixels) directions.set(direction, at * 3)
  if (surface.pixels.length < Math.round(180 - preset.facets * 1.1)) return
  const groups = new Map<number, Array<number>>()
  for (const at of surface.pixels) {
    const x = slopes[at * 3]!
    const y = slopes[at * 3 + 1]!
    const key = Math.hypot(x, y) > 0.35 ? Math.round(Math.atan2(y, x) / (Math.PI / 2)) : 9
    groups.set(key, [...(groups.get(key) ?? []), at])
  }
  const sized = [...groups.values()].filter((group) => group.length >= Math.max(16, surface.pixels.length * 0.16))
  if (sized.length < 2) return
  const means = sized.map((group) => {
    let x = 0
    let y = 0
    let z = 0
    for (const at of group) {
      x += slopes[at * 3]!
      y += slopes[at * 3 + 1]!
      z += slopes[at * 3 + 2]!
    }
    return unit(x, y, z)
  })
  const apart = means.some((a, i) => means.some((b, j) => j < i && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0.8 - preset.facets * 0.001))
  if (!apart) return
  for (const [i, group] of sized.entries()) {
    const facet = snap(means[i]!, name, scale)
    for (const at of group) directions.set(facet, at * 3)
  }
}

/** An outline takes the direction of the surface it edges, the nearest one spreading out. */
const mergeOutlines = (read: FrameRead): void => {
  const { width, height, size, drawn, labels, surfaces, directions } = read
  const done = new Uint8Array(size)
  const queue = new Int32Array(size)
  let head = 0
  let tail = 0
  for (let at = 0; at < size; at++) {
    if (drawn[at] === 1 && !surfaces[labels[at]!]!.thin) {
      done[at] = 1
      queue[tail++] = at
    }
  }
  while (head < tail) {
    const at = queue[head++]!
    for (const next of neighbours(at, width, height)) {
      if (drawn[next] === 1 && done[next] === 0) {
        done[next] = 1
        directions.set(directions.subarray(at * 3, at * 3 + 3), next * 3)
        queue[tail++] = next
      }
    }
  }
}

/** A run of one or two pixels facing its own way reads as a speck: it takes a neighbour's direction. */
const absorbSpecks = (read: FrameRead): void => {
  const { width, height, size, drawn, directions } = read
  const seen = new Uint8Array(size)
  const queue = new Int32Array(size)
  const sameWay = (a: number, b: number): boolean => Math.abs(directions[a * 3]! - directions[b * 3]!) < 0.001 && Math.abs(directions[a * 3 + 1]! - directions[b * 3 + 1]!) < 0.001
  for (let start = 0; start < size; start++) {
    if (drawn[start] === 0 || seen[start] === 1) continue
    const run: Array<number> = []
    let head = 0
    let tail = 1
    queue[0] = start
    seen[start] = 1
    while (head < tail) {
      const at = queue[head++]!
      run.push(at)
      for (const next of neighbours(at, width, height)) {
        if (drawn[next] === 1 && seen[next] === 0 && sameWay(next, start)) {
          seen[next] = 1
          queue[tail++] = next
        }
      }
    }
    if (run.length > 2) continue
    const other = run.flatMap((at) => neighbours(at, width, height)).find((next) => drawn[next] === 1 && !run.includes(next))
    if (other === undefined) continue
    for (const at of run) directions.set(directions.subarray(other * 3, other * 3 + 3), at * 3)
  }
}

// ---------------------------------------------------------------------------
// Carrying surfaces through an animation

const find = (surfaces: Array<Surface>, id: number): number => {
  let root = id
  while (surfaces[root]!.parent !== root) root = surfaces[root]!.parent
  surfaces[id]!.parent = root
  return root
}

/** A surface sharing this much of the smaller one's pixels with a same-colored one in the next frame is the same surface, moved a little. */
const CARRIES = 0.3

/** The surfaces of one animation's frames, all in one list, each pointing at the one it carries on as. */
const carryThrough = (reads: ReadonlyArray<FrameRead>): Array<Surface> => {
  const all: Array<Surface> = []
  for (const read of reads) {
    for (const surface of read.surfaces) {
      surface.parent = all.length
      all.push(surface)
    }
  }
  if (reads.length < 2) return all
  for (const [f, read] of reads.entries()) {
    const nextFrame = (f + 1) % reads.length
    const next = reads[nextFrame]!
    if (next === read) continue
    for (const surface of read.surfaces) {
      const shared = new Map<number, number>()
      for (const at of surface.pixels) {
        if (next.width !== read.width || next.height !== read.height) break
        const label = next.labels[at]!
        if (label >= 0 && next.surfaces[label]!.color === surface.color) shared.set(label, (shared.get(label) ?? 0) + 1)
      }
      for (const [label, count] of shared) {
        const other = next.surfaces[label]!
        if (count / Math.min(surface.pixels.length, other.pixels.length) >= CARRIES) {
          const a = find(all, surface.parent)
          const b = find(all, other.parent)
          if (a !== b) all[a]!.parent = b
        }
      }
    }
  }
  return all
}

// ---------------------------------------------------------------------------
// The whole map

/** What a correction did: how many pixels it turned, over how many frames, and why it did nothing, when it did nothing. */
export interface CorrectionResult {
  readonly pixels: number
  readonly frames: number
  readonly problem: string | undefined
}

export interface MadeNormals {
  /** The map: the art's size, each drawn pixel's direction as color (x, y, z from 0 to 255, y up), and the art's alpha. */
  readonly image: RgbaImage
  /** One for each of the settings' corrections. */
  readonly corrections: ReadonlyArray<CorrectionResult>
  /** How much of what is drawn faces the viewer: near 1, the map adds next to nothing. */
  readonly front: number
}

const groupsOf = <F extends NormalFrame>(frames: ReadonlyArray<F>): ReadonlyArray<ReadonlyArray<F>> => {
  const groups = new Map<string, Array<F>>()
  for (const frame of frames) {
    const key = frame.animation ?? ""
    groups.set(key, [...(groups.get(key) ?? []), frame])
  }
  return [...groups.values()].map((group) => [...group].sort((a, b) => a.index - b.index))
}

/** How much of what is drawn in a correction's area a surface must be to count as pointed at, when it is not mostly inside the area. */
const POINTED_AT = 1 / 3

/** Turns what a correction points at, in the frames of its animation; returns what it did. */
const correct = (reads: ReadonlyArray<FrameRead>, all: Array<Surface>, correction: NormalCorrection, read: FrameRead): CorrectionResult => {
  const width = correction.width ?? 1
  const height = correction.height ?? 1
  const inArea = (at: number): boolean => {
    const x = at % read.width
    const y = (at / read.width) | 0
    return x >= correction.x && x < correction.x + width && y >= correction.y && y < correction.y + height
  }
  const inside = read.surfaces.map((surface) => ({ surface, count: surface.pixels.filter(inArea).length })).filter((entry) => entry.count > 0)
  const drawn = inside.reduce((sum, entry) => sum + entry.count, 0)
  if (drawn === 0) return { pixels: 0, frames: 0, problem: "nothing is drawn in its area" }
  const direction = vectorOfFacing(correction.facing, correction.tilt)
  const chosen = inside.filter((entry) => entry.count * 2 > entry.surface.pixels.length || entry.count >= drawn * POINTED_AT).map((entry) => entry.surface)
  // Thinly across several surfaces, none a good part of it: the one it touches most.
  const pointed = chosen.length > 0 ? chosen : [[...inside].sort((a, b) => b.count - a.count)[0]!.surface]
  const roots = new Set(pointed.map((surface) => find(all, surface.parent)))
  let pixels = 0
  let frames = 0
  for (const other of reads) {
    let here = 0
    for (const surface of other.surfaces) {
      if (!roots.has(find(all, surface.parent))) continue
      for (const at of surface.pixels) other.directions.set(direction, at * 3)
      here += surface.pixels.length
    }
    pixels += here
    if (here > 0) frames++
  }
  return { pixels, frames, problem: undefined }
}

/**
 * Makes the normal map of a picture, a still or a sheet of animations. Frames
 * that are the same size share directions through their animation, and a
 * correction that points at a frame or an animation that is not there says so
 * in its result.
 */
export const makeNormals = (image: RgbaImage, frames: ReadonlyArray<NormalFrame>, settings: NormalSettings): MadeNormals => {
  const out = new Uint8ClampedArray(image.width * image.height * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 128
    out[i + 1] = 128
    out[i + 2] = 255
  }
  const preset = PRESETS[settings.preset]
  const scale = (settings.strength ?? preset.strength) / 100
  const results: Array<CorrectionResult | undefined> = settings.corrections.map(() => undefined)
  let front = 0
  let shown = 0
  const groups = groupsOf(frames)
  for (const group of groups) {
    const reads = group.map((frame) => surfacesOf(image, frame))
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const read of reads) {
      for (const surface of read.surfaces) {
        low = Math.min(low, surface.brightness)
        high = Math.max(high, surface.brightness)
      }
    }
    for (const read of reads) slopesOf(read, preset, settings.preset, scale, low, high - low)
    const all = carryThrough(reads)
    const totals = new Map<number, [number, number, number]>()
    for (const surface of all) {
      const root = find(all, surface.parent)
      const sum = totals.get(root) ?? [0, 0, 0]
      const weight = surface.pixels.length
      sum[0] += surface.mean[0] * weight
      sum[1] += surface.mean[1] * weight
      sum[2] += surface.mean[2] * weight
      totals.set(root, sum)
    }
    for (const read of reads) {
      for (const surface of read.surfaces) faceSurface(read, surface, snap(totals.get(find(all, surface.parent))!, settings.preset, scale), preset, settings.preset, scale)
      mergeOutlines(read)
      absorbSpecks(read)
    }
    for (const [c, correction] of settings.corrections.entries()) {
      if ((correction.animation ?? "") !== (group[0]!.animation ?? "")) continue
      const read = reads[group.findIndex((frame) => frame.index === correction.frame)]
      results[c] = read === undefined ? { pixels: 0, frames: 0, problem: `frame ${correction.frame} is not in ${correction.animation ?? "the picture"}` } : correct(reads, all, correction, read)
    }
    for (const read of reads) {
      for (let at = 0; at < read.size; at++) {
        if (read.drawn[at] === 0) continue
        const x = read.directions[at * 3]!
        const y = read.directions[at * 3 + 1]!
        const z = read.directions[at * 3 + 2]!
        shown++
        if (z > 0.999) front++
        const i = ((read.frame.y + ((at / read.width) | 0)) * image.width + read.frame.x + at % read.width) * 4
        out[i] = Math.round((x + 1) * 127.5)
        out[i + 1] = Math.round((y + 1) * 127.5)
        out[i + 2] = Math.round((z + 1) * 127.5)
      }
    }
  }
  // The alpha is the art's, so a map lines up with it however a game draws them.
  for (let i = 3; i < out.length; i += 4) out[i] = image.data[i]!
  return {
    image: { width: image.width, height: image.height, data: out },
    corrections: results.map((result, c) => result ?? { pixels: 0, frames: 0, problem: `there is no animation "${settings.corrections[c]!.animation ?? ""}"` }),
    front: shown === 0 ? 0 : front / shown
  }
}

// ---------------------------------------------------------------------------
// Under a light

/** A point light over the art. Distances are in the art's pixels. */
export interface Light {
  readonly x: number
  readonly y: number
  /** How far it is in front of the art. */
  readonly height: number
  /** How far it reaches before it has dimmed by half. */
  readonly reach: number
  /** The light's color, 0 to 255. */
  readonly color: readonly [number, number, number]
  /** How much of the art's color shows with no light on it, 0 to 1. */
  readonly ambient: number
  readonly brightness: number
  /** The light in this many even steps, to see it as a game that steps its light would; 0 is smooth. */
  readonly steps: number
  /** Valve's half-Lambert, `(0.5 * dot + 0.5)²`: the far side keeps its shape instead of going dark. The same map, lit by another formula. */
  readonly halfLambert?: boolean | undefined
}

const toLinear = Float32Array.from({ length: 256 }, (_, v) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
})
const toSrgb = (v: number): number => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/**
 * Draws one frame of the art under a light into `into` (the frame's size, RGBA).
 * A preview of the map's shape, in the plainest model that shows it. A game's
 * own shader decides the final look.
 */
export const lightFrame = (into: Uint8ClampedArray, art: Uint8ClampedArray, normal: Uint8ClampedArray, stride: number, frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, light: Light): void => {
  const red = toLinear[Math.round(light.color[0])]!
  const green = toLinear[Math.round(light.color[1])]!
  const blue = toLinear[Math.round(light.color[2])]!
  const z = Math.max(0.0001, light.height)
  const reach = Math.max(0.0001, light.reach)
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const from = ((frame.y + y) * stride + frame.x + x) * 4
      const to = (y * frame.w + x) * 4
      const alpha = art[from + 3]!
      into[to + 3] = alpha
      if (alpha === 0) continue
      const nx = normal[from]! / 127.5 - 1
      const ny = normal[from + 1]! / 127.5 - 1
      const nz = normal[from + 2]! / 127.5 - 1
      const dx = light.x - x - 0.5
      // Up the picture is up for the normal: the picture's rows count down.
      const dy = y + 0.5 - light.y
      const distance = Math.hypot(dx, dy, z)
      const facing = (nx * dx + ny * dy + nz * z) / distance
      const diffuse = light.halfLambert === true ? (0.5 * facing + 0.5) ** 2 : Math.max(0, facing)
      let direct = (light.brightness * diffuse) / (1 + (distance / reach) ** 2)
      if (light.steps > 0) direct = Math.round(direct * light.steps) / light.steps
      into[to] = toSrgb(Math.min(1, toLinear[art[from]!]! * (light.ambient + direct * red)))
      into[to + 1] = toSrgb(Math.min(1, toLinear[art[from + 1]!]! * (light.ambient + direct * green)))
      into[to + 2] = toSrgb(Math.min(1, toLinear[art[from + 2]!]! * (light.ambient + direct * blue)))
    }
  }
}

// ---------------------------------------------------------------------------
// Flicker: what a person sees boil, in a number an agent can read

/** Pixels whose color stays from one frame to the next, and how many of them got a visibly different light. */
export interface Flicker {
  readonly animation: string
  /** Pixels compared: same spot, same color, in two frames in a row. */
  readonly pixels: number
  /** The share of them whose light jumps, 0 to 1. */
  readonly share: number
  /** The frame (as `frames` numbers it) with the most jumps, and those pixels in the frame's own pixels. */
  readonly worst: { readonly frame: number; readonly index: number; readonly at: ReadonlyArray<readonly [number, number]> } | undefined
}

/** How far a pixel's light may move before it shows: the change in a light from the side, times how bright the pixel is. */
const JUMP = 0.08
const SIDES: ReadonlyArray<Vector> = [unit(-1, 0, 1), unit(1, 0, 1), unit(0, 1, 1), unit(0, -1, 1)]

/** Measures each animation of a picture and its map. A still has nothing to flicker. */
export const flickerOf = <F extends NormalFrame>(art: RgbaImage, normal: RgbaImage, frames: ReadonlyArray<F>): ReadonlyArray<Flicker> => {
  const results: Array<Flicker> = []
  for (const group of groupsOf(frames)) {
    if (group.length < 2) continue
    let pixels = 0
    let jumped = 0
    let worst: Flicker["worst"] = undefined
    for (const [f, frame] of group.entries()) {
      const next = group[(f + 1) % group.length]!
      if (next === frame || next.w !== frame.w || next.h !== frame.h) continue
      const at: Array<readonly [number, number]> = []
      for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) {
          const a = ((frame.y + y) * art.width + frame.x + x) * 4
          const b = ((next.y + y) * art.width + next.x + x) * 4
          if (art.data[a + 3] === 0 || art.data[b + 3] === 0) continue
          if (art.data[a] !== art.data[b] || art.data[a + 1] !== art.data[b + 1] || art.data[a + 2] !== art.data[b + 2]) continue
          pixels++
          const bright = Math.max(art.data[a]!, art.data[a + 1]!, art.data[a + 2]!) / 255
          let most = 0
          for (const side of SIDES) {
            const was = (normal.data[a]! / 127.5 - 1) * side[0] + (normal.data[a + 1]! / 127.5 - 1) * side[1] + (normal.data[a + 2]! / 127.5 - 1) * side[2]
            const now = (normal.data[b]! / 127.5 - 1) * side[0] + (normal.data[b + 1]! / 127.5 - 1) * side[1] + (normal.data[b + 2]! / 127.5 - 1) * side[2]
            most = Math.max(most, Math.abs(Math.max(0, was) - Math.max(0, now)))
          }
          if (most * bright > JUMP) {
            jumped++
            at.push([x, y])
          }
        }
      }
      if (at.length > (worst?.at.length ?? 0)) worst = { frame: frames.indexOf(frame), index: frame.index, at }
    }
    results.push({ animation: group[0]!.animation ?? "", pixels, share: pixels === 0 ? 0 : jumped / pixels, worst })
  }
  return results
}

// ---------------------------------------------------------------------------
// What the lint says about a map

/** Past this share of unchanged pixels changing their light, an animation boils under a moving light. On the worst animation of each of three sheets, maps made here measured 4% and 5% (hand-drawn) and 19% (AI-made); made one frame at a time, 11%, 27%, and 55%. */
export const FLICKER_LIMIT = 0.15
/** Past this share facing the viewer, a map adds next to nothing to flat light. */
const FLAT_LIMIT = 0.9

const flatShare = (art: RgbaImage, normal: RgbaImage): number => {
  let drawn = 0
  let flat = 0
  for (let i = 0; i < art.data.length; i += 4) {
    if (art.data[i + 3] === 0) continue
    drawn++
    if (normal.data[i + 2]! >= 253) flat++
  }
  return drawn === 0 ? 0 : flat / drawn
}

const percent = (share: number): string => `${Math.round(share * 100)}%`

/**
 * What is wrong with a normal map beside its art, each by a rule of its own.
 * `frames` are the art's frames as they are now; `kept` is the hashes they had
 * when the map was made, when the map was made here (a map painted by hand has
 * no file beside it, so nothing to go stale against).
 */
export const normalIssues = <F extends NormalFrame & { readonly hash: string }>(art: RgbaImage, normal: RgbaImage, frames: ReadonlyArray<F>, kept: ReadonlyArray<string> | undefined): ReadonlyArray<Issue & { readonly frame?: number | undefined }> => {
  if (art.width !== normal.width || art.height !== normal.height) {
    return [{ rule: "normal-size", severity: "error", message: `The normal map is ${normal.width}x${normal.height} and the art is ${art.width}x${art.height}: run \`ritmo-tools pixel normals\` again`, count: 1, at: [] }]
  }
  const issues: Array<Issue & { readonly frame?: number | undefined }> = []
  if (kept !== undefined && (kept.length !== frames.length || frames.some((frame, i) => frame.hash !== kept[i]))) {
    issues.push({ rule: "normal-stale", severity: "error", message: "The art changed since this normal map was made: run `ritmo-tools pixel normals` again", count: 1, at: [] })
  }
  const holes: Array<readonly [number, number]> = []
  const wrong: Array<readonly [number, number]> = []
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const i = (y * art.width + x) * 4
      if ((art.data[i + 3] === 0) !== (normal.data[i + 3] === 0)) holes.push([x, y])
      if (art.data[i + 3] === 0 || normal.data[i + 3] === 0) continue
      const length = Math.hypot(normal.data[i]! / 127.5 - 1, normal.data[i + 1]! / 127.5 - 1, normal.data[i + 2]! / 127.5 - 1)
      if (Math.abs(length - 1) > 0.25 || normal.data[i + 2]! < 127) wrong.push([x, y])
    }
  }
  if (holes.length > 0) issues.push({ rule: "normal-alpha", severity: "error", message: `${holes.length} pixel${holes.length === 1 ? " is" : "s are"} drawn in only one of the art and its normal map: they no longer line up`, count: holes.length, at: holes.slice(0, 20) })
  if (wrong.length > 0) issues.push({ rule: "normal-invalid", severity: "error", message: `${wrong.length} pixel${wrong.length === 1 ? " is" : "s are"} not a direction: a normal map's colors are x, y, and z of a length of one, facing the viewer`, count: wrong.length, at: wrong.slice(0, 20) })
  for (const flicker of flickerOf(art, normal, frames)) {
    if (flicker.share <= FLICKER_LIMIT) continue
    issues.push({
      rule: "normal-flicker",
      severity: "warning",
      message: `${flicker.animation}: ${percent(flicker.share)} of the pixels that stay the same from frame to frame change their light, and will boil under a moving light. Correct the surfaces that jump, or look at it playing in \`pixel review\``,
      count: flicker.worst?.at.length ?? 0,
      at: (flicker.worst?.at ?? []).slice(0, 20),
      frame: flicker.worst?.frame
    })
  }
  const flat = flatShare(art, normal)
  if (flat > FLAT_LIMIT) issues.push({ rule: "normal-flat", severity: "warning", message: `${percent(flat)} of the art faces the viewer, so the map adds next to nothing: try another \`--preset\` or a larger \`--strength\``, count: 1, at: [] })
  return issues
}

// ---------------------------------------------------------------------------
// The file beside the art

/** What a map was made from, kept beside it (`hero.normals.json`), so running the command again gives the same map and a change to the art shows. */
export interface NormalsFile extends NormalSettings {
  /** The art's frames as they were when the map was made: hashes, in the sheet's order. */
  readonly frames: ReadonlyArray<string>
}

/** How the map's colors read, written in the file for whoever writes the shader: x to the right, y up the picture, z towards the viewer, each 0 to 255 for -1 to 1. */
export const NORMAL_CONVENTION = "x right, y up (green up, as OpenGL and Godot read it), z to the viewer; each channel 0-255 is -1 to 1"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown, least = 0): value is number => typeof value === "number" && Number.isInteger(value) && value >= least

const correctionOf = (raw: unknown, where: string, errors: Array<string>): NormalCorrection | undefined => {
  if (!isRecord(raw) || !whole(raw.frame) || !whole(raw.x) || !whole(raw.y)) {
    errors.push(`${where} must be {"frame", "x", "y", "facing"}, whole numbers from 0, as a review comment gives them`)
    return undefined
  }
  if (!isFacing(raw.facing)) {
    errors.push(`${where}.facing must be one of ${facings.join(", ")}`)
    return undefined
  }
  if ((raw.width !== undefined && !whole(raw.width, 1)) || (raw.height !== undefined && !whole(raw.height, 1))) {
    errors.push(`${where}.width and .height are whole numbers from 1`)
    return undefined
  }
  if (raw.animation !== undefined && typeof raw.animation !== "string") {
    errors.push(`${where}.animation must be a name`)
    return undefined
  }
  if (raw.tilt !== undefined && (typeof raw.tilt !== "number" || raw.tilt < 0 || raw.tilt > 85)) {
    errors.push(`${where}.tilt is in degrees, 0 to 85`)
    return undefined
  }
  return {
    ...(raw.animation === undefined ? {} : { animation: raw.animation }),
    frame: raw.frame,
    x: raw.x,
    y: raw.y,
    ...(raw.width === undefined ? {} : { width: raw.width }),
    ...(raw.height === undefined ? {} : { height: raw.height }),
    facing: raw.facing,
    ...(raw.tilt === undefined ? {} : { tilt: raw.tilt })
  }
}

/** A `.normals.json`, with every problem said at once. */
export const decodeNormals = (text: string): Decoded<NormalsFile> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(raw)) return { ok: false, error: 'a normals file is {"preset": ..., "corrections": [...], "frames": [...]}' }
  const errors: Array<string> = []
  if (!isNormalPreset(raw.preset)) errors.push(`preset must be one of ${normalPresets.join(", ")}`)
  if (raw.strength !== undefined && (typeof raw.strength !== "number" || raw.strength <= 0 || raw.strength > 400)) errors.push("strength is in percent, above 0 and up to 400")
  if (raw.corrections !== undefined && !Array.isArray(raw.corrections)) errors.push("corrections must be a list")
  if (raw.frames !== undefined && (!Array.isArray(raw.frames) || !raw.frames.every((hash) => typeof hash === "string"))) errors.push("frames must be a list of hashes")
  const corrections = (Array.isArray(raw.corrections) ? raw.corrections : []).flatMap((correction, i) => correctionOf(correction, `corrections[${i}]`, errors) ?? [])
  if (errors.length > 0 || !isNormalPreset(raw.preset)) return { ok: false, error: errors.join("; ") }
  const frames: ReadonlyArray<string> = Array.isArray(raw.frames) ? raw.frames.filter((hash) => typeof hash === "string") : []
  return { ok: true, value: { preset: raw.preset, ...(typeof raw.strength === "number" ? { strength: raw.strength } : {}), corrections, frames } }
}

/** The file as written, the convention first so a person reading it knows what the map's colors are. */
export const encodeNormals = (file: NormalsFile): string =>
  JSON.stringify({ version: 1, convention: NORMAL_CONVENTION, preset: file.preset, ...(file.strength === undefined ? {} : { strength: file.strength }), corrections: file.corrections, frames: file.frames }, null, 2) + "\n"
