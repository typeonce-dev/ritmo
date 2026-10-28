/**
 * Animated GIFs of pixel art, written by hand: one global palette (the
 * frames share one), one color kept for transparency, and LZW compression.
 * GIF delays are in hundredths of a second, so a frame rate rounds to the
 * nearest one GIF can show.
 */
import { makeMatcher, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"

export interface GifOptions {
  /** Each pixel repeated this many times on both axes. */
  readonly scale: number
  /** How long each frame shows, in milliseconds. */
  readonly delay: number
}

/** Writes bits least significant first, in sub-blocks of at most 255 bytes, as GIF wants. */
const lzw = (pixels: Uint8Array, minCodeSize: number): Array<number> => {
  const bytes: Array<number> = []
  let buffer = 0
  let bits = 0
  const emit = (code: number, size: number): void => {
    buffer |= code << bits
    bits += size
    while (bits >= 8) {
      bytes.push(buffer & 255)
      buffer >>>= 8
      bits -= 8
    }
  }
  const clear = 1 << minCodeSize
  const end = clear + 1
  let size = minCodeSize + 1
  let next = end + 1
  let table = new Map<number, number>()
  emit(clear, size)
  let current = pixels[0] ?? 0
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!
    const key = current * 256 + k
    const found = table.get(key)
    if (found !== undefined) {
      current = found
      continue
    }
    emit(current, size)
    if (next === 4096) {
      emit(clear, size)
      table = new Map()
      size = minCodeSize + 1
      next = end + 1
    } else {
      if (next >= 1 << size) size++
      table.set(key, next++)
    }
    current = k
  }
  emit(current, size)
  emit(end, size)
  if (bits > 0) bytes.push(buffer & 255)
  const blocks: Array<number> = []
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255)
    blocks.push(chunk.length, ...chunk)
  }
  blocks.push(0)
  return blocks
}

const word = (value: number): Array<number> => [value & 255, (value >> 8) & 255]

/**
 * An animated GIF that loops forever. Every frame must be the same size;
 * frames on different palettes are matched to the first frame's (share one
 * with `sharePalette` first). A palette over 255 colors keeps its first 255.
 */
export const toGif = (frames: ReadonlyArray<PixelArt>, options: GifOptions): Uint8Array<ArrayBuffer> => {
  const first = frames[0]
  if (first === undefined) return new Uint8Array(0)
  const scale = Math.max(1, Math.floor(options.scale))
  const width = first.width * scale
  const height = first.height * scale
  const colors: ReadonlyArray<Rgb> = first.palette.slice(0, 255)
  // The last slot is transparency; the table's size is a power of two of at least 4.
  let depth = 2
  while (1 << depth < colors.length + 1) depth++
  const transparent = colors.length
  const matcher = first.palette.length > 255 ? makeMatcher(colors, "oklab") : undefined
  const slot = (art: PixelArt, index: number): number => {
    if (index === TRANSPARENT) return transparent
    if (art.palette === first.palette && index < 255) return index
    return matcher === undefined ? Math.min(index, 254) : matcher.nearest(art.palette[index]!)
  }

  const out: Array<number> = []
  const ascii = (text: string): void => {
    for (const char of text) out.push(char.charCodeAt(0))
  }
  ascii("GIF89a")
  out.push(...word(width), ...word(height), 0xf0 | (depth - 1), transparent, 0)
  for (let i = 0; i < 1 << depth; i++) {
    const color = colors[i] ?? { r: 0, g: 0, b: 0 }
    out.push(color.r, color.g, color.b)
  }
  // Loops forever (the NETSCAPE2.0 extension).
  out.push(0x21, 0xff, 0x0b)
  ascii("NETSCAPE2.0")
  out.push(0x03, 0x01, 0, 0, 0)
  const delay = Math.max(2, Math.round(options.delay / 10))
  for (const art of frames) {
    // Each frame replaces the last (disposal 2), with its transparent color see-through.
    out.push(0x21, 0xf9, 0x04, (2 << 2) | 1, ...word(delay), transparent, 0)
    out.push(0x2c, ...word(0), ...word(0), ...word(width), ...word(height), 0)
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        pixels[y * width + x] = slot(art, art.indices[Math.floor(y / scale) * art.width + Math.floor(x / scale)]!)
      }
    }
    out.push(depth)
    for (const byte of lzw(pixels, depth)) out.push(byte)
  }
  out.push(0x3b)
  return Uint8Array.from(out)
}
