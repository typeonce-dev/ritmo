/**
 * The skeleton lab's review page, served by `ritmo-tools rig review <bank>`:
 * the person watches every draft of a clip side by side on one clock,
 * slowed down or frame by frame, picks the one the game gets, tunes its
 * params with sliders, pins comments to a spot of a frame or to a span of
 * frames, and drags an image part's pivot where its joint is. Every change
 * is saved to the bank and its review as it happens, for the agent to read
 * back (`ritmo-tools rig notes`); a draft the agent edits while the page is
 * open rebakes and plays anew.
 *
 * Built from the pixel fixer's kit and the effects lab's layout and styles,
 * so the tools look and work alike. The frames are baked at 2× (by the
 * CLI's server, or in the tab for the website's demo); the page draws the
 * backdrop, ground line, onion skin, bones, pivots, and rings over them.
 */
import { button, callout, cliChip, group, hint, icon, mark, prop, section, segmented, sliderRow, switchRow } from "../../pixel/ui/kit.ts"
import { h, replace } from "../../pixel/ui/dom.ts"
import { decodeBank, decodeReview, emptyReview, encodeBank, encodeReview, isSpan, newClip, usedDraft, type Bank, type ClipReview, type Comment, type PixelComment, type SpanComment, type Status } from "../core/bank.ts"
import type { V } from "../core/rig.ts"
import type { DraftResult, DraftView, Mat6 } from "../core/view.ts"
import type { Frame, RigInfo, Store, Version } from "./store.ts"

const RITMO_URL = "https://ritmo.typeonce.dev/"

/** Where the bank and its review are read and written, and drafts baked: set once by `start`. */
let store!: Store

// ---------------------------------------------------------------------------
// State

type Speed = "1" | "0.5" | "0.25"
type Zoom = "1" | "2" | "3" | "4"
/** A comment being written: on a pixel of a frame, or on a span of frames. */
type Composing = Omit<PixelComment, "text"> | Omit<SpanComment, "text">
/** A check shown on the stage: its frames, with its bones traced and its parts boxed. */
interface Marks {
  readonly draft: string
  readonly key: string
  readonly frames: ReadonlyArray<number>
  readonly where: ReadonlyArray<string>
}

/** A draft as the page plays it: its view, and its frames ready to draw. */
interface Loaded {
  readonly stamp: string
  readonly result: DraftResult<Frame>
  readonly art: ReadonlyArray<CanvasImageSource>
}

const state = {
  name: "",
  bankFile: "",
  bank: { rig: "", clips: {} } as Bank,
  review: emptyReview,
  rig: undefined as RigInfo | undefined,
  rigError: undefined as string | undefined,
  /** Every draft fetched, by `clip/draft`. */
  drafts: {} as Record<string, Loaded>,
  version: undefined as Version | undefined,
  selected: "",
  focus: "",
  playing: true,
  frame: 0,
  speed: "1" as Speed,
  zoom: "2" as Zoom,
  bones: false,
  onion: false,
  ground: true,
  marks: undefined as Marks | undefined,
  composing: undefined as Composing | undefined,
  /** The first frame of a span being marked on the draft in focus (S, then S again on its last frame). */
  spanStart: undefined as number | undefined,
  /** An image part's pivot being dragged on the draft in focus: where it is now, in frame pixels. */
  dragging: undefined as { readonly part: string; at: V } | undefined,
  /** The person picked a zoom; until then each clip opens at the largest zoom that fits its drafts side by side. */
  zoomChosen: false,
  saving: "saved" as "saved" | "saving" | "failed",
  loaded: false
}

const names = (): ReadonlyArray<string> => Object.keys(state.bank.clips)
const reviewOf = (clip: string): ClipReview => state.review.clips[clip] ?? newClip
const loadedOf = (clip: string, id: string): Loaded | undefined => state.drafts[`${clip}/${id}`]
const viewOf = (clip: string, id: string): DraftView<Frame> | undefined => {
  const loaded = loadedOf(clip, id)
  return loaded?.result.ok === true ? loaded.result.view : undefined
}

// ---------------------------------------------------------------------------
// Saving: every change goes to the bank or the review, as in the effects lab

let saveTimer: ReturnType<typeof setTimeout> | undefined
let bankDirty = false
let reviewDirty = false
/** While the page writes, what changes on disk is its own doing: following waits. */
let flushing = false
const flush = async (): Promise<void> => {
  saveTimer = undefined
  flushing = true
  try {
    if (bankDirty) {
      bankDirty = false
      await store.save("bank", encodeBank(state.bank))
    }
    if (reviewDirty) {
      reviewDirty = false
      await store.save("review", encodeReview(state.review))
    }
    state.saving = bankDirty || reviewDirty ? "saving" : "saved"
    // What we wrote is what we have: the files' new times are ours, not the agent's.
    const now = await store.version()
    if (now !== undefined && state.version !== undefined) state.version = { ...state.version, bank: now.bank, review: now.review }
  } catch (error) {
    state.saving = "failed"
    say(`Not saved: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    flushing = false
  }
  renderTopbar()
}
const save = (what: { readonly bank?: boolean; readonly review?: boolean }, wait = 300): void => {
  if (what.bank === true) bankDirty = true
  if (what.review === true) reviewDirty = true
  state.saving = "saving"
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), wait)
}
const setReview = (clip: string, change: Partial<ClipReview>): void => {
  state.review = { clips: { ...state.review.clips, [clip]: { ...reviewOf(clip), ...change } } }
}
const setTune = (clip: string, id: string, tune: Readonly<Record<string, number>> | undefined): void => {
  const entry = state.bank.clips[clip]
  const draft = entry?.drafts[id]
  if (entry === undefined || draft === undefined) return
  state.bank = { ...state.bank, clips: { ...state.bank.clips, [clip]: { ...entry, drafts: { ...entry.drafts, [id]: { ...draft, tune } } } } }
}
const useDraft = (clip: string, id: string): void => {
  const entry = state.bank.clips[clip]
  if (entry === undefined) return
  state.bank = { ...state.bank, clips: { ...state.bank.clips, [clip]: { ...entry, use: id } } }
  state.focus = id
  save({ bank: true })
  update()
}

// ---------------------------------------------------------------------------
// Loading, and following the agent's edits and the rebakes

/** A frame as something a canvas draws: a data URL from the server, or pixels from the tab. */
const drawable = (frame: Frame): Promise<CanvasImageSource> => {
  if (typeof frame !== "string") {
    const canvas = document.createElement("canvas")
    canvas.width = frame.width
    canvas.height = frame.height
    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0)
    return Promise.resolve(canvas)
  }
  return new Promise((done) => {
    const image = new Image()
    image.onload = () => done(image)
    image.onerror = () => done(image)
    image.src = frame
  })
}

/** Fetches a draft's baked view, unless the one the page has is as new; returns whether it changed. */
const fetchDraft = async (clip: string, id: string): Promise<boolean> => {
  const stamp = state.version?.stamps[`${clip}/${id}`]
  const known = loadedOf(clip, id)
  if (known !== undefined && stamp !== undefined && known.stamp === stamp) return false
  const answer = await store.draft(clip, id).catch((error: unknown) => {
    say(`${clip} ${id} does not bake: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  })
  if (answer === undefined) return false
  const art = answer.result.ok ? await Promise.all(answer.result.view.art.map(drawable)) : []
  state.drafts[`${clip}/${id}`] = { stamp: answer.stamp, result: answer.result, art }
  return true
}

