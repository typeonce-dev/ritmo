/**
 * Where the rig review page reads and writes a bank and its review, and
 * gets each draft baked: the CLI's server (`serverStore`: the files the
 * agent reads back, baked in Node), or the tab itself (`memoryStore`: the
 * website's demo, baked in the browser by the same runner and rasterizer).
 */
import type { RgbaImage } from "../../pixel/core/grid.ts"
import { decodeBank, type Bank } from "../core/bank.ts"
import { decodeClip } from "../core/clip.ts"
import { decodeRig, type Look, type Rig, type V } from "../core/rig.ts"
import { draftView, pivotAt, spotAt, type DraftResult } from "../core/view.ts"

/** The frame's size and anchor, and what the page draws behind the character. */
export interface RigInfo {
  readonly width: number
  readonly height: number
  readonly anchor: V
  readonly look: Look
}

/** What changed since the page last looked: the files, and each draft's stamp (`clip/draft`), which changes when it rebakes. */
export interface Version {
  readonly bank: string
  readonly review: string
  readonly stamps: Readonly<Record<string, string>>
  /** Drafts being baked now. */
  readonly baking: ReadonlyArray<string>
}

/** A bank and its review as the page opens them. */
export interface Session {
  readonly bank: string
  readonly name: string
  readonly bankText: string
  readonly reviewText: string | null
  /** The rig's frame, or why the rig does not load. */
  readonly rig: RigInfo | { readonly error: string }
  readonly version: Version
}

/** What is at a pixel the person clicked: the part drawn there, its own bone, the spot in that bone's frame, and the phase. */
export interface Spot {
  readonly part?: string | undefined
  readonly bone?: string | undefined
  readonly local?: V | undefined
  readonly phase?: string | undefined
}

/** A draft's frames: a data URL each from the CLI's server, pixels from the tab. */
export type Frame = string | RgbaImage

export interface Store {
  readonly session: () => Promise<Session | undefined>
  /** `undefined` when it cannot be read (the CLI was stopped). */
  readonly version: () => Promise<Version | undefined>
  /** A draft baked as the bank says now, with its stamp. */
  readonly draft: (clip: string, id: string) => Promise<{ readonly stamp: string; readonly result: DraftResult<Frame> } | undefined>
  readonly spot: (clip: string, id: string, frame: number, x: number, y: number) => Promise<Spot>
  /** The picture pixel of an image part under a frame pixel: its pivot when dragged there. */
  readonly pivot: (clip: string, id: string, frame: number, part: string, x: number, y: number) => Promise<V | undefined>
  readonly save: (file: "bank" | "review", text: string) => Promise<void>
  /** Whether someone else (the agent) can change the files while the page is open. */
  readonly follows: boolean
  /** A demo: nothing is written anywhere, and the page says so. */
  readonly demo: boolean
}

const json = async (response: Response): Promise<unknown> => {
  const answer: unknown = await response.json()
  if (!response.ok) throw new Error(typeof answer === "object" && answer !== null && "error" in answer ? String(answer.error) : response.statusText)
  return answer
}

const post = async (route: string, body: unknown): Promise<unknown> => json(await fetch(route, { method: "POST", body: JSON.stringify(body) }))

/** The API `ritmo-tools rig review` serves beside the page (`cli/serve.ts`). */
export const serverStore: Store = {
  session: async () => (await json(await fetch("/api/session"))) as Session,
  version: async () => {
    try {
      return (await json(await fetch("/api/version"))) as Version
    } catch {
      return undefined
    }
  },
  draft: async (clip, id) => (await json(await fetch(`/api/draft?clip=${encodeURIComponent(clip)}&draft=${encodeURIComponent(id)}`))) as { stamp: string; result: DraftResult<Frame> },
  spot: async (clip, id, frame, x, y) => (await post("/api/spot", { clip, draft: id, frame, x, y })) as Spot,
  pivot: async (clip, id, frame, part, x, y) => ((await post("/api/pivot", { clip, draft: id, frame, part, x, y })) as { pivot?: V }).pivot,
  save: async (file, text) => {
    await json(await fetch(`/api/${file}`, { method: "PUT", body: text }))
  },
  follows: true,
  demo: false
}

