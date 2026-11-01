/// <reference types="vite/client" />
/**
 * The example bank the website shows (`examples/rig/borri`: Borri the
 * dwarf, rigged from a painted parts sheet): its JSON, the rig module and
 * every clip module imported already, by their paths in the bank, by Vite
 * at build time (they import each other, so they come as modules, not
 * sources), and its pictures, decoded in the tab. The demo page bakes them
 * in the tab with the same runner and rasterizer the CLI uses.
 */
import type { RgbaImage } from "../../pixel/core/grid.ts"
import bankText from "../../../examples/rig/borri/borri.rig.json?raw"

const files = import.meta.glob("../../../examples/rig/borri/**/*.mjs", { eager: true })
const pictures = import.meta.glob<string>("../../../examples/rig/borri/parts/*.png", { eager: true, query: "?url", import: "default" })

const ROOT = "examples/rig/borri/"

export const exampleName = "borri.rig.json"
export const exampleBank: string = bankText

/** Each module, by its path in the bank (`clips/attack.a.mjs`). */
export const exampleModules: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(files).map(([path, module]) => [path.slice(path.indexOf(ROOT) + ROOT.length), module]))

/**
 * The rig's pictures, decoded, by the path its module names them with
 * (`../parts/torso.png`, from `rig/character.mjs`). The browser decodes
 * them, so their pixels may differ from the CLI's by a step where a
 * picture is nearly transparent.
 */
export const exampleImages = async (): Promise<ReadonlyMap<string, RgbaImage>> => {
  const images = new Map<string, RgbaImage>()
  for (const [path, url] of Object.entries(pictures)) {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" })
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (context === null) continue
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    images.set(`../${path.slice(path.indexOf(ROOT) + ROOT.length)}`, { width: bitmap.width, height: bitmap.height, data })
  }
  return images
}