const fetchClip = async (clip: string): Promise<boolean> => {
  let changed = false
  for (const id of Object.keys(state.bank.clips[clip]?.drafts ?? {})) changed = (await fetchDraft(clip, id)) || changed
  return changed
}

const open = async (): Promise<void> => {
  const session = await store.session()
  if (session === undefined) return
  const bank = decodeBank(session.bankText)
  if (!bank.ok) {
    say(`The bank does not read: ${bank.error}`)
    return
  }
  const review = session.reviewText === null ? undefined : decodeReview(session.reviewText)
  state.bank = bank.value
  state.review = review?.ok === true ? review.value : emptyReview
  state.name = session.name
  state.bankFile = session.bank
  state.version = session.version
  if ("error" in session.rig) {
    state.rigError = session.rig.error
    state.rig = undefined
  } else {
    state.rig = session.rig
    state.rigError = undefined
  }
  state.loaded = true
  // The stage has its size once the page is drawn: zooms fit from it.
  update()
  const first = state.selected in state.bank.clips ? state.selected : (names()[0] ?? "")
  select(first)
  await fetchClip(first)
  update()
  // The other clips in the background, for their flags in the list.
  for (const clip of names()) if (clip !== first && (await fetchClip(clip))) renderList()
}

let following = false
const follow = async (): Promise<void> => {
  if (following || flushing || saveTimer !== undefined) return
  following = true
  try {
    const now = await store.version()
    const before = state.version
    if (now === undefined || before === undefined) return
    state.version = now
    if (now.bank !== before.bank || now.review !== before.review) {
      const session = await store.session()
      const bank = session === undefined ? undefined : decodeBank(session.bankText)
      const review = session?.reviewText == null ? undefined : decodeReview(session.reviewText)
      if (bank?.ok === true) state.bank = bank.value
      if (review?.ok === true) state.review = review.value
      if (session !== undefined && !("error" in session.rig)) state.rig = session.rig
      if (store.follows && now.review !== before.review) say("The review changed on disk (the agent resolved or replied): it is up to date.")
      update()
    }
    const changed = await fetchClip(state.selected)
    if (changed) {
      if (store.follows) say(`${state.selected} rebaked: the frames are new.`)
      update()
    }
    if (now.baking.join() !== before.baking.join()) renderTopbar()
  } catch {
    // The CLI was stopped; try again later.
  } finally {
    following = false
  }
}

// ---------------------------------------------------------------------------
// The page

const app = document.getElementById("app")!
const topbar = h("header", { class: "topbar" })
const list = h("aside", { class: "sounds", attrs: { "aria-label": "Clips" } })
const content = h("div", { class: "sound-view" })
const playback = h("div", { class: "floating playback" })
const toast = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } })
const panels = h("aside", { class: "inspector", attrs: { "aria-label": "Settings" } })
const stage = h("div", { class: "stage fx-stage" }, content, playback, toast)
app.append(topbar, h("main", { class: "layout lab" }, list, h("section", { class: "workspace" }, stage), panels))

const statusLabel: Record<Status, string> = { new: "To review", approved: "Approved", changes: "Changes asked" }
const count = (status: Status): number => names().filter((clip) => reviewOf(clip).status === status).length

