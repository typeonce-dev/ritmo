/**
 * Pixel art as text, for art drawn with code: a palette of one-character
 * keys, then one row of keys per pixel row. An agent writes it, `render`
 * turns it into PNG and SVG, and `lint` checks it, so no blurry picture ever
 * needs fixing.
 *
 * ```
 * # A coin. Lines starting with # are comments.
 * palette
 * . transparent
 * K #1a1c2c
 * Y #ffcd75
 *
 * pixels
 * .KKKK.
 * KYYYYK
 * .KKKK.
 * ```
 *
 * The JSON map written by `toJson` (width, height, palette, pixels) is read
 * back too.
 */
import { pack, parseHex, toHex, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"

export interface SpriteProblem {
  /** 1-based line of the text, when the problem is on one. */
  readonly line?: number
  readonly message: string
}

export type Parsed = { readonly ok: true; readonly art: PixelArt } | { readonly ok: false; readonly problems: ReadonlyArray<SpriteProblem> }

/** Reads the text format above. Every problem is reported, with its line, not only the first. */
export const parseSprite = (text: string): Parsed => {
  const problems: Array<SpriteProblem> = []
  const keys = new Map<string, number>()
  const palette: Array<Rgb> = []
  const rows: Array<{ readonly line: number; readonly text: string }> = []
  let section: "none" | "palette" | "pixels" = "none"
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const content = raw.trimEnd()
    if (section !== "pixels" && (content.trim() === "" || content.trimStart().startsWith("#"))) return
    if (section === "pixels" && content.trim() === "") return
    const header = content.trim().toLowerCase().replace(/:$/, "")
    if (header === "palette" || header === "pixels") {
      section = header
      return
    }
    if (section === "palette") {
      const match = /^\s*(\S)\s*[=:]?\s+(\S+)\s*$/.exec(content) ?? /^\s*(\S)\s*[=:]\s*(\S+)\s*$/.exec(content)
      if (match === null) {
        problems.push({ line, message: `a palette line is a key and a color, like "K #1a1c2c": got "${content.trim()}"` })
        return
      }
      const key = match[1]!
      const value = match[2]!
      if (keys.has(key)) problems.push({ line, message: `the key "${key}" is used twice` })
      if (/^(transparent|none|clear)$/i.test(value)) {
        keys.set(key, TRANSPARENT)
        return
      }
      const color = parseHex(value)
      if (color === undefined) {
        problems.push({ line, message: `"${value}" is not a hex color or "transparent"` })
        return
      }
      keys.set(key, palette.length)
      palette.push(color)
      return
    }
    if (section === "pixels") {
      rows.push({ line, text: content.trim() })
      return
    }
    problems.push({ line, message: 'expected a "palette" section first, then a "pixels" section' })
  })

  if (keys.size === 0) problems.push({ message: 'no palette: add a "palette" section with lines like "K #1a1c2c"' })
  if (rows.length === 0) problems.push({ message: 'no pixels: add a "pixels" section with one row of keys per pixel row' })
  const width = rows[0]?.text.length ?? 0
  const indices = new Int32Array(width * rows.length)
  rows.forEach((row, y) => {
    if (row.text.length !== width) {
      problems.push({ line: row.line, message: `row ${y + 1} is ${row.text.length} pixels wide; the first row is ${width}` })
      return
    }
    ;[...row.text].forEach((key, x) => {
      const index = keys.get(key)
      if (index === undefined) {
        problems.push({ line: row.line, message: `"${key}" at column ${x + 1} is not in the palette` })
        indices[y * width + x] = TRANSPARENT
      } else {
        indices[y * width + x] = index
      }
    })
  })
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, art: { width, height: rows.length, palette, indices } }
}

/** Keys for writing a sprite: easy to tell apart, transparent always ".". */
const KEYS = "KWRGBYOPCMDLSTNVXZEFHJQUAIabcdefghijkmnopqrstuvwxyz0123456789@$%&*+=?!<>^~"

