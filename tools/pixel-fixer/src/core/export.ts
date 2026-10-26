/**
 * Writing the fixed picture out: as RGBA pixels (for PNG, at 1x or a whole
 * scale), as SVG (squares, so it scales to any size and stays sharp), and
 * as a JSON map of palette indices.
 */
import { toHex } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"

/** The picture's pixels, each repeated `scale` times on both axes (nearest neighbour). */
export const toRgba = (art: PixelArt, scale = 1): RgbaImage => {
  const factor = Math.max(1, Math.floor(scale))
  const width = art.width * factor
  const height = art.height * factor
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = art.indices[Math.floor(y / factor) * art.width + Math.floor(x / factor)]!
      if (index === TRANSPARENT) continue
      const color = art.palette[index]!
      const i = (y * width + x) * 4
      data[i] = color.r
      data[i + 1] = color.g
      data[i + 2] = color.b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  height: number
}

/**
 * The picture as rectangles, one list per palette color: runs of one color
 * on a row, merged with the same run on the rows below.
 */
export const toRects = (art: PixelArt): Map<number, Array<Rect>> => {
  const byColor = new Map<number, Array<Rect>>()
  let open = new Map<string, Rect>()
  for (let y = 0; y < art.height; y++) {
    const next = new Map<string, Rect>()
    let x = 0
    while (x < art.width) {
      const index = art.indices[y * art.width + x]!
      let end = x + 1
      while (end < art.width && art.indices[y * art.width + end] === index) end++
      if (index !== TRANSPARENT) {
        const key = `${x}:${end - x}:${index}`
        const above = open.get(key)
        if (above !== undefined) {
          above.height++
          next.set(key, above)
        } else {
          const rect: Rect = { x, y, width: end - x, height: 1 }
          next.set(key, rect)
          const list = byColor.get(index) ?? []
          list.push(rect)
          byColor.set(index, list)
        }
      }
      x = end
    }
    open = next
  }
  return byColor
}

/**
 * An SVG of the picture: one path per color, in pixel units (`viewBox` is
 * the picture's size), drawn with crisp edges so it stays sharp at any size.
 * `scale` only sets the default width and height it opens at.
 */
export const toSvg = (art: PixelArt, scale = 1): string => {
  const factor = Math.max(1, Math.floor(scale))
  const paths: Array<string> = []
  for (const [index, rects] of toRects(art)) {
    const d = rects.map((rect) => `M${rect.x} ${rect.y}h${rect.width}v${rect.height}h-${rect.width}z`).join("")
    paths.push(`  <path fill="${toHex(art.palette[index]!)}" d="${d}"/>`)
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.width} ${art.height}" width="${art.width * factor}" height="${art.height * factor}" shape-rendering="crispEdges">`,
    ...paths,
    "</svg>",
    ""
  ].join("\n")
}

/**
 * The picture as JSON: its size, its palette as hex colors, and one row of
 * palette indices per pixel row (-1 where it is transparent).
 */
export const toJson = (art: PixelArt): string => {
  const rows: Array<string> = []
  for (let y = 0; y < art.height; y++) {
    rows.push(`    [${Array.from(art.indices.subarray(y * art.width, (y + 1) * art.width)).join(",")}]`)
  }
  return [
    "{",
    `  "width": ${art.width},`,
    `  "height": ${art.height},`,
    `  "palette": ${JSON.stringify(art.palette.map(toHex))},`,
    `  "pixels": [`,
    rows.join(",\n"),
    "  ]",
    "}",
    ""
  ].join("\n")
}