const renderTopbar = (): void => {
  const baking = state.version?.baking ?? []
  replace(
    topbar,
    h(
      "div",
      { class: "topbar-start" },
      h(
        "div",
        { class: "brand" },
        mark(),
        h("span", {}, "Skeleton lab"),
        h("a", { class: "by", title: "Ritmo, the agent-first type safe ECS runtime", attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "by ", h("b", {}, "ritmo")),
        store.demo && cliChip("npx @typeonce/ritmo-tools rig review game.rig.json", "Your coding agent can drive the skeleton lab on your game's own characters: it writes the rig and its clips as code and checks them, then opens this page for you to watch, pick, tune, comment on, and drag pivots, and reads it all back.")
      ),
      state.loaded && h("div", { class: "file", title: state.bankFile }, h("span", { class: "file-name" }, state.name), h("span", { class: "file-meta" }, `${names().length} clips · ${count("approved")} approved`))
    ),
    h("div", { class: "topbar-center" }, baking.length > 0 && h("span", { class: "stage-pill rig-baking" }, `Baking ${baking.join(", ")}…`)),
    h(
      "div",
      { class: "topbar-end" },
      h(
        "span",
        { class: `save-state ${state.saving}`, title: store.demo ? "A demo: changes stay in this tab" : "Changes are written to the bank and its review as you make them" },
        state.saving === "saved" ? icon("check") : state.saving === "failed" ? icon("alert") : null,
        state.saving === "saved" ? (store.demo ? "Kept in this tab" : "Saved") : state.saving === "saving" ? "Saving…" : "Not saved"
      )
    )
  )
}

const select = (clip: string): void => {
  state.selected = clip
  const entry = state.bank.clips[clip]
  state.focus = entry === undefined ? "" : (usedDraft(entry) ?? "")
  state.frame = 0
  state.marks = undefined
  state.composing = undefined
  state.spanStart = undefined
  state.dragging = undefined
  if (!state.zoomChosen) state.zoom = fitZoom(clip)
  clock = performance.now()
  update()
  void fetchClip(clip).then((changed) => changed && update())
}

/** The largest zoom at which every draft of a clip fits side by side on the stage. */
const fitZoom = (clip: string): Zoom => {
  const rig = state.rig
  const n = Object.keys(state.bank.clips[clip]?.drafts ?? {}).length
  const width = content.clientWidth || stage.clientWidth - 64
  if (rig === undefined || n === 0) return state.zoom
  // Clear of the title above and the playback bar below, too.
  const height = stage.clientHeight - 260
  for (const zoom of ["4", "3", "2"] as const) if (n * (rig.width * Number(zoom) + 22) + (n - 1) * 14 <= width && rig.height * Number(zoom) <= height) return zoom
  return "1"
}

const renderList = (): void => {
  replace(
    list,
    h("div", { class: "sounds-head" }, h("p", { class: "hint" }, "Clips")),
    h(
      "div",
      { class: "sound-rows", attrs: { role: "listbox" } },
      names().map((clip) => {
        const drafts = Object.keys(state.bank.clips[clip]!.drafts).map((id) => loadedOf(clip, id)?.result)
        const errors = drafts.some((result) => result !== undefined && !result.ok)
        const warnings = drafts.some((result) => result?.ok === true && result.view.check.issues.length > 0)
        return h(
          "div",
          { class: `sound-row${clip === state.selected ? " on" : ""}`, attrs: { role: "option", "aria-selected": String(clip === state.selected), tabindex: 0 }, on: { click: () => select(clip) } },
          h("span", { class: `dot ${reviewOf(clip).status}`, title: statusLabel[reviewOf(clip).status] }),
          h("span", { class: "sound-name" }, clip),
          (errors || warnings) && h("span", { class: `sound-flag ${errors ? "bad" : "warn"}`, title: errors ? "A draft does not bake" : "A draft has warnings" }, icon("alert")),
          h("span", { class: "sound-length", title: "Drafts" }, `${Object.keys(state.bank.clips[clip]!.drafts).length}`)
        )
      })
    )
  )
}

// ---------------------------------------------------------------------------
// Playing: one clock for every draft

let clock = performance.now()
/** How long a one-shot holds its last frame before it plays again, in milliseconds. */
const REST = 450
const MARK = "#ff2bd6"
const BONE = "#ffd166"
const JOINT = "#ef476f"
const TRAIL = "#06d6a0"
const PIVOT = "#7ee8fa"

/** The frame a draft shows now. Paused, every draft shows the same frame (its last, when it is shorter). */
const frameNow = (view: DraftView<Frame>, now: number): number => {
  if (!state.playing) return Math.max(0, Math.min(view.frames - 1, state.frame))
  const elapsed = (now - clock) * Number(state.speed)
  const step = 1000 / view.fps
  if (view.loop) return Math.floor(elapsed / step) % view.frames
  const at = elapsed % (view.frames * step + REST)
  return Math.min(view.frames - 1, Math.floor(at / step))
}

const apply6 = (m: Mat6, p: V): V => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]

/** A comment's spot on a frame, in frame pixels: where its part's bone puts it now, so the ring follows the part after an edit (`commentSpot`'s rule, from the baked bone transforms). */
const spotOf = (comment: PixelComment, view: DraftView<Frame>, frame: number, rig: RigInfo): V => {
  const m = comment.bone === undefined ? undefined : view.bones[frame]?.[comment.bone]
  if (comment.local === undefined || m === undefined) return [comment.x + 0.5, comment.y + 0.5]
  const [x, y] = apply6(m, comment.local)
  return [rig.anchor[0] + x, rig.anchor[1] - y]
}

let cards: Array<{ readonly id: string; readonly canvas: HTMLCanvasElement; readonly loaded: Loaded; readonly view: DraftView<Frame>; readonly counter: HTMLElement }> = []

