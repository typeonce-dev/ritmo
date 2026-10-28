/** Reading pictures into pixels, and handing files back to the user. */
import { toRgba } from "../core/export.ts"
import type { PixelArt } from "../core/fix.ts"
import type { RgbaImage } from "../core/grid.ts"

export interface LoadedImage {
  readonly image: RgbaImage
  /** The picture at 1x, ready to draw. */
  readonly canvas: HTMLCanvasElement
}

/** A canvas holding these pixels. */
export const canvasOf = (image: RgbaImage): HTMLCanvasElement => {
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (context !== null && image.width > 0 && image.height > 0) {
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  }
  return canvas
}

export const loadImage = async (blob: Blob): Promise<LoadedImage> => {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (context === null) throw new Error("This browser cannot read pictures into a canvas.")
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  return { image: { width: data.width, height: data.height, data: data.data }, canvas }
}

export const pngOf = (art: PixelArt, scale: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvasOf(toRgba(art, scale)).toBlob((blob) => (blob === null ? reject(new Error("PNG encoding failed")) : resolve(blob)), "image/png")
  })

export const download = (name: string, content: Blob | string, type = "text/plain"): void => {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** The file name without its extension, for naming exports. */
export const baseName = (name: string): string => name.replace(/\.[^.]+$/, "") || "pixel-art"
