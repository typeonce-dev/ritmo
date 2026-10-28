/**
 * Pictures in and out for the CLI (the page uses the browser's canvas
 * instead): PNG and JPEG in, PNG out.
 */
import jpeg from "jpeg-js"
import pngjs from "pngjs"
import type { RgbaImage } from "../core/grid.ts"

/** Decodes a PNG into RGBA pixels; throws on a broken file. */
export const decodePng = (bytes: Uint8Array): RgbaImage => {
  const png = pngjs.PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) }
}

const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8

/** Decodes a PNG or a JPEG (told apart by their first bytes) into RGBA pixels; throws on a broken file. */
export const decodePicture = (bytes: Uint8Array): RgbaImage => {
  if (!isJpeg(bytes)) return decodePng(bytes)
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length) }
}

/** Encodes RGBA pixels as a PNG. */
export const encodePng = (image: RgbaImage): Uint8Array => {
  const png = new pngjs.PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length)
  return new Uint8Array(pngjs.PNG.sync.write(png))
}