const paint = (canvas: HTMLCanvasElement, rig: RigInfo, card: (typeof cards)[number], frame: number): void => {
  const { view, loaded, id } = card
  const zoom = Number(state.zoom)
  const dpr = window.devicePixelRatio || 1
  const W = Math.round(rig.width * zoom * dpr)
  const H = Math.round(rig.height * zoom * dpr)
  if (canvas.width !== W) canvas.width = W
  if (canvas.height !== H) canvas.height = H
  const g = canvas.getContext("2d")
  if (g === null) return
  const k = zoom * dpr
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = "high"
  g.fillStyle = rig.look.background
  g.fillRect(0, 0, W, H)
  g.fillStyle = rig.look.floor
  g.fillRect(0, rig.anchor[1] * k, W, H - rig.anchor[1] * k)
  if (state.ground) {
    g.fillStyle = rig.look.ground
    g.fillRect(0, rig.anchor[1] * k - Math.max(1, 0.6 * k), W, Math.max(1, 1.2 * k))
  }
  const prev = view.loop ? (frame - 1 + view.frames) % view.frames : frame - 1
  if (state.onion && prev >= 0 && loaded.art[prev] !== undefined) {
    g.globalAlpha = 0.28
    g.drawImage(loaded.art[prev], 0, 0, W, H)
  }
  const art = loaded.art[frame]
  if (art !== undefined) {
    g.globalAlpha = state.bones ? 0.45 : 1
    g.drawImage(art, 0, 0, W, H)
  }
  g.globalAlpha = 1
  // World (y up, origin on the ground) to canvas pixels.
  const at = (p: V): V => [(rig.anchor[0] + p[0]) * k, (rig.anchor[1] - p[1]) * k]
  const bones = view.bones[frame] ?? {}
  if (state.bones) {
    for (const [bone, m] of Object.entries(bones)) {
      const a = at(apply6(m, [0, 0]))
      const b = at(apply6(m, [view.lengths[bone] ?? 0, 0]))
      g.strokeStyle = BONE
      g.lineWidth = 1.4 * dpr
      g.beginPath()
      g.moveTo(a[0], a[1])
      g.lineTo(b[0], b[1])
      g.stroke()
      g.fillStyle = JOINT
      g.beginPath()
      g.arc(a[0], a[1], 2.6 * dpr, 0, Math.PI * 2)
      g.fill()
    }
    view.trail.forEach((p, i) => {
      if (p === null) return
      const [x, y] = at(p)
      g.fillStyle = TRAIL
      g.beginPath()
      g.arc(x, y, (i === frame ? 3.6 : 1.8) * dpr, 0, Math.PI * 2)
      g.fill()
    })
    // The image parts' pivots on the draft in focus: drag one to where its joint is.
    if (id === state.focus)
      for (const [part, pivot] of Object.entries(view.pivots[frame] ?? {})) {
        const dragged = state.dragging?.part === part ? state.dragging.at : undefined
        const [x, y] = dragged === undefined ? at(pivot) : [dragged[0] * k, dragged[1] * k]
        g.strokeStyle = PIVOT
        g.lineWidth = 2 * dpr
        g.beginPath()
        g.arc(x, y, 5 * dpr, 0, Math.PI * 2)
        g.stroke()
        g.beginPath()
        g.moveTo(x - 8 * dpr, y)
        g.lineTo(x + 8 * dpr, y)
        g.moveTo(x, y - 8 * dpr)
        g.lineTo(x, y + 8 * dpr)
        g.stroke()
      }
  }
  g.strokeStyle = MARK
  g.fillStyle = MARK
  g.lineWidth = 2 * dpr
  g.font = `600 ${12 * dpr}px Inter, system-ui, sans-serif`
  const ring = (x: number, y: number, label: string): void => {
    g.beginPath()
    g.arc(x * k, y * k, 7 * dpr, 0, Math.PI * 2)
    g.stroke()
    g.fillText(label, x * k + 9 * dpr, y * k - 8 * dpr)
  }
  reviewOf(state.selected).comments.forEach((comment, i) => {
    if (isSpan(comment) || comment.draft !== id || comment.frame !== frame || comment.resolved === true) return
    const [x, y] = spotOf(comment, view, frame, rig)
    ring(x, y, String(i + 1))
  })
  const composing = state.composing
  if (composing !== undefined && !("from" in composing) && composing.draft === id && composing.frame === frame) ring(composing.x + 0.5, composing.y + 0.5, "+")
  // A check shown: its bones traced and its parts boxed, on its frames.
  const marks = state.marks
  if (marks !== undefined && marks.draft === id && marks.frames.includes(frame)) {
    for (const where of marks.where) {
      const m = bones[where]
      if (m !== undefined) {
        const a = at(apply6(m, [0, 0]))
        const b = at(apply6(m, [view.lengths[where] ?? 0, 0]))
        g.lineWidth = 4 * dpr
        g.beginPath()
        g.moveTo(a[0], a[1])
        g.lineTo(b[0], b[1])
        g.stroke()
        g.beginPath()
        g.arc(b[0], b[1], 8 * dpr, 0, Math.PI * 2)
        g.stroke()
        g.fillText(where, b[0] + 10 * dpr, b[1] - 8 * dpr)
        continue
      }
      const part = view.parts[frame]?.find((d) => d.part === where)
      if (part !== undefined) {
        const [x0, y0] = at([part.box[0], part.box[3]])
        const [x1, y1] = at([part.box[2], part.box[1]])
        const pad = 4 * dpr
        g.lineWidth = 2 * dpr
        g.strokeRect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)
        g.fillText(where, x0, y0 - pad - 4 * dpr)
      }
    }
    g.lineWidth = 2 * dpr
  }
}

const tick = (now: number): void => {
  const rig = state.rig
  if (rig !== undefined)
    for (const card of cards) {
      const frame = frameNow(card.view, now)
      paint(card.canvas, rig, card, frame)
      card.counter.textContent = `frame ${frame} ${card.view.phases[frame] ?? ""}`
      if (strip !== undefined && card.id === strip.id) strip.cells.forEach((cell, f) => cell.classList.toggle("now", f === frame))
    }
  requestAnimationFrame(tick)
}

/** A pointer's place on a card's canvas, in frame pixels (1x, from the top left, fractional). */
const framePoint = (canvas: HTMLCanvasElement, event: MouseEvent, rig: RigInfo): V => {
  const box = canvas.getBoundingClientRect()
  return [((event.clientX - box.left) / box.width) * rig.width, ((event.clientY - box.top) / box.height) * rig.height]
}

