/**
 * The example bank's drafts baked in the tab, for the website's tools page:
 * its picture of the skeleton lab. Apart from `demo.ts`, which mounts the
 * whole review page when imported.
 */
import type { RgbaImage } from "../../pixel/core/grid.ts"
import { decodeBank } from "../core/bank.ts"
import type { DraftView } from "../core/view.ts"
import { exampleBank, exampleModules, exampleName } from "./example.ts"
import { memoryStore, type RigInfo } from "./store.ts"

/**
 * Every draft of one of the example bank's clips, baked as the review page
 * bakes it, with the rig's frame. Drafts that do not bake are left out.
 */
export const exampleDrafts = async (clip: string): Promise<{ readonly rig: RigInfo; readonly drafts: ReadonlyArray<DraftView<RgbaImage>> } | undefined> => {
  const store = memoryStore(exampleName, exampleBank, { modules: exampleModules, images: new Map() })
  const session = await store.session()
  if (session === undefined || "error" in session.rig) return undefined
  const bank = decodeBank(exampleBank)
  const drafts: Array<DraftView<RgbaImage>> = []
  for (const id of bank.ok ? Object.keys(bank.value.clips[clip]?.drafts ?? {}) : []) {
    const baked = await store.draft(clip, id)
    if (baked === undefined || !baked.result.ok) continue
    // Baked in the tab, every frame is pixels (a data URL comes only from the CLI's server).
    drafts.push({ ...baked.result.view, art: baked.result.view.art.filter((frame): frame is RgbaImage => typeof frame !== "string") })
  }
  return { rig: session.rig, drafts }
}