/** Writes pixel art in the text format, for an agent to read and edit. */
export const formatSprite = (art: PixelArt, comment?: string): string => {
  const used = new Set<number>()
  for (const index of art.indices) used.add(index)
  const order = art.palette.map((_, i) => i).filter((i) => used.has(i))
  if (order.length > KEYS.length) throw new Error(`a sprite holds at most ${KEYS.length} colors; this one has ${order.length}`)
  const keyOf = new Map(order.map((index, i) => [index, KEYS[i]!]))
  const lines: Array<string> = []
  if (comment !== undefined) lines.push(...comment.split("\n").map((line) => `# ${line}`), "")
  lines.push("palette")
  if (used.has(TRANSPARENT)) lines.push(". transparent")
  for (const index of order) lines.push(`${keyOf.get(index)!} ${toHex(art.palette[index]!)}`)
  lines.push("", "pixels")
  for (let y = 0; y < art.height; y++) {
    let row = ""
    for (let x = 0; x < art.width; x++) {
      const index = art.indices[y * art.width + x]!
      row += index === TRANSPARENT ? "." : keyOf.get(index)!
    }
    lines.push(row)
  }
  return lines.join("\n") + "\n"
}

/** Reads the JSON map written by `toJson`. */
export const parseJsonMap = (text: string): Parsed => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, problems: [{ message: `not JSON: ${error instanceof Error ? error.message : String(error)}` }] }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: [{ message: "a JSON map is an object with width, height, palette, and pixels" }] }
  }
  const map = raw as { width?: unknown; height?: unknown; palette?: unknown; pixels?: unknown }
  const problems: Array<SpriteProblem> = []
  const palette: Array<Rgb> = []
  if (!Array.isArray(map.palette)) problems.push({ message: "palette must be a list of hex colors" })
  else
    map.palette.forEach((entry, i) => {
      const color = typeof entry === "string" ? parseHex(entry) : undefined
      if (color === undefined) problems.push({ message: `palette[${i}] is not a hex color` })
      else palette.push(color)
    })
  const pixels = Array.isArray(map.pixels) ? map.pixels : []
  if (!Array.isArray(map.pixels)) problems.push({ message: "pixels must be a list of rows" })
  const height = pixels.length
  const width = Array.isArray(pixels[0]) ? pixels[0].length : 0
  if (map.width !== undefined && map.width !== width) problems.push({ message: `width says ${String(map.width)}, the rows are ${width} wide` })
  if (map.height !== undefined && map.height !== height) problems.push({ message: `height says ${String(map.height)}, there are ${height} rows` })
  const indices = new Int32Array(width * height)
  pixels.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== width) {
      problems.push({ message: `row ${y} is not ${width} entries long` })
      return
    }
    row.forEach((value, x) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < -1 || value >= palette.length) {
        problems.push({ message: `pixel (${x}, ${y}) is ${JSON.stringify(value)}: use a palette index, or -1 for transparent` })
      } else indices[y * width + x] = value
    })
  })
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, art: { width, height, palette, indices } }
}

/**
 * A picture taken as pixel art at its own size: one pixel per pixel, its
 * colors as the palette. Pixels with alpha below `alphaThreshold` are
 * transparent; `partial` counts the pixels that were neither fully opaque nor
 * fully transparent (pixel art has none).
 */
export const artOfImage = (image: RgbaImage, alphaThreshold = 128): { readonly art: PixelArt; readonly partial: number } => {
  const slots = new Map<number, number>()
  const palette: Array<Rgb> = []
  const indices = new Int32Array(image.width * image.height)
  let partial = 0
  for (let i = 0; i < indices.length; i++) {
    const alpha = image.data[i * 4 + 3]!
    if (alpha > 0 && alpha < 255) partial++
    if (alpha < alphaThreshold) {
      indices[i] = TRANSPARENT
      continue
    }
    const key = pack(image.data[i * 4]!, image.data[i * 4 + 1]!, image.data[i * 4 + 2]!)
    let slot = slots.get(key)
    if (slot === undefined) {
      slot = palette.length
      slots.set(key, slot)
      palette.push({ r: image.data[i * 4]!, g: image.data[i * 4 + 1]!, b: image.data[i * 4 + 2]! })
    }
    indices[i] = slot
  }
  return { art: { width: image.width, height: image.height, palette, indices }, partial }
}