const renderStage = (): void => {
  cards = []
  const name = state.selected
  const entry = state.bank.clips[name]
  const rig = state.rig
  if (entry === undefined || rig === undefined) {
    replace(
      content,
      h(
        "div",
        { class: "empty-card lab-empty" },
        h("div", { class: "empty-icon" }, mark()),
        h("h2", {}, !state.loaded ? "Opening the bank…" : state.rigError !== undefined ? "The rig does not load" : "No clips in this bank"),
        state.rigError !== undefined && callout("bad", state.rigError)
      )
    )
    return
  }
  const said = reviewOf(name)
  const use = usedDraft(entry)
  const zoom = Number(state.zoom)
  // Every card is the size of the frame at this zoom, so nothing moves as the drafts play.
  const screen = { w: rig.width * zoom, h: rig.height * zoom }
  replace(
    content,
    h(
      "div",
      { class: "sound-head" },
      h("div", { class: "sound-title" }, h("h1", {}, name), said.status !== "new" && h("span", { class: `stage-pill ${said.status}` }, statusLabel[said.status])),
      entry.about !== undefined && h("p", { class: "sound-about" }, entry.about)
    ),
    h(
      "div",
      { class: "fx-drafts", attrs: { style: `--fx-screen-w:${screen.w}px;--fx-screen-h:${screen.h}px` } },
      Object.keys(entry.drafts).map((id, index) => {
        const loaded = loadedOf(name, id)
        const isUsed = id === use
        const tuned = entry.drafts[id]?.tune !== undefined
        const view = loaded?.result.ok === true ? loaded.result.view : undefined
        const head = h(
          "div",
          { class: "fx-card-head" },
          h("span", { class: "take-number" }, String(index + 1)),
          h("b", {}, id),
          h("span", { class: "fx-label" }, view?.label ?? ""),
          tuned && h("span", { class: "stage-pill tuned" }, "Tuned"),
          isUsed
            ? h("span", { class: "take-picked", title: "The game gets this draft" }, icon("check"), "In use")
            : button("Use", (event) => {
                event.stopPropagation()
                useDraft(name, id)
              }, { small: true, variant: "ghost", title: "The game gets this draft" })
        )
        const on = id === state.focus ? " on" : ""
        if (loaded === undefined || view === undefined)
          return h("div", { class: `fx-card${on}`, on: { click: () => focus(id) } }, head, loaded === undefined ? hint("Baking…") : callout("bad", loaded.result.ok ? "" : loaded.result.error))
        const canvas = h("canvas", {
          class: "fx-canvas rig-canvas",
          title: id === state.focus ? (state.bones ? "Drag a pivot (blue cross) to where its joint is, or click to comment on this spot" : "Click to comment on this spot (pauses on this frame)") : "Click to focus this draft",
          attrs: { style: `width:${screen.w}px;height:${screen.h}px` },
          on: {
            click: (event) => void pin(id, view, event),
            pointerdown: (event) => grab(id, view, event),
            pointermove: (event) => drag(event),
            pointerup: (event) => void drop(id, event)
          }
        })
        const counter = h("span", { class: "fx-counter rig-counter" })
        cards.push({ id, canvas, loaded, view, counter })
        const timing = `${view.frames} frames · ${view.fps} fps · ${view.check.duration} ms${view.loop ? " · loop" : ""}`
        return h(
          "div",
          { class: `fx-card${on}${isUsed ? " used" : ""}`, on: { click: () => focus(id) } },
          head,
          h("div", { class: "fx-screen" }, canvas),
          h(
            "div",
            { class: "fx-card-foot" },
            h("span", { title: timing }, timing),
            view.check.issues.length > 0 && h("span", { class: "sound-flag warn", title: view.check.issues.map((issue) => issue.message).join("\n") }, icon("alert")),
            counter
          )
        )
      })
    )
  )
}

/** On the draft in focus, pauses on the frame shown and starts a comment on the spot clicked, with the part there, its own bone, and the spot in that bone's frame. */
const pin = async (id: string, view: DraftView<Frame>, event: MouseEvent): Promise<void> => {
  const target = event.currentTarget
  const rig = state.rig
  if (!(target instanceof HTMLCanvasElement) || state.focus !== id || rig === undefined || justDragged) return
  const frame = frameNow(view, performance.now())
  if (state.playing) toggle()
  state.frame = frame
  const [fx, fy] = framePoint(target, event, rig)
  const x = Math.floor(fx)
  const y = Math.floor(fy)
  const spot = await store.spot(state.selected, id, frame, x, y).catch(() => ({}))
  state.composing = { draft: id, frame, x, y, ...spot }
  state.spanStart = undefined
  update()
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".fx-compose textarea")?.focus())
}

/** Dragging a pivot, with the bones overlay on: grab the cross nearest the pointer (within 10 screen pixels). */
let justDragged = false
const grab = (id: string, view: DraftView<Frame>, event: PointerEvent): void => {
  const target = event.currentTarget
  const rig = state.rig
  if (!state.bones || state.focus !== id || rig === undefined || !(target instanceof HTMLCanvasElement)) return
  const frame = frameNow(view, performance.now())
  const point = framePoint(target, event, rig)
  const reach = 10 / Number(state.zoom)
  const near = Object.entries(view.pivots[frame] ?? {})
    .map(([part, [wx, wy]]) => ({ part, d: Math.hypot(rig.anchor[0] + wx - point[0], rig.anchor[1] - wy - point[1]) }))
    .filter((entry) => entry.d <= reach)
    .sort((a, b) => a.d - b.d)[0]
  if (near === undefined) return
  if (state.playing) toggle()
  state.frame = frame
  state.dragging = { part: near.part, at: point }
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}
const drag = (event: PointerEvent): void => {
  const target = event.currentTarget
  if (state.dragging === undefined || state.rig === undefined || !(target instanceof HTMLCanvasElement)) return
  state.dragging.at = framePoint(target, event, state.rig)
}
const drop = async (id: string, event: PointerEvent): Promise<void> => {
  const dragged = state.dragging
  if (dragged === undefined) return
  state.dragging = undefined
  justDragged = true
  setTimeout(() => (justDragged = false), 0)
  const target = event.currentTarget
  if (target instanceof HTMLCanvasElement) target.releasePointerCapture(event.pointerId)
  const pivot = await store.pivot(state.selected, id, state.frame, dragged.part, dragged.at[0], dragged.at[1]).catch(() => undefined)
  if (pivot === undefined) return
  // The one way a person moves a pivot: an override in the bank, never the rig module's code.
  state.bank = { ...state.bank, pivots: { ...state.bank.pivots, [dragged.part]: pivot } }
  save({ bank: true }, 0)
  say(`${dragged.part}'s pivot is now ${pivot[0]}, ${pivot[1]} in its picture: saved to the bank's pivots, for the agent to fold into the rig module. Rebaking…`)
  update()
}

const goTo = (comment: Comment): void => {
  if (state.playing) toggle()
  state.frame = isSpan(comment) ? comment.from : comment.frame
  state.focus = comment.draft
  state.marks = undefined
  update()
}

const focus = (id: string): void => {
  if (state.focus === id) return
  state.focus = id
  renderStage()
  renderPlayback()
  renderPanels()
}

/** S on a frame starts a span on the draft in focus; S on another frame closes it and starts a comment on the frames between. */
const markSpan = (): void => {
  const view = viewOf(state.selected, state.focus)
  if (view === undefined) return
  if (state.playing) toggle()
  const frame = Math.max(0, Math.min(view.frames - 1, state.frame))
  if (state.spanStart === undefined) {
    state.spanStart = frame
    state.composing = undefined
    say(`Span from frame ${frame}: step to its last frame and press S again (Escape cancels).`)
    update()
    return
  }
  const from = Math.min(state.spanStart, frame)
  const to = Math.max(state.spanStart, frame)
  const phases = [...new Set(view.phases.slice(from, to + 1).filter((phase) => phase !== ""))]
  state.spanStart = undefined
  toast.classList.remove("on")
  state.composing = { draft: state.focus, from, to, ...(phases.length > 0 ? { phases } : {}) }
  update()
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".fx-compose textarea")?.focus())
}

