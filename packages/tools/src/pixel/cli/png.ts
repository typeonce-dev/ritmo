/**
 * Pictures in and out for the CLI (the page uses the browser's canvas
 * instead): PNG and JPEG in, PNG out.
 */
import jpeg from "jpeg-js"
import pngjs from "pngjs"
import type { RgbaImage } from "../core/grid.ts"

const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8

/**
 * The largest picture the tools read: 4096 × 4096 pixels in all, and 16384
 * on a side (a long animation strip). Far past any sprite, sheet, or AI
 * picture; a header claiming more is checked before decoding, which would
 * otherwise run for minutes or run out of memory.
 */
export const MAX_PIXELS = 4096 * 4096
export const MAX_SIDE = 16384

/** A picture whose header claims more pixels than the tools read. */
export class PictureTooLarge extends Error {}

const readUint16 = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!
const readUint32 = (bytes: Uint8Array, at: number): number => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!

/** The size a PNG's or a JPEG's header claims, without decoding it; `undefined` when it does not say. */
const claimedSize = (bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined => {
  if (bytes.length >= 24 && String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR") return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) }
  if (!isJpeg(bytes)) return undefined
  // The first frame header (SOF0 to SOF15, but not DHT, JPG, or DAC) holds the size.
  for (let at = 2; at + 9 < bytes.length; ) {
    if (bytes[at] !== 0xff) return undefined
    const marker = bytes[at + 1]!
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: readUint16(bytes, at + 7), height: readUint16(bytes, at + 5) }
    at += 2 + readUint16(bytes, at + 2)
  }
  return undefined
}

/** Throws `PictureTooLarge` when the header claims more than the tools read. */
const checkSize = (bytes: Uint8Array): void => {
  const size = claimedSize(bytes)
  if (size !== undefined && (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS))
    throw new PictureTooLarge(`it is ${size.width}×${size.height} pixels: the tools read pictures of at most ${MAX_PIXELS.toLocaleString("en")} pixels (4096×4096) and ${MAX_SIDE} on a side. Scale it down first`)
}

/** Decodes a PNG into RGBA pixels; throws on a broken file, and `PictureTooLarge` on one past the limit. */
export const decodePng = (bytes: Uint8Array): RgbaImage => {
  checkSize(bytes)
  const png = pngjs.PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) }
}

/** Decodes a PNG or a JPEG (told apart by their first bytes) into RGBA pixels; throws on a broken file, and `PictureTooLarge` on one past the limit. */
export const decodePicture = (bytes: Uint8Array): RgbaImage => {
  if (!isJpeg(bytes)) return decodePng(bytes)
  checkSize(bytes)
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length) }
}

/** Encodes RGBA pixels as a PNG. */
export const encodePng = (image: RgbaImage): Uint8Array => {
  const png = new pngjs.PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length)
  return new Uint8Array(pngjs.PNG.sync.write(png))
}
