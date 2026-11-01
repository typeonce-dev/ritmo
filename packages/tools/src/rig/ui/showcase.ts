/**
 * The example bank's clips baked in the tab, for the website's tools page:
 * its picture of the skeleton lab. Apart from `demo.ts`, which mounts the
 * whole review page when imported.
 */
import type { RgbaImage } from "../../pixel/core/grid.ts"
import { decodeBank, usedDraft } from "../core/bank.ts"
import type { DraftView } from "../core/view.ts"
import { exampleBank, exampleImages, exampleModules, exampleName } from "./example.ts"
import { memoryStore, type RigInfo } from "./store.ts"

/**
 * The draft in use of each of the example bank's clips named, baked as the
 * review page bakes it at `scale`, with the rig's frame. Clips that do not
 * bake are left out.
 */
export const exampleClips = async (
  clips: ReadonlyArray<string>,
  scale: number
): Promise<{ readonly rig: RigInfo; readonly clips: ReadonlyArray<{ readonly clip: string; readonly view: DraftView<RgbaImage> }> } | undefined> => {
  const store = memoryStore(exampleName, exampleBank, { modules: exampleModules, images: await exampleImages() }, { scale })
  const session = await store.session()
  const bank = decodeBank(exampleBank)
  if (session === undefined || "error" in session.rig || !bank.ok) return undefined
  const baked: Array<{ readonly clip: string; readonly view: DraftView<RgbaImage> }> = []
  for (const clip of clips) {
    const entry = bank.value.clips[clip]
    const id = entry === undefined ? undefined : usedDraft(entry)
    const result = id === undefined ? undefined : await store.draft(clip, id)
    if (result === undefined || !result.result.ok) continue
    // Baked in the tab, every frame is pixels (a data URL comes only from the CLI's server).
    baked.push({ clip, view: { ...result.result.view, art: result.result.view.art.filter((frame): frame is RgbaImage => typeof frame !== "string") } })
  }
  return { rig: session.rig, clips: baked }
}