/** The frame strip of the focused draft: the frame shown, fast frames tinted, key frames marked, span comments as numbered bands. */
let strip: { readonly cells: ReadonlyArray<HTMLElement>; readonly id: string } | undefined
const CELL = 14
const timeline = (): HTMLElement | false => {
  const view = viewOf(state.selected, state.focus)
  if (view === undefined) {
    strip = undefined
    return false
  }
  const fast = new Set(view.fast)
  // A key between frames (at 7.5) marks the frame nearest it.
  const keys = new Set(view.keys.map((at) => Math.round(at)))
  const cells = Array.from({ length: view.frames }, (_, f) =>
    h("span", {
      class: `rig-cell${fast.has(f) ? " fast" : ""}${keys.has(f) ? " key" : ""}${state.spanStart === f ? " start" : ""}${f > 0 && view.phases[f] !== view.phases[f - 1] ? " phase" : ""}`,
      title: `frame ${f}${view.phases[f] ? ` · ${view.phases[f]}` : ""}${keys.has(f) ? " · a key" : ""}${fast.has(f) ? " · fast" : ""}`,
      on: {
        click: () => {
          if (state.playing) toggle()
          state.frame = f
        }
      }
    })
  )
  strip = { cells, id: state.focus }
  const band = (from: number, to: number, label: string, extra = ""): HTMLElement =>
    h("span", { class: `rig-band${extra}`, attrs: { style: `left:${4 + from * CELL - 2}px;width:${(to - from + 1) * CELL + 2}px` } }, h("b", {}, label))
  const bands = reviewOf(state.selected).comments.flatMap((comment, i) => (isSpan(comment) && comment.draft === state.focus && comment.resolved !== true ? [band(comment.from, comment.to, String(i + 1))] : []))
  const composing = state.composing
  const pending = composing !== undefined && "from" in composing && composing.draft === state.focus ? [band(composing.from, composing.to, "+", " pending")] : []
  return h("div", { class: "rig-timeline", title: `Frames of draft ${state.focus}: click one to go there; a dot marks a key` }, cells, bands, pending)
}

const renderPlayback = (): void => {
  replace(
    playback,
    button(state.playing ? "Pause" : "Play", () => toggle(), { variant: "ghost", icon: state.playing ? "pause" : "play", iconOnly: true, title: state.playing ? "Pause (Space)" : "Play (Space)" }),
    button("Previous frame", () => stepFrame(-1), { variant: "ghost", icon: "previous", iconOnly: true, title: "Previous frame (←)" }),
    button("Next frame", () => stepFrame(1), { variant: "ghost", icon: "next", iconOnly: true, title: "Next frame (→)" }),
    timeline(),
    button(state.spanStart === undefined ? "Span" : `Span ${state.spanStart}–`, () => markSpan(), {
      variant: state.spanStart === undefined ? "ghost" : "primary",
      small: true,
      title: state.spanStart === undefined ? "Comment on a span of frames: press on its first frame (S), step, press again on its last" : "Press on the span's last frame to close it (S); Escape cancels"
    }),
    segmented(
      state.speed,
      [
        { id: "0.25", label: "¼×", title: "A quarter of the speed" },
        { id: "0.5", label: "½×", title: "Half the speed" },
        { id: "1", label: "1×", title: "The game's speed" }
      ],
      (speed) => {
        state.speed = speed
        clock = performance.now()
        renderPlayback()
      },
      { label: "Speed" }
    ),
    segmented(
      state.zoom,
      [
        { id: "1", label: "1×", title: "The sprite's size in the game" },
        { id: "2", label: "2×", title: "The size it is baked at for this page" },
        { id: "3", label: "3×" },
        { id: "4", label: "4×" }
      ],
      (zoom) => {
        state.zoom = zoom
        state.zoomChosen = true
        renderStage()
        renderPlayback()
      },
      { label: "Zoom" }
    )
  )
}

const toggle = (): void => {
  if (state.playing) {
    const view = viewOf(state.selected, state.focus)
    state.frame = view === undefined ? 0 : frameNow(view, performance.now())
  } else clock = performance.now()
  state.playing = !state.playing
  renderPlayback()
}

const stepFrame = (by: number): void => {
  if (state.playing) toggle()
  const longest = Math.max(1, ...Object.keys(state.bank.clips[state.selected]?.drafts ?? {}).map((id) => viewOf(state.selected, id)?.frames ?? 1))
  state.frame = (((state.frame + by) % longest) + longest) % longest
}

// ---------------------------------------------------------------------------
// Panels: Review, Comments, Tune, Check, Toggles

const statusOptions = [
  { id: "new" as const, label: "To review", icon: "sparkle" as const, title: "Not reviewed yet" },
  { id: "approved" as const, label: "Approved", icon: "check" as const, title: "It looks right" },
  { id: "changes" as const, label: "Changes", icon: "alert" as const, title: "Ask the agent for changes: say what in the note" }
]

const reviewPanel = (clip: string): HTMLElement => {
  const said = reviewOf(clip)
  return section(
    {
      id: "review",
      title: "Review",
      help: "Pick the draft the game gets with Use, then approve it, or ask for changes and say what in your own words (\"b, but a longer hold\", \"the far arm looks stiff\"). The agent reads every note with `ritmo-tools rig notes`.",
      onToggle: update
    },
    segmented(
      said.status,
      statusOptions,
      (status) => {
        setReview(clip, { status })
        save({ review: true })
        update()
      },
      { label: "Status", class: "fill" }
    ),
    h(
      "label",
      { class: "input note" },
      h("textarea", {
        props: { value: said.note, rows: 4 },
        attrs: { placeholder: said.status === "changes" ? "What should change? Name drafts by letter." : "A note for the agent (optional)", "aria-label": "Note" },
        on: {
          input: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLTextAreaElement)) return
            setReview(clip, { note: target.value })
            save({ review: true })
            renderTopbar()
          }
        }
      })
    )
  )
}