/** The modules of a bank, imported already (by the bundler), by their path in the bank; and its pictures, decoded. */
export interface Modules {
  readonly modules: Readonly<Record<string, unknown>>
  readonly images: ReadonlyMap<string, RgbaImage>
}

/**
 * A bank kept in the tab, baked in the browser: what the person changes
 * lasts until the page closes, and a tune or a pivot rebakes there.
 */
export const memoryStore = (name: string, bankText: string, files: Modules): Store => {
  let bank = bankText
  let review: string | null = null
  let edits = 0
  const decoded = (): Bank | undefined => {
    const result = decodeBank(bank)
    return result.ok ? result.value : undefined
  }
  const rigOf = (current: Bank): Rig | string => {
    const result = decodeRig(files.modules[current.rig], files.images, current.pivots)
    return result.ok ? result.value : result.error
  }
  const stampOf = (current: Bank, clip: string, id: string): string => JSON.stringify([current.clips[clip]?.drafts[id], current.pivots])
  const versionOf = (): Version => {
    const current = decoded()
    const stamps: Record<string, string> = {}
    for (const [clip, entry] of Object.entries(current?.clips ?? {})) for (const id of Object.keys(entry.drafts)) stamps[`${clip}/${id}`] = stampOf(current!, clip, id)
    return { bank: String(edits), review: String(edits), stamps, baking: [] }
  }
  /** The draft's rig and clip, decoded as the bank says now. */
  const loaded = (clip: string, id: string) => {
    const current = decoded()
    const draft = current?.clips[clip]?.drafts[id]
    if (current === undefined || draft === undefined) return undefined
    const rig = rigOf(current)
    if (typeof rig === "string") return { error: rig, draft }
    const decodedClip = decodeClip(files.modules[draft.file], rig)
    return decodedClip.ok ? { rig, clip: decodedClip.value, draft, current } : { error: `${draft.file}: ${decodedClip.error}`, draft }
  }
  const baked = new Map<string, { readonly stamp: string; readonly result: DraftResult<Frame> }>()
  return {
    session: async () => {
      const current = decoded()
      const rig = current === undefined ? "the bank does not read" : rigOf(current)
      return {
        bank: name,
        name,
        bankText: bank,
        reviewText: review,
        rig: typeof rig === "string" ? { error: rig } : { width: rig.width, height: rig.height, anchor: rig.anchor, look: rig.look },
        version: versionOf()
      }
    },
    version: async () => versionOf(),
    draft: async (clip, id) => {
      const current = decoded()
      if (current === undefined) return undefined
      const stamp = stampOf(current, clip, id)
      const known = baked.get(`${clip}/${id}`)
      if (known !== undefined && known.stamp === stamp) return known
      const found = loaded(clip, id)
      if (found === undefined) return undefined
      const result: DraftResult<Frame> = "error" in found ? { ok: false, id, file: found.draft.file, error: found.error } : draftView(found.rig, found.clip, found.draft, id, clip)
      baked.set(`${clip}/${id}`, { stamp, result })
      return { stamp, result }
    },
    spot: async (clip, id, frame, x, y) => {
      const found = loaded(clip, id)
      return found === undefined || "error" in found ? {} : spotAt(found.rig, found.clip, found.draft, frame, x, y)
    },
    pivot: async (clip, id, frame, part, x, y) => {
      const found = loaded(clip, id)
      return found === undefined || "error" in found ? undefined : pivotAt(found.rig, found.clip, found.draft, frame, part, x, y)
    },
    save: async (file, text) => {
      if (file === "bank") bank = text
      else review = text
      edits += 1
    },
    follows: false,
    demo: true
  }
}
