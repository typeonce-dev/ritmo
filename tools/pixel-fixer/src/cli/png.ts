/**
 * PNG in and out for the CLI (the page uses the browser's canvas instead).
 */
import pngjs from "pngjs"
import type { RgbaImage } from "../core/grid.ts"

/** Decodes a PNG into RGBA pixels; throws on a broken file. */
export const decodePng = (bytes: Uint8Array): RgbaImage => {
  const png = pngjs.PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) }
}

/** Encodes RGBA pixels as a PNG. */
export const encodePng = (image: RgbaImage): Uint8Array => {
  const png = new pngjs.PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length)
  return new Uint8Array(pngjs.PNG.sync.write(png))
}