const whereText = (comment: Composing | Comment): string =>
  "from" in comment
    ? `${comment.draft} · frames ${comment.from}-${comment.to}${comment.phases !== undefined && comment.phases.length > 0 ? ` (${comment.phases.join(", ")})` : ""}`
    : `${comment.draft} · frame ${comment.frame}${comment.phase ? ` (${comment.phase})` : ""} · (${comment.x}, ${comment.y})${comment.part ? ` · ${comment.part}` : ""}${comment.bone ? ` on ${comment.bone}` : ""}`

const commentsPanel = (clip: string): HTMLElement => {
  const comments = reviewOf(clip).comments
  const open = comments.filter((comment) => comment.resolved !== true).length
  const composing = state.composing
  const setComment = (index: number, change: Partial<Comment>): void => {
    setReview(clip, { comments: reviewOf(clip).comments.map((comment, i) => (i === index ? { ...comment, ...change } : comment)) })
    save({ review: true })
    update()
  }
  return section(
    {
      id: "comments",
      title: `Comments${comments.length > 0 ? ` · ${open} open` : ""}`,
      help: "Click a spot of the draft in focus to pin a comment there (it pauses on that frame): the agent gets the frame, the part, and its bone, and the ring follows the part when the agent changes the pose. For timing, press S on a frame and S again on another to comment on the frames between.",
      onToggle: update
    },
    composing !== undefined &&
      h(
        "div",
        { class: "fx-compose" },
        h("p", { class: "hint" }, whereText(composing)),
        h("label", { class: "input note" }, h("textarea", { props: { rows: 2 }, attrs: { placeholder: "from" in composing ? "What about these frames? (\"too slow here\", \"no weight shift\")" : "What about this spot? (\"the elbow pops here\", \"blade too low\")", "aria-label": "Comment" } })),
        h(
          "div",
          { class: "fx-compose-actions" },
          button("Cancel", () => {
            state.composing = undefined
            update()
          }, { small: true, variant: "ghost" }),
          button("Add", () => {
            const text = document.querySelector<HTMLTextAreaElement>(".fx-compose textarea")?.value.trim() ?? ""
            if (text === "") return
            setReview(clip, { comments: [...reviewOf(clip).comments, { ...composing, text }] })
            state.composing = undefined
            save({ review: true })
            update()
          }, { small: true, variant: "primary" })
        )
      ),
    comments.length === 0 && composing === undefined
      ? hint("No comments yet. Click a spot of the draft in focus, or press S on two frames for a span.")
      : h(
          "ol",
          { class: "fx-comments" },
          comments.map((comment, index) =>
            h(
              "li",
              { class: comment.resolved === true ? "resolved" : "" },
              h(
                "button",
                { class: "fx-comment", title: "Show this frame, with the spot ringed", attrs: { type: "button" }, on: { click: () => goTo(comment) } },
                h("span", { class: "fx-comment-number" }, comment.resolved === true ? icon("check") : String(index + 1)),
                h("span", { class: "fx-comment-where" }, `${whereText(comment)}${comment.resolved === true ? " · resolved" : ""}`),
                h("span", { class: "fx-comment-text" }, comment.text),
                comment.resolved === true && comment.reply !== undefined && h("span", { class: "fx-comment-reply" }, `Agent: ${comment.reply}`)
              ),
              comment.resolved === true && button("Reopen", () => setComment(index, { resolved: undefined, reply: undefined }), { small: true, variant: "ghost", title: "It is not done: the agent sees it again in rig notes" }),
              button("Delete", () => {
                setReview(clip, { comments: reviewOf(clip).comments.filter((_, i) => i !== index) })
                save({ review: true })
                update()
              }, { small: true, variant: "ghost", icon: "trash", iconOnly: true, title: "Delete this comment" })
            )
          )
        )
  )
}

const tunePanel = (clip: string): HTMLElement | undefined => {
  const view = viewOf(clip, state.focus)
  const draft = state.bank.clips[clip]?.drafts[state.focus]
  if (view === undefined || draft === undefined) return undefined
  const params = Object.entries(view.params)
  return section(
    {
      id: "tune",
      title: `Tune draft ${state.focus}`,
      help: "The params the agent left open in this draft. Moving a slider saves the draft's tune in the bank and the draft rebakes; the game gets the tune when this draft is in use.",
      onToggle: update,
      action:
        draft.tune !== undefined &&
        button(
          "Reset",
          () => {
            setTune(clip, state.focus, undefined)
            save({ bank: true })
            update()
          },
          { small: true, variant: "ghost", title: "Back to the draft's own values" }
        )
    },
    params.length === 0
      ? hint("This draft has no params to tune.")
      : params.map(([param, spec]) => {
          const step = spec.step ?? 10 ** Math.floor(Math.log10((spec.max - spec.min) / 20))
          const decimals = Math.max(0, -Math.floor(Math.log10(step)))
          return sliderRow(
            param,
            draft.tune?.[param] ?? spec.value,
            { min: spec.min, max: spec.max, step },
            (value) => value.toFixed(decimals),
            (value) => setTune(clip, state.focus, { ...(state.bank.clips[clip]?.drafts[state.focus]?.tune ?? {}), [param]: value }),
            () => {
              save({ bank: true }, 0)
              renderStage()
            },
            `From ${spec.min} to ${spec.max}; the draft's own value is ${spec.value}`
          )
        })
  )
}

const checkPanel = (clip: string): HTMLElement | undefined => {
  const loaded = loadedOf(clip, state.focus)
  if (loaded === undefined) return undefined
  if (!loaded.result.ok) return section({ id: "check", title: `Check draft ${state.focus}`, onToggle: update }, callout("bad", loaded.result.error))
  const view = loaded.result.view
  const check = view.check
  return section(
    {
      id: "check",
      title: `Check draft ${state.focus}`,
      help: "What `ritmo-tools rig check` measures for the agent, which cannot see the clip: these numbers are what it reads. Warnings are its call; your eyes decide.",
      onToggle: update
    },
    group(
      "Measures",
      prop("File", h("span", { class: "value mono" }, view.file)),
      prop("Length", h("span", { class: "value" }, `${check.duration} ms · ${view.frames} frames`)),
      check.trail !== undefined && prop("Peak", h("span", { class: "value" }, `${check.trail.peak.pxPerFrame} px/frame on frame ${check.trail.peak.frame}`), `The ${check.trail.bone} tip's fastest frame`),
      check.trail !== undefined && prop("Arc", h("span", { class: "value" }, `${check.trail.arc}°`), `How far the ${check.trail.bone} turns`)
    ),
    Object.keys(check.joints).length > 0 &&
      group(
        "Joints",
        Object.entries(check.joints).map(([chain, joint]) => prop(chain, h("span", { class: "value" }, `${joint.min}° to ${joint.max}°`), `${joint.joint}'s bend on each frame (0 straight): ${joint.bend.map((b) => (b === null ? "–" : b)).join(" ")}`))
      ),
    check.issues.length === 0
      ? hint("Nothing to flag.")
      : h(
          "ul",
          { class: "issues" },
          check.issues.map((issue, i) => {
            const key = `${i}:${issue.code}`
            const frames = issue.frames ?? []
            const shown = state.marks?.draft === state.focus && state.marks.key === key
            return h(
              "li",
              { class: issue.level },
              icon("alert"),
              h("span", {}, issue.message),
              frames.length > 0 &&
                button(shown ? "Hide" : "Show", () => {
                  if (shown) state.marks = undefined
                  else {
                    if (state.playing) toggle()
                    state.frame = frames[0]!
                    state.marks = { draft: state.focus, key, frames, where: issue.where ?? [] }
                  }
                  renderPanels()
                }, { small: true, variant: "ghost", title: "Pause on its first frame with its bones traced or its parts boxed" })
            )
          })
        ),
    check.accepted.length > 0 &&
      group(
        "Accepted",
        h("ul", { class: "issues accepted" }, check.accepted.map((issue) => h("li", { class: "accepted", title: issue.message }, icon("check"), h("span", {}, h("b", {}, issue.code), ": ", issue.why))))
      )
  )
}

const togglesPanel = (): HTMLElement =>
  section(
    {
      id: "toggles",
      title: "Toggles",
      help: "With the bones on, an image part's pivot shows as a blue cross on the draft in focus: drag it to where the part's joint is. It saves to the bank's pivots (the one way to move a pivot from here), and the draft rebakes.",
      onToggle: update
    },
    switchRow("Bones", state.bones, (on) => ((state.bones = on), renderStage(), renderPanels()), "The skeleton over a dimmed character, the trail bone's tip on every frame, and the image parts' pivots"),
    switchRow("Onion skin", state.onion, (on) => ((state.onion = on), renderPanels()), "The frame before, faint, under this one"),
    switchRow("Ground line", state.ground, (on) => ((state.ground = on), renderPanels())),
    Object.keys(state.bank.pivots ?? {}).length > 0 &&
      group(
        "Pivots moved",
        h("ul", { class: "issues accepted" }, Object.entries(state.bank.pivots ?? {}).map(([part, [x, y]]) => h("li", { class: "accepted" }, icon("check"), h("span", {}, h("b", {}, part), `: ${x}, ${y}`)))),
        hint("The agent folds these into the rig module and clears them (`rig notes` lists them).")
      )
  )

const aboutPanel = (): HTMLElement =>
  h(
    "footer",
    { class: "about" },
    h("div", { class: "ruler", attrs: { "aria-hidden": "true" } }),
    h("div", { class: "about-head" }, mark(), "Skeleton lab, by Ritmo"),
    h(
      "p",
      {},
      "Characters animated on a skeleton, as code: a rig module and a few drafts of each clip. Agents write, check, and look at them from the command line: ",
      h("code", {}, "ritmo-tools rig check"),
      ", ",
      h("code", {}, "ritmo-tools rig look"),
      ", ",
      h("code", {}, "ritmo-tools rig notes"),
      ". What you pick, tune, pin, and drag here is saved to ",
      h("code", {}, state.name),
      " and its review.",
      store.demo && [" This demo keeps it in the tab. To open your own bank: ", h("code", {}, "npx @typeonce/ritmo-tools rig review game.rig.json"), "."],
      " Keys: Space plays, ← → step frames, ↑ ↓ change clip, 1–9 focus a draft, S marks a span, Escape clears. Click a spot to comment on it."
    )
  )

const renderPanels = (): void => {
  const scroll = panels.scrollTop
  const clip = state.selected
  replace(panels, clip in state.bank.clips && [reviewPanel(clip), commentsPanel(clip), tunePanel(clip), checkPanel(clip), togglesPanel()], aboutPanel())
  panels.scrollTop = scroll
}

// ---------------------------------------------------------------------------
// Messages

let toastTimer: ReturnType<typeof setTimeout> | undefined
function say(message: string): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  replace(toast, h("span", {}, message), button("Dismiss", () => toast.classList.remove("on"), { variant: "ghost", icon: "close", iconOnly: true, small: true }))
  toast.classList.add("on")
  toastTimer = setTimeout(() => toast.classList.remove("on"), 4000)
}

const update = (): void => {
  renderTopbar()
  renderList()
  renderStage()
  renderPlayback()
  renderPanels()
}

window.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && (target.type !== "range" || event.key.startsWith("Arrow"))) return
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === "Escape" && (state.marks !== undefined || state.composing !== undefined || state.spanStart !== undefined)) {
    state.marks = undefined
    state.composing = undefined
    state.spanStart = undefined
    update()
  } else if (event.key === " ") {
    event.preventDefault()
    toggle()
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault()
    stepFrame(event.key === "ArrowRight" ? 1 : -1)
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    const all = names()
    const at = all.indexOf(state.selected)
    if (all.length > 0) select(all[(at + (event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]!)
  } else if (event.key === "s" || event.key === "S") {
    markSpan()
  } else if (/^[1-9]$/.test(event.key)) {
    const id = Object.keys(state.bank.clips[state.selected]?.drafts ?? {})[Number(event.key) - 1]
    if (id !== undefined) focus(id)
  }
})

/** Draws the page, opens the bank from where `chosen` keeps it, and follows the agent's changes and the rebakes. */
export const start = (chosen: Store, first = ""): void => {
  store = chosen
  state.selected = first
  update()
  void open()
  setInterval(() => void follow(), 500)
  requestAnimationFrame(tick)
}
