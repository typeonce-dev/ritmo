/**
 * The pixel art review page, served by `ritmo-tools pixel review <paths>`
 * (`main.ts`): the person goes through a game's art on a list, by folder.
 * Each asset opens as large as fits the stage and zooms by whole numbers, down
 * to its own size (1×), over a backdrop of their choosing; a sheet plays by animation, with its frames'
 * own timings. They approve it, or ask for changes with a note and comments
 * pinned to an area of pixels on a frame; the lint against the asset's
 * nearest `pixel.config.json` shows beside it. The whole set also shows
 * side by side at one scale, on a grid by size, to judge the art as one game,
 * and to compare and approve several at once. Art with a normal map beside it
 * (`ritmo-tools pixel normals`) also shows under a light they can move, alone
 * or the whole set under one light, and a comment can say which way a surface
 * should face.
 *
 * The review is one file, saved whole as it changes (one undo history for
 * all of it), for the agent to read back with `ritmo-tools pixel notes`. Art
 * the agent rewrites or adds, and comments it resolves (`pixel resolve`),
 * show up while the page is open. Nothing here edits pixels: hand fixes
 * belong on the pixel fixer's page, and the agent regenerates art.
 *
 * Built from the pixel fixer's kit, so the tools look and work alike.
 */
import { button, callout, group, hint, icon, mark, prop, section, segmented, sliderRow, switchRow } from "../ui/kit.ts"
import { h, replace } from "../ui/dom.ts"
import { makeHistory } from "../ui/history.ts"
import { parseHex } from "../core/color.ts"
import { facings, lightFrame, type Facing, type Light } from "../core/normals.ts"
import { approvalOf, changedOf, decodeReview, emptyReview, encodeReview, mergeReviews, newAsset, whereOf, type AssetReview, type Comment, type Review, type Status } from "../core/review.ts"
import { SERVER_GONE, type Detail, type Entry, type FrameIssue, type Store } from "./store.ts"

const RITMO_URL = "https://ritmo.typeonce.dev/"

/** Where the art and the review are read and written: set once by `start`. */
let store!: Store

// ---------------------------------------------------------------------------
// State

type Show = "all" | Status
type View = "asset" | "set"
type Backdrop = "dark" | "light" | "checker" | "custom"
/** What the art is drawn as: itself, under the light, or its normal map. */
type Look = "art" | "lit" | "normal"

/** An area of one frame, in its pixels: where a comment is pinned. */
interface Area {
  readonly animation: string | undefined
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const state = {
  /** Every asset, as the server last listed it. */
  library: [] as ReadonlyArray<Entry>,
  libraryVersion: "",
  /** The whole review, by asset id, as the page has it now. */
  review: emptyReview,
  /** The review as the file held it when the page last read or wrote it: what a merge starts from. */
  base: emptyReview,
  reviewVersion: "",
  /** Why the review file cannot be read, when it cannot: the page then writes nothing over it. */
  reviewProblem: undefined as string | undefined,
  /** The asset open now. */
  current: "",
  detail: undefined as Detail | undefined,
  view: "asset" as View,
  show: "all" as Show,
  search: "",
  /** The asset's zoom: 1 is the art at its own size. A whole number, or under 1 for a picture shrunk to fit. */
  zoom: 1,
  /** Whether each asset takes the zoom that fits it, until the person picks one. */
  fit: true,
  /** The whole set's zoom. */
  setZoom: 1,
  /** Whether the whole set takes the zoom its art's size asks for, until the person picks one. */
  setFit: true,
  /** Assets picked in the whole set, to compare or approve together. */
  picked: new Set<string>(),
  onlyPicked: false,
  backdrop: "dark" as Backdrop,
  custom: "#3a4466",
  /** The frame drawn three by three, to see a tile repeat. */
  repeat: false,
  look: "art" as Look,
  /** The light, by each frame's own size, so the whole set takes one light the same way: x and y from 0 to 1 across the frame, height and reach as shares of its longest side. */
  light: { x: 0.15, y: 0.2, height: 0.4, reach: 3, ambient: 0.2, brightness: 1.1, color: "#ffffff", steps: 0 },
  /** The light going round by itself, to see every side of the shape. */
  orbit: false,
  /** The animation open on a sheet, by name. */
  animation: "",
  playing: true,
  /** The place in the animation shown while paused, from 0. */
  frame: 0,
  /** A comment being written, on the area the person drew. */
  composing: undefined as Area | undefined,
  /** What it says so far: kept here, so a redraw of the panel never loses it. */
  composingText: "",
  /** The way it says the surface should face, if it does. */
  composingFacing: undefined as Facing | undefined,
  /** Pixels ringed from the Rules section: where a lint issue is. */
  marks: undefined as { readonly frame: number; readonly at: ReadonlyArray<readonly [number, number]> } | undefined,
  saving: "saved" as "saved" | "saving" | "failed",
  /** Whether the review server answered the last look. */
  online: true,
  /** How far the server is, while it reads the art for the first time. */
  reading: undefined as { readonly done: number; readonly total: number } | undefined,
  loaded: false
}

const entryOf = (id: string): Entry | undefined => state.library.find((entry) => entry.id === id)
const reviewOf = (id: string): AssetReview => state.review.assets[id] ?? newAsset
const changedNow = (entry: Entry): string | undefined => (entry.problem === undefined ? changedOf(reviewOf(entry.id), entry.frames, entry.normal) : undefined)
const openComments = (id: string): number => reviewOf(id).comments.filter((comment) => comment.resolved !== true).length

/** An asset's animations; a still is one of one frame, with no name. */
const animationsOf = (entry: Entry): ReadonlyArray<{ readonly name: string; readonly frames: ReadonlyArray<number>; readonly play: ReadonlyArray<number> }> =>
  entry.animations.length > 0 ? entry.animations : [{ name: "", frames: [0], play: [0] }]

const animationOf = (entry: Entry) => animationsOf(entry).find((animation) => animation.name === state.animation) ?? animationsOf(entry)[0]!

// ---------------------------------------------------------------------------
// Saving: the whole review goes back to its file as it changes

let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> = Promise.resolve()

const without = (review: Review, ids: ReadonlyArray<string>): Review => ({ assets: Object.fromEntries(Object.entries(review.assets).filter(([id]) => !ids.includes(id))) })

const flush = (): Promise<void> => {
  flushing = flushing.then(write)
  return flushing
}

const write = async (): Promise<void> => {
  saveTimer = undefined
  if (!dirty || state.reviewProblem !== undefined) return
  // What is on its way stays owed until it lands: a change made meanwhile sets the flag again, and a failure puts it back.
  dirty = false
  let owed = true
  try {
    for (let attempt = 0; owed && attempt < 3; attempt++) {
      const text = encodeReview(state.review)
      const saved = await store.save(text, state.reviewVersion)
      if (saved.ok) {
        owed = false
        state.reviewVersion = saved.version
        const sent = decodeReview(text)
        if (sent.ok) state.base = without(sent.value, saved.ignored)
        if (saved.ignored.length > 0) {
          state.review = without(state.review, saved.ignored)
          say(`${saved.ignored.join(", ")} is gone: renamed or deleted. What was said about it stays in pixel.review.json under that name, and the agent sees it in \`pixel notes\`.`)
        }
        continue
      }
      // The agent wrote the review meanwhile (a resolved comment): keep both, and try again.
      const theirs = decodeReview(saved.text)
      if (!theirs.ok) throw new Error(theirs.error)
      state.review = mergeReviews(state.base, state.review, theirs.value)
      state.base = theirs.value
      state.reviewVersion = saved.version
      reviewShown()
    }
    if (owed) throw new Error("the review kept changing while saving")
    state.saving = dirty ? "saving" : "saved"
  } catch (error) {
    dirty ||= owed
    state.saving = "failed"
    say(`Not saved: ${error instanceof Error ? error.message : String(error)}`)
  }
  renderTopbar()
}

const save = (): void => {
  dirty = true
  state.saving = "saving"
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), 400)
}

/** Something here is not in the file yet: what it holds now is not to be taken over it. */
const busy = (): boolean => saveTimer !== undefined || dirty || state.saving === "saving"

const history = makeHistory(
  () => encodeReview(state.review),
  (snapshot) => {
    const review = decodeReview(snapshot)
    if (review.ok) state.review = review.value
    save()
    reviewShown()
  },
  () => renderTopbar()
)

const setReview = (id: string, change: Partial<AssetReview>): void => {
  state.review = { assets: { ...state.review.assets, [id]: { ...reviewOf(id), ...change } } }
}

/** Records a change to the review: undoable, saved, and shown. */
const reviewChanged = (): void => {
  save()
  history.schedule()
  reviewShown()
}

/** Adds the comment being written, when it says anything, to the asset open, and ends it. */
const addComposed = (): void => {
  const area = state.composing
  const facing = state.composingFacing
  const text = state.composingText.trim() || (facing === undefined ? "" : `Should face ${facing}`)
  state.composing = undefined
  state.composingText = ""
  state.composingFacing = undefined
  if (area === undefined || text === "") return
  const id = state.current
  setReview(id, {
    comments: [
      ...reviewOf(id).comments,
      { ...(area.animation === undefined ? {} : { animation: area.animation }), frame: area.frame, x: area.x, y: area.y, ...(area.width > 1 ? { width: area.width } : {}), ...(area.height > 1 ? { height: area.height } : {}), text, ...(facing === undefined ? {} : { facing }) }
    ]
  })
  reviewChanged()
}

/** Moving on keeps what was typed: everything else the person says is saved as they go. Only Cancel or Esc drops it. */
const settleComposed = (): void => {
  const added = state.composing !== undefined && (state.composingText.trim() !== "" || state.composingFacing !== undefined)
  addComposed()
  if (added) say("Your comment is added. Delete it there if you were not done with it.")
}

const dropComposed = (): void => {
  state.composing = undefined
  state.composingText = ""
  state.composingFacing = undefined
}

/** Sets an asset's status; approving keeps what it looks like now, so a later change to it shows. */
const setStatus = (entry: Entry, status: Status): void => {
  setReview(entry.id, { status, approved: status === "approved" && entry.problem === undefined ? approvalOf(entry.frames, entry.normal) : undefined })
}

// ---------------------------------------------------------------------------
// Loading, and following what the agent changes while the page is open

const pictures = new Map<string, Promise<HTMLImageElement | undefined>>()

/** An asset's picture at its version, decoded once. */
const pictureOf = (entry: Entry): Promise<HTMLImageElement | undefined> => decoded(store.picture(entry.id, entry.version))

/** An asset's normal map at its version, decoded once. */
const normalOf = (entry: Entry): Promise<HTMLImageElement | undefined> => decoded(store.normal(entry.id, entry.version))

const decoded = (url: string): Promise<HTMLImageElement | undefined> => {
  let found = pictures.get(url)
  if (found === undefined) {
    const image = new Image()
    image.src = url
    found = image.decode().then(
      () => image,
      () => undefined
    )
    pictures.set(url, found)
  }
  return found
}

let opening = 0
let addressTimer: ReturnType<typeof setTimeout> | undefined

/** The address names the asset open, once the person stops on one: Safari refuses more than 100 changes of it in 10 seconds, and an arrow key held down gets there. */
const showInAddress = (id: string): void => {
  if (addressTimer !== undefined) clearTimeout(addressTimer)
  addressTimer = setTimeout(() => window.history.replaceState(null, "", `#${encodeURIComponent(id)}`), 250)
}

/** Opens an asset. Nothing is owed first: the review is one file, saved whole. */
const open = async (id: string): Promise<void> => {
  const entry = entryOf(id)
  if (entry === undefined) return
  if (id === state.current) {
    if (state.view === "set") setView("asset")
    return
  }
  settleComposed()
  state.current = id
  state.view = "asset"
  state.animation = animationsOf(entry)[0]!.name
  state.frame = 0
  state.playing = true
  state.marks = undefined
  state.detail = undefined
  clock = performance.now()
  showInAddress(id)
  update()
  scrollToRow(id)
  void loadDetail(id)
}

const loadDetail = async (id: string): Promise<void> => {
  const ticket = ++opening
  const detail = await store.detail(id)
  if (ticket !== opening || id !== state.current) return
  state.detail = detail
  renderChecks()
}

const reviewShown = (): void => {
  renderTopbar()
  renderRail()
  renderHead()
  renderRings()
  if (state.view === "set") renderStage()
  renderReview()
  renderComments()
}

const load = async (): Promise<void> => {
  let listed = await store.library("")
  // A folder of thousands takes minutes to read: say how far it is, and look again.
  while (listed?.reading !== undefined) {
    state.reading = listed.reading
    renderRail()
    renderStage()
    await new Promise((next) => setTimeout(next, 500))
    listed = await store.library("")
  }
  state.reading = undefined
  if (listed?.entries === undefined) return say("The review server sent no art.")
  state.library = listed.entries
  state.libraryVersion = listed.version
  await readReview()
  state.loaded = true
  history.reset()
  history.schedule()
  const wanted = decodeURIComponent(location.hash.slice(1))
  const first = entryOf(wanted) ?? state.library[0]
  if (first === undefined) return update()
  await open(first.id)
}

const readReview = async (): Promise<void> => {
  try {
    const answer = await store.review()
    const review = decodeReview(answer.text)
    if (!review.ok) throw new Error(review.error)
    state.review = review.value
    state.base = review.value
    state.reviewVersion = answer.version
    state.reviewProblem = undefined
  } catch (error) {
    state.reviewProblem = error instanceof Error ? error.message : String(error)
    say(`The review cannot be read, so nothing is saved: ${state.reviewProblem}`)
  }
}

let following = false

const follow = async (): Promise<void> => {
  if (following) return
  following = true
  try {
    const listed = await store.library(state.libraryVersion)
    const online = listed !== undefined
    if (online !== state.online) {
      state.online = online
      renderTopbar()
      if (online && state.saving === "failed") void flush()
    }
    if (listed === undefined || listed.reading !== undefined) return
    if (listed.entries !== undefined) {
      const before = entryOf(state.current)?.version
      state.library = listed.entries
      state.libraryVersion = listed.version
      const now = entryOf(state.current)
      renderTopbar()
      renderRail()
      if (now === undefined) {
        if (state.current !== "") say("The asset open is gone: it was renamed or deleted.")
      } else if (now.version !== before) {
        // The agent rewrote the art open: draw it anew, and read its lint again.
        if (!animationsOf(now).some((animation) => animation.name === state.animation)) state.animation = animationsOf(now)[0]!.name
        renderStage()
        renderReview()
        renderLightPanel()
        void loadDetail(now.id)
      }
      if (state.view === "set") renderStage()
    }
    if (listed.review === state.reviewVersion || busy()) return
    const answer = await store.review()
    // The person may have changed something while it came.
    if (busy() || answer.version === state.reviewVersion) return
    const review = decodeReview(answer.text)
    if (!review.ok) return
    // An asset going away changes the version too, with nothing new to read on the ones still here.
    const onList = (of: Review): string => encodeReview(without(of, Object.keys(of.assets).filter((id) => entryOf(id) === undefined)))
    const news = onList(review.value) !== onList(state.review)
    state.review = review.value
    state.base = review.value
    state.reviewVersion = answer.version
    state.reviewProblem = undefined
    history.schedule()
    if (news) say("The review changed in its file (the agent's replies show on the comments).")
    reviewShown()
  } catch {
    // The CLI was stopped; the page keeps what it has.
  } finally {
    following = false
  }
}

// ---------------------------------------------------------------------------
// Drawing an asset

/** Empty space around the art, so a ring at its edge shows whole. */
const MARGIN = 10

const BUILT_IN: Readonly<Record<Exclude<Backdrop, "custom">, readonly [string, string]>> = {
  dark: ["#1a1c2c", "#1f2133"],
  light: ["#e8e4d8", "#dcd8cc"],
  checker: ["#3a3a44", "#5a5a66"]
}

/** A backdrop's two square colors: a built-in one, or the person's color with a faintly lighter or darker square, so the pixel size shows. */
const backdropColors = (): readonly [string, string] => {
  if (state.backdrop !== "custom") return BUILT_IN[state.backdrop]
  const rgb = parseHex(state.custom) ?? { r: 58, g: 68, b: 102 }
  const shift = (rgb.r + rgb.g + rgb.b) / 3 > 128 ? -10 : 10
  const nudge = (v: number): string => Math.max(0, Math.min(255, v + shift)).toString(16).padStart(2, "0")
  return [state.custom, `#${nudge(rgb.r)}${nudge(rgb.g)}${nudge(rgb.b)}`]
}

/** The frame shown now: its index in the sheet's frames, and its place in the animation (as the JSON lists it). */
const shown = (entry: Entry, now: number): { readonly global: number; readonly place: number } => {
  const animation = animationOf(entry)
  if (!state.playing || animation.play.length < 2) {
    const place = ((state.frame % animation.frames.length) + animation.frames.length) % animation.frames.length
    return { global: animation.frames[place]!, place }
  }
  const durations = animation.play.map((i) => entry.frames[i]?.duration ?? 100)
  const total = durations.reduce((sum, d) => sum + d, 0)
  let at = (now - clock) % Math.max(1, total)
  for (const [step, duration] of durations.entries()) {
    if (at < duration) {
      const global = animation.play[step]!
      return { global, place: animation.frames.indexOf(global) }
    }
    at -= duration
  }
  return { global: animation.play[0]!, place: 0 }
}

let clock = 0

/** How many times the frame is drawn across and down: three in the repeat view. */
const tiles = (): number => (state.repeat ? 3 : 1)

/** The largest zoom that keeps the canvas a size a browser draws. */
const maxZoom = (entry: Entry): number => Math.max(1, Math.min(32, Math.floor(4096 / (Math.max(1, ...entry.frames.map((frame) => Math.max(frame.w, frame.h))) * tiles()))))

/** Past this a small sprite gains nothing on screen: its pixels are already easy to see and to press. */
const FIT_MOST = 16

/** The zoom at which the asset's largest frame fits the stage without scrolling, once it is drawn there: the largest whole number, or for a picture too big at 1×, just what fits. */
const fitZoom = (entry: Entry): number => {
  const spot = content.querySelector(".pixel-screen")
  if (spot === null) return 1
  const box = spot.getBoundingClientRect()
  const room = content.getBoundingClientRect().bottom - box.top - content.scrollTop - parseFloat(getComputedStyle(content).paddingBottom)
  const across = Math.max(1, ...entry.frames.map((frame) => frame.w)) * tiles()
  const down = Math.max(1, ...entry.frames.map((frame) => frame.h)) * tiles()
  const fits = Math.min((box.width - MARGIN * 2) / across, (room - MARGIN * 2) / down)
  if (fits >= 1) return Math.min(FIT_MOST, maxZoom(entry), Math.floor(fits))
  return Math.max(0.01, Math.floor(fits * 100) / 100)
}

const zoomWords = (zoom: number): string => `${zoom >= 1 ? zoom : zoom.toFixed(2)}×`

/** The canvas's size in page pixels: the largest frame of the animation, at the zoom, with the margin around it. */
const screenOf = (entry: Entry): { readonly w: number; readonly h: number; readonly fw: number; readonly fh: number } => {
  const frames = animationOf(entry).frames.map((i) => entry.frames[i]!)
  const fw = Math.max(1, ...frames.map((frame) => frame.w))
  const fh = Math.max(1, ...frames.map((frame) => frame.h))
  return { w: Math.ceil(fw * state.zoom * tiles()) + MARGIN * 2, h: Math.ceil(fh * state.zoom * tiles()) + MARGIN * 2, fw, fh }
}

/** What the asset is drawn as now: art with no map has only itself. */
const lookOf = (entry: Entry): Look => (entry.normal === undefined ? "art" : state.look)

const pixelCache = new WeakMap<HTMLImageElement, Uint8ClampedArray>()

/** A picture's pixels, to light: read once. */
const pixelsOf = (image: HTMLImageElement): Uint8ClampedArray | undefined => {
  const known = pixelCache.get(image)
  if (known !== undefined) return known
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (context === null) return undefined
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  pixelCache.set(image, pixels)
  return pixels
}

const channel = (hex: string, at: number): number => Number.parseInt(hex.slice(at, at + 2), 16) || 0

/** The light as a frame this size takes it. */
const lightOn = (frame: { readonly w: number; readonly h: number }): Light => {
  const side = Math.max(frame.w, frame.h)
  const { x, y, height, reach, ambient, brightness, color, steps } = state.light
  return { x: x * frame.w, y: y * frame.h, height: height * side, reach: reach * side, ambient, brightness, steps, color: [channel(color, 1), channel(color, 3), channel(color, 5)] }
}

const litCanvas = document.createElement("canvas")

/** One frame under the light, on a canvas of its own size to draw from; `undefined` when the two pictures do not line up. */
const litFrame = (image: HTMLImageElement, normal: HTMLImageElement, frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, into: HTMLCanvasElement): HTMLCanvasElement | undefined => {
  if (image.naturalWidth !== normal.naturalWidth || image.naturalHeight !== normal.naturalHeight) return undefined
  const art = pixelsOf(image)
  const map = pixelsOf(normal)
  if (art === undefined || map === undefined || frame.w === 0 || frame.h === 0) return undefined
  if (into.width !== frame.w || into.height !== frame.h) {
    into.width = frame.w
    into.height = frame.h
  }
  const context = into.getContext("2d")
  if (context === null) return undefined
  const lit = context.createImageData(frame.w, frame.h)
  lightFrame(lit.data, art, map, image.naturalWidth, frame, lightOn(frame))
  context.putImageData(lit, 0, 0)
  return into
}

const paint = (canvas: HTMLCanvasElement, entry: Entry, image: HTMLImageElement, global: number): void => {
  const frame = entry.frames[global]
  const context = canvas.getContext("2d")
  if (frame === undefined || context === null) return
  const screen = screenOf(entry)
  const ratio = window.devicePixelRatio || 1
  const width = Math.round(screen.w * ratio)
  const height = Math.round(screen.h * ratio)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, screen.w, screen.h)
  const zoom = state.zoom
  // Whole zooms keep every pixel; a picture shrunk to fit has pixels to lose, and looks better blended.
  context.imageSmoothingEnabled = zoom < 1
  const [a, b] = backdropColors()
  const spanW = screen.fw * tiles()
  const spanH = screen.fh * tiles()
  // The backdrop is in squares of 4 art pixels, so the pixel size shows; shrunk, in squares that still show on screen.
  const square = zoom >= 1 ? 4 : Math.ceil(4 / zoom)
  for (let y = 0; y < spanH; y += square)
    for (let x = 0; x < spanW; x += square) {
      context.fillStyle = (x / square + y / square) % 2 === 0 ? a : b
      context.fillRect(MARGIN + x * zoom, MARGIN + y * zoom, Math.min(square, spanW - x) * zoom, Math.min(square, spanH - y) * zoom)
    }
  const look = lookOf(entry)
  const normal = holderNormal()
  const lit = look === "lit" && normal !== undefined ? litFrame(image, normal, frame, litCanvas) : undefined
  for (let ty = 0; ty < tiles(); ty++) {
    for (let tx = 0; tx < tiles(); tx++) {
      const left = MARGIN + tx * screen.fw * zoom
      const top = MARGIN + ty * screen.fh * zoom
      if (lit !== undefined) context.drawImage(lit, 0, 0, frame.w, frame.h, left, top, frame.w * zoom, frame.h * zoom)
      else context.drawImage(look === "normal" && normal !== undefined ? normal : image, frame.x, frame.y, frame.w, frame.h, left, top, frame.w * zoom, frame.h * zoom)
    }
  }
  if (state.repeat) {
    // The middle copy is the one comments are pinned to.
    context.strokeStyle = "rgba(255, 255, 255, 0.35)"
    context.setLineDash([4, 4])
    context.strokeRect(MARGIN + screen.fw * zoom + 0.5, MARGIN + screen.fh * zoom + 0.5, frame.w * zoom - 1, frame.h * zoom - 1)
    context.setLineDash([])
  }
}

/** The canvas of the asset open, its rings, and what it shows now. */
let screen: { readonly entry: Entry; readonly canvas: HTMLCanvasElement; readonly rings: HTMLElement; readonly lamp: HTMLElement; readonly counter: HTMLElement; image: HTMLImageElement | undefined; normal: HTMLImageElement | undefined; global: number; place: number } | undefined

const holderNormal = (): HTMLImageElement | undefined => screen?.normal

const tick = (now: number): void => {
  if (screen !== undefined && screen.image !== undefined && state.view === "asset") {
    const at = shown(screen.entry, now)
    if (state.orbit && lookOf(screen.entry) === "lit") {
      state.light.x = 0.5 + Math.cos(now / ORBIT_MS) * 0.5
      state.light.y = 0.5 + Math.sin(now / ORBIT_MS) * 0.5
      screen.global = at.global
      screen.place = at.place
      paint(screen.canvas, screen.entry, screen.image, at.global)
      renderLamp()
      renderCounter()
    } else if (at.global !== screen.global) {
      screen.global = at.global
      screen.place = at.place
      paint(screen.canvas, screen.entry, screen.image, at.global)
      renderRings()
      renderCounter()
    }
  }
  requestAnimationFrame(tick)
}

/** Repaints the asset open now (after a zoom, a backdrop, or a new picture). */
const repaint = (): void => {
  if (screen === undefined || screen.image === undefined) return
  const at = shown(screen.entry, performance.now())
  screen.global = at.global
  screen.place = at.place
  paint(screen.canvas, screen.entry, screen.image, at.global)
  renderRings()
  renderLamp()
  renderCounter()
}

/** How long the light takes to go round, over 2π. */
const ORBIT_MS = 700

/** Where the light is over the art, shown only while the art is lit: over the middle copy when it repeats. */
const renderLamp = (): void => {
  if (screen === undefined) return
  const on = lookOf(screen.entry) === "lit"
  screen.lamp.classList.toggle("on", on)
  if (!on) return
  const { fw, fh } = screenOf(screen.entry)
  const offsetX = state.repeat ? fw : 0
  const offsetY = state.repeat ? fh : 0
  screen.lamp.style.left = `${MARGIN + (offsetX + state.light.x * fw) * state.zoom}px`
  screen.lamp.style.top = `${MARGIN + (offsetY + state.light.y * fh) * state.zoom}px`
  screen.lamp.style.background = state.light.color
}

/** Dragging the light over the art: pressing anywhere else still pins a comment. */
const attachLamp = (lamp: HTMLElement, canvas: HTMLCanvasElement, entry: Entry): void => {
  const moveTo = (event: PointerEvent): void => {
    const box = canvas.getBoundingClientRect()
    const { fw, fh } = screenOf(entry)
    const offsetX = state.repeat ? fw : 0
    const offsetY = state.repeat ? fh : 0
    state.light.x = Math.max(0, Math.min(1, ((event.clientX - box.left - MARGIN) / state.zoom - offsetX) / fw))
    state.light.y = Math.max(0, Math.min(1, ((event.clientY - box.top - MARGIN) / state.zoom - offsetY) / fh))
    repaint()
  }
  lamp.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    event.stopPropagation()
    lamp.setPointerCapture(event.pointerId)
    if (state.orbit) {
      state.orbit = false
      renderLightPanel()
    }
    moveTo(event)
  })
  lamp.addEventListener("pointermove", (event) => {
    if (lamp.hasPointerCapture(event.pointerId)) moveTo(event)
  })
  const finish = (event: PointerEvent): void => {
    if (lamp.hasPointerCapture(event.pointerId)) lamp.releasePointerCapture(event.pointerId)
    remember()
  }
  lamp.addEventListener("pointerup", finish)
  lamp.addEventListener("pointercancel", finish)
}

/** Magenta: the debug color, in almost no game's palette, so a ring shows on any art. */
const ringStyle = (area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, entry: Entry): string => {
  const { fw, fh } = screenOf(entry)
  const offsetX = state.repeat ? fw : 0
  const offsetY = state.repeat ? fh : 0
  const zoom = state.zoom
  return `left:${MARGIN + (offsetX + area.x) * zoom - 3}px;top:${MARGIN + (offsetY + area.y) * zoom - 3}px;width:${area.width * zoom + 6}px;height:${area.height * zoom + 6}px`
}

/** The rings over the frame shown: its open comments (numbered), the one being drawn, and a lint issue's pixels. */
const renderRings = (): void => {
  if (screen === undefined) return
  const entry = screen.entry
  const animation = entry.animations.length > 0 ? animationOf(entry).name : undefined
  const place = screen.place
  const comments = reviewOf(entry.id).comments.flatMap((comment, index) =>
    comment.resolved !== true && comment.animation === animation && comment.frame === place ? [{ comment, number: index + 1 }] : []
  )
  const composing = state.composing !== undefined && state.composing.animation === animation && state.composing.frame === place ? state.composing : undefined
  const marks = state.marks !== undefined && state.marks.frame === screen.global ? state.marks.at : []
  replace(
    screen.rings,
    comments.map(({ comment, number }) =>
      h(
        "span",
        { class: "pixel-ring", title: comment.text, attrs: { "data-comment": number, style: ringStyle({ x: comment.x, y: comment.y, width: comment.width ?? 1, height: comment.height ?? 1 }, entry) } },
        h("span", { class: "pixel-ring-label" }, String(number))
      )
    ),
    composing !== undefined && h("span", { class: "pixel-ring drawing", attrs: { "data-comment": "new", style: ringStyle(composing, entry) } }, h("span", { class: "pixel-ring-label" }, "+")),
    marks.map(([x, y]) => h("span", { class: "pixel-ring mark", attrs: { style: ringStyle({ x, y, width: 1, height: 1 }, entry) } }))
  )
}

const renderCounter = (): void => {
  if (screen === undefined) return
  const entry = screen.entry
  if (entry.animations.length === 0) return replace(screen.counter, `${entry.width}×${entry.height}`)
  const animation = animationOf(entry)
  const frame = entry.frames[screen.global]
  // Frames count from 0, as comments and `pixel notes` count them.
  replace(screen.counter, h("span", { class: "pixel-counter-word" }, "frame "), `${screen.place} of ${animation.frames.length} · ${frame?.duration ?? 0} ms`)
}

/** The pixel of the frame under the pointer, in the middle copy's pixels when it repeats; `undefined` off the art. */
const pixelAt = (entry: Entry, canvas: HTMLCanvasElement, event: PointerEvent, clamp: boolean): { readonly x: number; readonly y: number } | undefined => {
  const box = canvas.getBoundingClientRect()
  const frame = entry.frames[screen?.global ?? 0]
  if (frame === undefined) return undefined
  const { fw, fh } = screenOf(entry)
  const zoom = state.zoom
  const across = (event.clientX - box.left - MARGIN) / zoom - (state.repeat ? fw : 0)
  const down = (event.clientY - box.top - MARGIN) / zoom - (state.repeat ? fh : 0)
  // In the repeat view, a pixel of any copy is the middle copy's.
  const x = state.repeat ? ((Math.floor(across) % fw) + fw) % fw : Math.floor(across)
  const y = state.repeat ? ((Math.floor(down) % fh) + fh) % fh : Math.floor(down)
  if (clamp) return { x: Math.max(0, Math.min(frame.w - 1, x)), y: Math.max(0, Math.min(frame.h - 1, y)) }
  if (x < 0 || y < 0 || x >= frame.w || y >= frame.h) return undefined
  if (state.repeat && (across < -fw || down < -fh || across >= 2 * fw || down >= 2 * fh)) return undefined
  return { x, y }
}

/** Drawing an area to comment on: press on a pixel, drag to another, let go. A press alone is one pixel. */
const attachPinning = (canvas: HTMLCanvasElement, entry: Entry): void => {
  let start: { readonly x: number; readonly y: number } | undefined
  const areaTo = (end: { readonly x: number; readonly y: number }): Area => {
    const from = start ?? end
    const animation = entry.animations.length > 0 ? animationOf(entry).name : undefined
    return { animation, frame: screen?.place ?? 0, x: Math.min(from.x, end.x), y: Math.min(from.y, end.y), width: Math.abs(end.x - from.x) + 1, height: Math.abs(end.y - from.y) + 1 }
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    const at = pixelAt(entry, canvas, event, false)
    if (at === undefined) return
    // Pause on the frame shown: the comment is about it.
    if (state.playing && screen !== undefined) {
      state.frame = screen.place
      state.playing = false
      renderPlayback()
    }
    start = at
    canvas.setPointerCapture(event.pointerId)
    state.composing = areaTo(at)
    state.marks = undefined
    renderRings()
  })
  canvas.addEventListener("pointermove", (event) => {
    if (start === undefined) return
    const at = pixelAt(entry, canvas, event, true)
    if (at === undefined) return
    state.composing = areaTo(at)
    renderRings()
  })
  const finish = (event: PointerEvent): void => {
    if (start === undefined) return
    const at = pixelAt(entry, canvas, event, true)
    if (at !== undefined) state.composing = areaTo(at)
    start = undefined
    renderRings()
    renderComments()
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".pixel-compose textarea")?.focus())
  }
  canvas.addEventListener("pointerup", finish)
  canvas.addEventListener("pointercancel", () => {
    start = undefined
  })
}

// ---------------------------------------------------------------------------
// The page

const app = document.getElementById("app")!
const topbar = h("header", { class: "topbar" })
const list = h("aside", { class: "sounds pixel-list", attrs: { "aria-label": "Assets" } })
const content = h("div", { class: "sound-view pixel-view" })
const playback = h("div", { class: "floating playback pixel-playback" })
const toast = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } })
const panels = h("aside", { class: "inspector", attrs: { "aria-label": "Review" } })
const stage = h("div", { class: "stage pixel-stage" }, content, playback, toast)

// Each section draws into its own box, so a change redraws only the section it is about.
const reviewBox = h("div", {})
const commentsBox = h("div", {})
const lightBox = h("div", {})
const checksBox = h("div", {})
const viewBox = h("div", {})
const aboutBox = h("div", {})
panels.append(reviewBox, commentsBox, lightBox, checksBox, viewBox, aboutBox)

app.append(topbar, h("main", { class: "layout lab" }, list, h("section", { class: "workspace" }, stage), panels))

export const statusLabel: Record<Status, string> = { new: "To review", approved: "Approved", changes: "Changes asked" }

const counted = (status: Status): number => state.library.filter((entry) => reviewOf(entry.id).status === status).length

/** The assets the list and the whole set show: the filter, the search, and in the set, the picked ones when asked. */
const visible = (): ReadonlyArray<Entry> => {
  const query = state.search.trim().toLowerCase()
  return state.library.filter((entry) => (state.show === "all" || reviewOf(entry.id).status === state.show) && (query === "" || entry.id.toLowerCase().includes(query)))
}

const setView = (view: View): void => {
  if (state.view === view) return
  settleComposed()
  state.view = view
  update()
}

const renderTopbar = (): void => {
  const total = state.library.length
  replace(
    topbar,
    h(
      "div",
      { class: "topbar-start" },
      h(
        "div",
        { class: "brand" },
        mark(),
        h("span", {}, "Pixel review"),
        h("a", { class: "by", title: "Ritmo, the agent-first type safe ECS runtime", attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "by ", h("b", {}, "ritmo"))
      ),
      state.loaded && h("div", { class: "file" }, h("span", { class: "file-name" }, `${total} asset${total === 1 ? "" : "s"}`), h("span", { class: "file-meta" }, `${counted("approved")} approved`))
    ),
    h(
      "div",
      { class: "topbar-center" },
      state.loaded &&
        segmented(
          state.show,
          [
            { id: "all", label: `All ${total}` },
            { id: "new", label: `To review ${counted("new")}` },
            { id: "changes", label: `Changes ${counted("changes")}` },
            { id: "approved", label: `Approved ${counted("approved")}` }
          ],
          (show) => {
            state.show = show
            renderRail()
            renderTopbar()
            if (state.view === "set") renderStage()
          },
          { label: "Show" }
        ),
      state.loaded &&
        segmented(
          state.view,
          [
            { id: "asset", label: "Asset", icon: "image", title: "One asset at a time, zoomed (V: the whole set)" },
            { id: "set", label: "Set", icon: "layers", title: "The whole set side by side at one scale, to judge it as one game (V: one asset)" }
          ],
          setView,
          { label: "View", class: "pixel-views" }
        )
    ),
    h(
      "div",
      { class: "topbar-end" },
      h(
        "div",
        { class: "button-group" },
        button("Undo", () => history.undo(), { variant: "ghost", icon: "undo", iconOnly: true, disabled: !history.canUndo(), title: "Undo (Ctrl/Cmd+Z)" }),
        button("Redo", () => history.redo(), { variant: "ghost", icon: "redo", iconOnly: true, disabled: !history.canRedo(), title: "Redo (Ctrl/Cmd+Shift+Z)" })
      ),
      h("span", { class: "divider" }),
      h(
        "span",
        {
          class: `save-state ${state.online ? state.saving : "failed"}`,
          title: state.online ? "What you say is written to pixel.review.json as you go" : SERVER_GONE,
          attrs: { "data-saving": state.online ? state.saving : "offline" }
        },
        state.online && state.saving === "saved" ? icon("check") : state.saving === "failed" || !state.online ? icon("alert") : null,
        !state.online ? (dirty || state.saving === "failed" ? "Not saved: server stopped" : "Server stopped") : state.saving === "saved" ? "Saved" : state.saving === "saving" ? "Saving…" : "Not saved"
      )
    )
  )
}

const rows = h("div", { class: "sound-rows pixel-rows", attrs: { role: "listbox", "aria-label": "Assets" } })

const search = h("input", {
  props: { type: "search" },
  attrs: { placeholder: "Find an asset", "aria-label": "Find an asset", spellcheck: "false" },
  on: {
    input: (event) => {
      const target = event.currentTarget
      if (!(target instanceof HTMLInputElement)) return
      state.search = target.value
      renderRail()
      if (state.view === "set") renderStage()
    }
  }
})

replace(list, h("div", { class: "sounds-head" }, h("label", { class: "input search" }, icon("search"), search)), rows)

const statusDot = (status: Status): HTMLElement => h("span", { class: `dot ${status}`, title: statusLabel[status] })

/** The little flags on a row: why it cannot be read, a change since it was approved, its lint, its open comments. */
const flags = (entry: Entry): Array<HTMLElement | false> => {
  const changed = changedNow(entry)
  const comments = openComments(entry.id)
  return [
    entry.problem !== undefined && h("span", { class: "sound-flag bad", title: entry.problem, attrs: { "data-flag": "problem" } }, icon("alert")),
    changed !== undefined && h("span", { class: "sound-flag warn", title: `Changed since you approved it: ${changed}.`, attrs: { "data-flag": "changed" } }, icon("sparkle")),
    entry.problem === undefined &&
      entry.errors + entry.warnings > 0 &&
      h("span", { class: `sound-flag ${entry.errors > 0 ? "bad" : "warn"} lint`, title: `${entry.errors} lint error${entry.errors === 1 ? "" : "s"}, ${entry.warnings} warning${entry.warnings === 1 ? "" : "s"}`, attrs: { "data-flag": "lint" } }, icon("info")),
    entry.normal !== undefined && h("span", { class: "sound-flag", title: "It has a normal map: L shows it under the light", attrs: { "data-flag": "normal" } }, icon("light")),
    comments > 0 && h("span", { class: "sound-takes", title: `${comments} open comment${comments === 1 ? "" : "s"}`, attrs: { "data-flag": "comments" } }, String(comments))
  ]
}

const readingWords = (): string => (state.reading === undefined ? "Reading the art…" : `Reading the art… ${state.reading.done} of ${state.reading.total}`)

const renderRail = (): void => {
  const scroll = rows.scrollTop
  const entries = visible()
  const folders = new Set(state.library.map((entry) => entry.folder))
  let folder: string | undefined
  replace(
    rows,
    entries.length === 0 && h("p", { class: "hint empty-list" }, state.loaded ? "Nothing here." : readingWords()),
    entries.flatMap((entry) => {
      const heading = folders.size > 1 && entry.folder !== folder ? h("h3", { class: "pixel-folder", title: entry.folder }, entry.folder) : false
      folder = entry.folder
      const on = entry.id === state.current
      return [
        heading,
        h(
          "div",
          {
            class: `sound-row${on ? " on" : ""}`,
            title: entry.id,
            attrs: { role: "option", "aria-selected": String(on), "data-asset": entry.id, tabindex: 0 },
            on: {
              click: () => void open(entry.id),
              keydown: (event) => {
                if (event.key === "Enter") void open(entry.id)
              }
            }
          },
          statusDot(reviewOf(entry.id).status),
          h("span", { class: "sound-name" }, entry.name),
          flags(entry)
        )
      ]
    })
  )
  rows.scrollTop = scroll
}

/** Only the list scrolls to the asset: on a phone the page around it stays put. */
const scrollToRow = (id: string): void => {
  const row = rows.querySelector(`[data-asset="${CSS.escape(id)}"]`)
  if (!(row instanceof HTMLElement)) return
  if (row.offsetTop < rows.scrollTop) rows.scrollTop = row.offsetTop - 24
  else if (row.offsetTop + row.offsetHeight > rows.scrollTop + rows.clientHeight) rows.scrollTop = row.offsetTop + row.offsetHeight - rows.clientHeight
}

const step = (by: number): void => {
  const entries = visible()
  if (entries.length === 0) return
  const at = entries.findIndex((entry) => entry.id === state.current)
  void open(entries[(at + by + entries.length) % entries.length]!.id)
}

const pill = (text: string, tone = ""): HTMLElement => h("span", { class: `stage-pill ${tone}` }, text)

const head = h("div", { class: "sound-head" })

const renderHead = (): void => {
  const entry = entryOf(state.current)
  if (state.view !== "asset" || entry === undefined) return replace(head)
  const said = reviewOf(entry.id)
  const changed = changedNow(entry)
  const frame = entry.frames[0]
  replace(
    head,
    h(
      "div",
      { class: "sound-title" },
      h("h1", { title: entry.id }, entry.name),
      pill(statusLabel[said.status], said.status),
      changed !== undefined && h("span", { class: "stage-pill changes", title: changed }, "Changed since"),
      entry.problem === undefined &&
        (entry.kind === "sheet"
          ? pill(`${entry.animations.length} animation${entry.animations.length === 1 ? "" : "s"} · ${entry.frames.length} frames · ${frame?.w ?? 0}×${frame?.h ?? 0}`)
          : pill(`${entry.width}×${entry.height}`))
    ),
    h("p", { class: "sound-about pixel-path" }, entry.folder === "." ? entry.id : `${entry.folder}/`, entry.source !== undefined && h("span", { class: "pixel-source" }, ` · made from ${entry.source}`))
  )
}

let fitting = false

const renderStage = (): void => {
  screen = undefined
  if (state.view === "set") return renderSet()
  const entry = entryOf(state.current)
  if (entry === undefined) {
    replace(content, h("div", { class: "empty-card lab-empty" }, h("div", { class: "empty-icon" }, mark()), h("h2", {}, state.loaded ? "No art here" : readingWords())))
    renderPlayback()
    return
  }
  renderHead()
  if (entry.problem !== undefined) {
    replace(content, head, callout("bad", `This asset cannot be read: ${entry.problem}`), hint("Fix it, and it shows here as soon as it reads. The rest of the review goes on."))
    renderPlayback()
    return
  }
  // A zoom kept from a smaller asset may be more than a browser draws at this one's size.
  state.zoom = Math.min(state.zoom, maxZoom(entry))
  const size = screenOf(entry)
  const canvas = h("canvas", {
    class: "pixel-canvas",
    title: "Press on a pixel, or drag across an area, to comment on it (it pauses there)",
    attrs: { "aria-label": `${entry.name} at ${zoomWords(state.zoom)}`, style: `width:${size.w}px;height:${size.h}px` }
  })
  const rings = h("div", { class: "pixel-rings", attrs: { "aria-hidden": "true" } })
  const lamp = h("span", { class: "pixel-lamp", title: "The light: drag it", attrs: { role: "button", "aria-label": "The light: drag it" } })
  const counter = h("span", { class: "frame-counter pixel-counter" })
  screen = { entry, canvas, rings, lamp, counter, image: undefined, normal: undefined, global: -1, place: 0 }
  attachPinning(canvas, entry)
  attachLamp(lamp, canvas, entry)
  const holder = screen
  void pictureOf(entry).then((image) => {
    if (screen !== holder) return
    if (image === undefined) return say(`${entry.name}: the picture did not load. It may have changed: it shows again on the next look.`)
    holder.image = image
    repaint()
  })
  if (entry.normal !== undefined) {
    void normalOf(entry).then((normal) => {
      if (screen !== holder) return
      holder.normal = normal
      repaint()
    })
  }
  const animations = animationsOf(entry)
  replace(
    content,
    head,
    entry.animations.length > 1 &&
      h(
        "div",
        { class: "pixel-animations", attrs: { role: "group", "aria-label": "Animation" } },
        animations.map((animation) =>
          h(
            "button",
            {
              class: `pixel-animation${animation.name === animationOf(entry).name ? " on" : ""}`,
              attrs: { type: "button", "aria-pressed": String(animation.name === animationOf(entry).name) },
              on: {
                click: () => {
                  settleComposed()
                  state.animation = animation.name
                  state.frame = 0
                  clock = performance.now()
                  state.marks = undefined
                  renderStage()
                  renderComments()
                }
              }
            },
            animation.name,
            h("span", { class: "meta" }, String(animation.frames.length))
          )
        )
      ),
    h("div", { class: "pixel-screen" }, h("div", { class: "pixel-frame", attrs: { style: `width:${size.w}px;height:${size.h}px` } }, canvas, rings, lamp))
  )
  // The room left depends on what is drawn above the art, so it is measured here, and drawn once more at what it says.
  if (state.fit && !fitting && fitZoom(entry) !== state.zoom) {
    state.zoom = fitZoom(entry)
    fitting = true
    renderStage()
    fitting = false
    return
  }
  renderLamp()
  renderPlayback()
}

// ---------------------------------------------------------------------------
// The whole set side by side

/** The size a typical asset of the set is shown at when it opens: a 16 px sprite at 6×, a 32 px one at 3×. */
const SET_TYPICAL = 96
/** A column holds such a sprite and the tile's padding. */
const SET_COLUMN = 112
const SET_GAP = 10
/** Rows this fine let tiles of any height interlock, and still line up. */
const SET_ROW = 16
const SET_PADDING = 8
/** A tile's foot and its padding, under the art. */
const SET_FOOT = 42
/** The room a tile's art has at the set's own zoom: enough to see it, so one big picture does not push the rest out of view. */
const SET_TALL = 192
const SET_ACROSS = 3

/** The zoom the set's art asks for: its median asset at about `SET_TYPICAL`. One outlier does not move it. */
const fitSetZoom = (): number => {
  const sides = state.library.flatMap((entry) => {
    const frame = entry.frames[0]
    return frame === undefined ? [] : [Math.max(frame.w, frame.h)]
  })
  const median = [...sides].sort((a, b) => a - b)[sides.length >> 1] ?? SET_TYPICAL
  return Math.max(1, Math.min(8, Math.round(SET_TYPICAL / median)))
}

/** The grid's columns in the room the stage has now. */
const setColumns = (): { readonly count: number; readonly width: number } => {
  const style = getComputedStyle(content)
  const room = Math.min(980, content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) - 24
  const count = Math.max(2, Math.floor((room + SET_GAP) / (SET_COLUMN + SET_GAP)))
  return { count, width: (room - SET_GAP * (count - 1)) / count }
}

let setColumnsDrawn = 0

/** The tiles drawn under the light: all redrawn when it moves, so the set stays under one light. */
let setLit: ReadonlyArray<{ readonly canvas: HTMLCanvasElement; readonly entry: Entry; readonly frame: Entry["frames"][number] }> = []

const paintSetTile = async (tile: (typeof setLit)[number]): Promise<void> => {
  const [image, normal] = await Promise.all([pictureOf(tile.entry), normalOf(tile.entry)])
  if (image !== undefined && normal !== undefined) litFrame(image, normal, tile.frame, tile.canvas)
}

const repaintSet = (): void => {
  for (const tile of setLit) void paintSetTile(tile)
}

const renderSet = (): void => {
  if (state.setFit) state.setZoom = fitSetZoom()
  renderPlayback()
  const zoom = state.setZoom
  const columns = setColumns()
  setColumnsDrawn = columns.count
  const spanned = (count: number): number => count * columns.width + (count - 1) * SET_GAP
  const wholeWidth = spanned(columns.count) - SET_PADDING * 2
  // A zoom the person picked past the set's own gives the art room to grow with it; 1× they picked is the art's own size, as far as the grid is wide.
  const asItIs = !state.setFit && zoom === 1
  const grown = Math.max(1, zoom / fitSetZoom())
  const mostAcross = asItIs ? wholeWidth : Math.min(wholeWidth, (spanned(Math.min(SET_ACROSS, columns.count)) - SET_PADDING * 2) * grown)
  const mostDown = asItIs ? Number.POSITIVE_INFINITY : SET_TALL * grown
  /** The set's zoom where the art fits; else the largest whole zoom that does, so its pixels stay even; and only a picture too big at 1× goes under it. */
  const scaleOf = (frame: { readonly w: number; readonly h: number }): number => {
    const fits = Math.min(mostAcross / frame.w, mostDown / frame.h)
    return fits >= zoom ? zoom : fits >= 1 ? Math.floor(fits) : fits
  }
  const entries = visible().filter((entry) => !state.onlyPicked || state.picked.has(entry.id))
  const [a] = backdropColors()
  const folders = new Set(entries.map((entry) => entry.folder))
  const byFolder = new Map<string, Array<Entry>>()
  for (const entry of entries) byFolder.set(entry.folder, [...(byFolder.get(entry.folder) ?? []), entry])
  const picked = [...state.picked].filter((id) => entryOf(id) !== undefined)
  const lit: Array<(typeof setLit)[number]> = []
  const tile = (entry: Entry): HTMLElement => {
    const frame = entry.frames[animationsOf(entry)[0]!.frames[0] ?? 0]
    const isPicked = state.picked.has(entry.id)
    const scale = frame === undefined ? zoom : scaleOf(frame)
    const artWidth = (frame?.w ?? 24) * scale
    const artHeight = (frame?.h ?? 24) * scale
    const across = Math.max(1, Math.min(columns.count, Math.ceil((artWidth + SET_PADDING * 2 + SET_GAP) / (columns.width + SET_GAP))))
    const down = Math.ceil((Math.max(artHeight, 64) + SET_FOOT + SET_GAP) / SET_ROW)
    const art =
      entry.problem !== undefined || frame === undefined
        ? h("div", { class: "pixel-set-broken", title: entry.problem }, icon("alert"))
        : h(
            "div",
            { class: `pixel-set-art${scale < 1 ? " shrunk" : ""}`, attrs: { style: `width:${artWidth}px;height:${artHeight}px` } },
            lookOf(entry) === "lit"
              ? (() => {
                  const canvas = h("canvas", { class: "pixel-set-lit", attrs: { width: frame.w, height: frame.h, "aria-label": entry.name, style: `width:${artWidth}px;height:${artHeight}px` } })
                  lit.push({ canvas, entry, frame })
                  return canvas
                })()
              : h("img", {
              attrs: {
                src: lookOf(entry) === "normal" ? store.normal(entry.id, entry.version) : store.picture(entry.id, entry.version),
                alt: entry.name,
                loading: "lazy",
                decoding: "async",
                width: Math.round(entry.width * scale),
                height: Math.round(entry.height * scale),
                style: `width:${entry.width * scale}px;height:${entry.height * scale}px;margin-left:${-frame.x * scale}px;margin-top:${-frame.y * scale}px`
              }
            })
          )
    return h(
      "div",
      {
        class: `pixel-set-tile${entry.id === state.current ? " on" : ""}${isPicked ? " picked" : ""}`,
        title: `${entry.id} · ${frame?.w ?? 0}×${frame?.h ?? 0}`,
        attrs: { "data-asset": entry.id, style: `grid-column:span ${across};grid-row:span ${down}` }
      },
      h(
        "button",
        {
          class: "pixel-set-open",
          title: `Open ${entry.name}`,
          attrs: { type: "button" },
          on: { click: () => void open(entry.id) }
        },
        art
      ),
      // Not at the set's scale: said on the tile, so its size is not read against the rest.
      frame !== undefined && scale !== zoom && h("span", { class: "pixel-set-scale", title: "Too big for the grid at the set's scale" }, `${scale >= 1 ? scale : scale.toFixed(2)}×`),
      h(
        "button",
        {
          class: `pixel-pick${isPicked ? " on" : ""}`,
          title: isPicked ? "Unpick" : "Pick, to compare or approve with others",
          attrs: { type: "button", "aria-pressed": String(isPicked), "aria-label": `Pick ${entry.name}` },
          on: {
            click: () => {
              if (isPicked) state.picked.delete(entry.id)
              else state.picked.add(entry.id)
              if (state.picked.size === 0) state.onlyPicked = false
              renderStage()
            }
          }
        },
        icon("check")
      ),
      h("div", { class: "pixel-set-foot" }, statusDot(reviewOf(entry.id).status), h("span", { class: "pixel-set-name" }, entry.name), flags(entry))
    )
  }
  replace(
    content,
    h(
      "div",
      { class: "sound-head" },
      h("div", { class: "sound-title" }, h("h1", {}, "The whole set"), pill(`${entries.length} shown`), pill(`${zoom}×`)),
      h("p", { class: "sound-about" }, "Every asset at one scale, over one backdrop: does it read as one game? A picture too big for the grid is smaller and says its zoom. Pick some to compare or approve them together.")
    ),
    // Always here, so picking the first asset moves nothing on the page.
    h(
        "div",
        { class: "pixel-picked" },
        h("span", {}, picked.length === 0 ? "None picked" : `${picked.length} picked`),
        button(state.onlyPicked ? "Show all" : "Compare them", () => {
          state.onlyPicked = !state.onlyPicked
          renderStage()
        }, { small: true, variant: "secondary", disabled: picked.length === 0, title: "Only the picked ones, side by side" }),
        button("Approve them", () => {
          for (const id of picked) {
            const entry = entryOf(id)
            if (entry !== undefined && entry.problem === undefined) setStatus(entry, "approved")
          }
          reviewChanged()
          say(`Approved ${picked.length}: they look right as they are now.`)
        }, { small: true, variant: "primary", icon: "check", disabled: picked.length === 0 }),
        button("Clear", () => {
          state.picked.clear()
          state.onlyPicked = false
          renderStage()
        }, { small: true, variant: "ghost", disabled: picked.length === 0 })
      ),
    entries.length === 0 && h("p", { class: "hint" }, "Nothing here."),
    [...byFolder.entries()].map(([folder, inside]) =>
      h("section", { class: "pixel-set-folder" }, folders.size > 1 && h("h3", { class: "pixel-folder" }, folder), h("div", { class: "pixel-set", attrs: { style: `--backdrop:${a};--set-columns:${columns.count}` } }, inside.map(tile)))
    )
  )
  setLit = lit
  repaintSet()
}

// ---------------------------------------------------------------------------
// The playback bar: frames, and the zoom

const setZoom = (zoom: number): void => {
  if (state.view === "set") {
    state.setFit = false
    state.setZoom = Math.max(1, Math.min(8, zoom))
    return renderStage()
  }
  const entry = entryOf(state.current)
  state.fit = false
  state.zoom = Math.max(1, Math.min(entry === undefined ? 32 : maxZoom(entry), zoom))
  renderStage()
}

/** One step: whole zooms up and down; under 1×, only the fit a picture too big for the stage has. */
const zoomBy = (by: 1 | -1): void => {
  const zoom = state.view === "set" ? state.setZoom : state.zoom
  const entry = entryOf(state.current)
  if (by < 0 && zoom <= 1) {
    if (state.view === "asset" && entry !== undefined && entry.problem === undefined && fitZoom(entry) < zoom) fitAgain()
    return
  }
  setZoom(by > 0 ? Math.floor(zoom) + 1 : Math.ceil(zoom) - 1)
}

/** Back to the zoom that fits: each asset's, or the whole set's. */
const fitAgain = (): void => {
  if (state.view === "set") state.setFit = true
  else state.fit = true
  renderStage()
}

const toggle = (): void => {
  const entry = entryOf(state.current)
  if (entry === undefined || entry.animations.length === 0 || state.view !== "asset") return
  if (state.playing) state.frame = screen?.place ?? 0
  else clock = performance.now()
  state.playing = !state.playing
  renderPlayback()
}

const stepFrame = (by: number): void => {
  const entry = entryOf(state.current)
  if (entry === undefined || entry.animations.length === 0) return
  if (state.playing) {
    state.frame = screen?.place ?? 0
    state.playing = false
  }
  state.frame += by
  renderPlayback()
  repaint()
}

const renderPlayback = (): void => {
  const entry = entryOf(state.current)
  const sheet = state.view === "asset" && entry !== undefined && entry.problem === undefined && entry.animations.length > 0
  const zoom = state.view === "set" ? state.setZoom : state.zoom
  const top = state.view === "set" ? 8 : entry === undefined ? 32 : maxZoom(entry)
  const least = state.view === "asset" && entry !== undefined && entry.problem === undefined ? Math.min(1, fitZoom(entry)) : 1
  replace(
    playback,
    sheet && [
      button(state.playing ? "Pause" : "Play", () => toggle(), { variant: "ghost", icon: state.playing ? "pause" : "play", iconOnly: true, title: state.playing ? "Pause (Space)" : "Play (Space)" }),
      button("Previous frame", () => stepFrame(-1), { variant: "ghost", icon: "previous", iconOnly: true, title: "Previous frame (←)" }),
      button("Next frame", () => stepFrame(1), { variant: "ghost", icon: "next", iconOnly: true, title: "Next frame (→)" }),
      screen?.counter,
      h("span", { class: "divider" })
    ],
    state.view === "asset" && entry !== undefined && entry.animations.length === 0 && screen?.counter,
    state.view === "asset" && entry !== undefined && entry.animations.length === 0 && h("span", { class: "divider" }),
    button("Zoom out", () => zoomBy(-1), { variant: "ghost", icon: "minus", iconOnly: true, disabled: zoom <= least, title: "Zoom out (−)" }),
    h("span", { class: "zoom-value", attrs: { "aria-label": "Zoom" } }, zoomWords(zoom)),
    button("Zoom in", () => zoomBy(1), { variant: "ghost", icon: "plus", iconOnly: true, disabled: zoom >= top, title: "Zoom in (+)" }),
    button("1×", () => setZoom(1), { variant: "ghost", small: true, disabled: zoom === 1 && !(state.view === "set" ? state.setFit : state.fit), title: "Its own size (0)" }),
    button("Fit", fitAgain, { variant: "ghost", small: true, disabled: state.view === "set" ? state.setFit : state.fit, title: "As large as fits (F)" }),
    h("span", { class: "divider" }),
    lookControl(entry)
  )
  renderCounter()
}

/** Whether what is on screen has a normal map to show: the asset open, or any of the set. */
const hasMapShown = (entry: Entry | undefined): boolean => (state.view === "set" ? state.library.some((other) => other.normal !== undefined) : entry?.normal !== undefined)

/** Art, Lit, Normal: always in its place, and greyed where there is no map to show. */
const lookControl = (entry: Entry | undefined): HTMLElement => {
  const off = !hasMapShown(entry)
  const none = "No normal map beside this: `ritmo-tools pixel normals` makes one"
  return segmented(
    off ? "art" : state.look,
    [
      { id: "art", label: "Art", title: "The art as drawn" },
      { id: "lit", label: "Lit", disabled: off, title: off ? none : "Under the light (L): drag it over the art" },
      { id: "normal", label: "Normal", disabled: off, title: off ? none : "The normal map itself (N)" }
    ],
    setLook,
    { label: "Look", class: "pixel-looks" }
  )
}

const setLook = (look: Look): void => {
  state.look = look
  remember()
  renderStage()
  renderLightPanel()
}

/** Goes to a look, or back to the art from it; nothing when there is no map to show. */
const toggleLook = (look: Look): void => {
  if (hasMapShown(entryOf(state.current))) setLook(state.look === look ? "art" : look)
}

// ---------------------------------------------------------------------------
// Panels

const statusOptions: ReadonlyArray<{ readonly id: Status; readonly label: string; readonly icon: "sparkle" | "check" | "alert"; readonly title: string }> = [
  { id: "new", label: "To review", icon: "sparkle", title: "Not reviewed yet" },
  { id: "approved", label: "Approved", icon: "check", title: "It looks right, as it is now" },
  { id: "changes", label: "Changes", icon: "alert", title: "Ask the agent for changes: say what in the note and pin comments to the pixels" }
]

/** Redraws a box, keeping the text being typed in it focused, with its caret. */
const redraw = (box: HTMLElement, ...children: Array<Node | false | undefined>): void => {
  const typing = document.activeElement instanceof HTMLTextAreaElement && box.contains(document.activeElement) ? document.activeElement : undefined
  const label = typing?.getAttribute("aria-label")
  const caret = typing?.selectionStart ?? 0
  replace(box, ...children)
  if (label == null) return
  const again = box.querySelector(`textarea[aria-label="${label}"]`)
  if (again instanceof HTMLTextAreaElement) {
    again.focus()
    again.setSelectionRange(caret, caret)
  }
}

const panelsShown = (): boolean => state.loaded && state.view === "asset" && entryOf(state.current) !== undefined

const renderReview = (): void => {
  const entry = entryOf(state.current)
  if (!panelsShown() || entry === undefined) return redraw(reviewBox, state.view === "set" && setPanel())
  const id = entry.id
  const said = reviewOf(id)
  const changed = changedNow(entry)
  redraw(
    reviewBox,
    section(
      {
        id: "pixel-review",
        title: "Review",
        help: "Approve what looks right as it is, or ask for changes: say what in the note, and pin comments to the pixels they are about. The agent reads it all with `ritmo-tools pixel notes`. Approving here is not the last word: the art still has to look right in the game, at the size it is drawn.",
        onToggle: renderReview
      },
      segmented(
        said.status,
        statusOptions,
        (status) => {
          if (status === reviewOf(id).status) return
          setStatus(entry, status)
          reviewChanged()
        },
        { label: "Status", class: "fill" }
      ),
      changed !== undefined &&
        callout(
          "warn",
          `Changed since you approved it: ${changed}.`,
          h(
            "div",
            { class: "approve-again" },
            button("Approve it as it is now", () => {
              setReview(id, { approved: approvalOf(entry.frames, entry.normal) })
              reviewChanged()
            })
          )
        ),
      state.reviewProblem !== undefined && callout("bad", `The review file cannot be read, so nothing here is saved: ${state.reviewProblem}`),
      h(
        "label",
        { class: "input note" },
        h("textarea", {
          props: { value: said.note, rows: 3 },
          attrs: { placeholder: said.status === "changes" ? "What should change? Pin comments to the pixels too." : "A note for the agent (optional)", "aria-label": "Note" },
          on: {
            input: (event) => {
              const target = event.currentTarget
              if (!(target instanceof HTMLTextAreaElement)) return
              // The note is this asset's, whatever is open when it saves.
              setReview(id, { note: target.value })
              save()
              history.schedule()
              renderTopbar()
            }
          }
        })
      )
    )
  )
}

/** Shows a comment's frame, paused, with its area ringed. */
const goTo = (entry: Entry, comment: Comment): void => {
  if (comment.animation !== undefined && entry.animations.some((animation) => animation.name === comment.animation)) state.animation = comment.animation
  state.playing = false
  state.frame = comment.frame
  state.marks = undefined
  if (state.view !== "asset") state.view = "asset"
  renderStage()
  repaint()
}

const areaWords = (area: Area): string => whereOf({ ...area, text: "" })

const renderComments = (): void => {
  const entry = entryOf(state.current)
  if (!panelsShown() || entry === undefined) return redraw(commentsBox)
  const id = entry.id
  const comments = reviewOf(id).comments
  const open = comments.filter((comment) => comment.resolved !== true).length
  const composing = state.composing
  const setComment = (index: number, change: Partial<Comment>): void => {
    setReview(id, { comments: reviewOf(id).comments.map((comment, i) => (i === index ? { ...comment, ...change } : comment)) })
    reviewChanged()
  }
  const add = (): void => {
    if (state.composingText.trim() !== "" || state.composingFacing !== undefined) addComposed()
  }
  redraw(
    commentsBox,
    section(
      {
        id: "pixel-comments",
        title: "Comments",
        help: "Press on a pixel, or drag across an area, to pin a comment to it on the frame shown (a sheet pauses there). The agent sees each comment numbered, with its frame and pixels, and resolves it with a reply once it has acted.",
        onToggle: renderComments,
        action: h("span", { class: "meta" }, comments.length === 0 ? "" : `${open} open`)
      },
      composing !== undefined &&
        h(
          "div",
          { class: "fx-compose pixel-compose" },
          h("p", { class: "hint" }, `On ${areaWords(composing)}`),
          entry.normal !== undefined && facingPicker(),
          h(
            "label",
            { class: "input note" },
            h("textarea", {
              props: { rows: 2, value: state.composingText },
              attrs: { placeholder: entry.normal !== undefined ? "What should change here? (optional with a direction)" : "What should change here? (\"outline too thick\", \"reads as a smudge at 1×\")", "aria-label": "Comment" },
              on: {
                input: (event) => {
                  if (event.currentTarget instanceof HTMLTextAreaElement) state.composingText = event.currentTarget.value
                },
                keydown: (event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) add()
                  if (event.key === "Escape") {
                    dropComposed()
                    renderComments()
                    renderRings()
                  }
                }
              }
            })
          ),
          h(
            "div",
            { class: "fx-compose-actions" },
            button("Cancel", () => {
              dropComposed()
              renderComments()
              renderRings()
            }, { small: true, variant: "ghost" }),
            button("Add comment", add, { small: true, variant: "primary", icon: "comment" })
          )
        ),
      comments.length === 0 && composing === undefined
        ? hint(entry.problem === undefined ? "Press on a pixel, or drag across an area, to pin a comment to it: the agent sees the spot ringed." : "This asset cannot be drawn, so there is nothing to pin a comment to: say it in the note.")
        : h(
            "ol",
            { class: "fx-comments" },
            comments.map((comment, index) =>
              h(
                "li",
                { class: comment.resolved === true ? "resolved" : "", attrs: { "data-comment": index + 1 } },
                h(
                  "button",
                  { class: "fx-comment", title: "Show this frame, with the area ringed", attrs: { type: "button" }, on: { click: () => goTo(entry, comment) } },
                  h("span", { class: "fx-comment-number" }, comment.resolved === true ? icon("check") : String(index + 1)),
                  h("span", { class: "fx-comment-where" }, `${whereOf(comment)}${comment.facing === undefined ? "" : ` · faces ${comment.facing}`}${comment.resolved === true ? " · resolved" : ""}`),
                  h("span", { class: "fx-comment-text" }, comment.text),
                  comment.resolved === true && comment.reply !== undefined && h("span", { class: "fx-comment-reply" }, `Agent: ${comment.reply}`)
                ),
                comment.resolved === true && button("Reopen", () => setComment(index, { resolved: undefined, reply: undefined }), { small: true, variant: "ghost", title: "It is not done: the agent sees it again in `pixel notes`" }),
                button("Delete", () => {
                  setReview(id, { comments: reviewOf(id).comments.filter((_, i) => i !== index) })
                  reviewChanged()
                }, { small: true, variant: "ghost", icon: "trash", iconOnly: true, title: "Delete this comment" })
              )
            )
          )
    )
  )
}

const FACING_ARROWS: Readonly<Record<Facing, string>> = { "up-left": "↖", up: "↑", "up-right": "↗", left: "←", front: "•", right: "→", "down-left": "↙", down: "↓", "down-right": "↘" }

/** Which way the surface here should face: nine buttons laid out as the directions they name. */
const facingPicker = (): HTMLElement =>
  h(
    "div",
    { class: "pixel-facing-row" },
    h(
      "div",
      { class: "pixel-facing", attrs: { role: "group", "aria-label": "Should face" } },
      facings.map((facing) =>
        h(
          "button",
          {
            class: state.composingFacing === facing ? "on" : "",
            title: facing === "front" ? "Faces the viewer" : `Faces ${facing}`,
            attrs: { type: "button", "aria-pressed": String(state.composingFacing === facing), "aria-label": `Faces ${facing}`, "data-facing": facing },
            on: {
              click: () => {
                state.composingFacing = state.composingFacing === facing ? undefined : facing
                renderComments()
              }
            }
          },
          FACING_ARROWS[facing]
        )
      )
    ),
    h("p", { class: "hint" }, state.composingFacing === undefined ? "Which way it should face, if the map has it wrong." : state.composingFacing === "front" ? "Should face the viewer." : `Should face ${state.composingFacing}.`)
  )

const renderLightPanel = (): void => {
  if (!state.loaded) return redraw(lightBox)
  const entry = entryOf(state.current)
  const hasMap = hasMapShown(entry)
  const on = hasMap && state.look === "lit"
  const moved = (): void => {
    if (state.view === "set") repaintSet()
    else repaint()
  }
  const set = (change: Partial<typeof state.light>): void => {
    state.light = { ...state.light, ...change }
    moved()
  }
  redraw(
    lightBox,
    section(
      {
        id: "pixel-light",
        title: "Light",
        help: "A plain point light to judge the normal map's shape by, made by `ritmo-tools pixel normals`: does each surface catch the light from the side it faces? Drag the light over the art, or let it go round. If a surface is wrong, press on it and say which way it should face. The final look is the game's own shader, judged in the game.",
        onToggle: renderLightPanel,
        action: h("span", { class: "meta" }, on ? "on" : "")
      },
      hint(!hasMap ? "No normal map beside this: the agent makes one with `ritmo-tools pixel normals`." : on ? (state.view === "set" ? "The whole set under one light." : "Drag the light over the art.") : "Press L to see the art under the light."),
      h(
        "div",
        { class: `pixel-light-controls${on ? "" : " off"}`, attrs: on ? {} : { inert: true } },
        sliderRow("Height", state.light.height, { min: 0.05, max: 1.5, step: 0.05 }, (v) => `${Math.round(v * 100)}%`, (height) => set({ height }), remember, "How far in front of the art the light is: low shows the shape most"),
        sliderRow("Reach", state.light.reach, { min: 0.5, max: 6, step: 0.5 }, (v) => `${v}×`, (reach) => set({ reach }), remember, "How far it reaches, by the art's longest side"),
        sliderRow("Ambient", state.light.ambient, { min: 0, max: 1, step: 0.05 }, (v) => `${Math.round(v * 100)}%`, (ambient) => set({ ambient }), remember, "How much of the art shows with no light on it"),
        sliderRow("Brightness", state.light.brightness, { min: 0.2, max: 3, step: 0.1 }, (v) => v.toFixed(1), (brightness) => set({ brightness }), remember),
        prop(
          "Color",
          h("input", {
            class: "pixel-color",
            props: { type: "color", value: state.light.color },
            attrs: { "aria-label": "The light's color", title: "The light's color" },
            on: {
              input: (event) => {
                if (event.currentTarget instanceof HTMLInputElement) set({ color: event.currentTarget.value })
              },
              change: () => {
                remember()
                renderLamp()
              }
            }
          })
        ),
        prop(
          "Steps",
          segmented(
            String(state.light.steps),
            [
              { id: "0", label: "Smooth", title: "The light as it falls" },
              { id: "2", label: "2" },
              { id: "3", label: "3" },
              { id: "4", label: "4" }
            ],
            (steps) => {
              set({ steps: Number(steps) })
              remember()
              renderLightPanel()
            },
            { label: "Steps", class: "fill" }
          ),
          "The light in even steps, as a game that steps its light would show it"
        ),
        state.view === "asset" &&
          switchRow("Go round", state.orbit, (orbit) => {
            state.orbit = orbit
            renderLightPanel()
            renderLamp()
          }, "The light circles the art, to see every side of the shape")
      )
    )
  )
}

/** Where a lint issue is, in words: its frame on a sheet. */
const issueFrame = (entry: Entry, issue: FrameIssue): string => {
  if (issue.frame === undefined) return ""
  const frame = entry.frames[issue.frame]
  return frame === undefined ? "" : `${frame.animation ?? ""} frame ${frame.index}: `
}

const renderChecks = (): void => {
  const entry = entryOf(state.current)
  if (!panelsShown() || entry === undefined) return redraw(checksBox)
  const detail = state.detail?.id === entry.id ? state.detail : undefined
  const issues = detail?.issues ?? []
  redraw(
    checksBox,
    section(
      {
        id: "pixel-checks",
        title: "Rules",
        help: "The lint against this asset's nearest pixel.config.json, the rules the agent checks with `ritmo-tools pixel lint`: its size, palette, colors, transparency, and stray pixels, each frame of a sheet apart, and whether its normal map still matches it. Warnings to weigh, not a verdict: you judge how it looks.",
        onToggle: renderChecks,
        action: h("span", { class: "meta" }, entry.problem !== undefined ? "" : entry.errors + entry.warnings === 0 ? "clean" : `${entry.errors} error${entry.errors === 1 ? "" : "s"} · ${entry.warnings} warning${entry.warnings === 1 ? "" : "s"}`)
      },
      entry.lintProblem !== undefined && callout("warn", `Cannot lint it: ${entry.lintProblem}`),
      entry.problem !== undefined && hint("Not linted: it cannot be read."),
      entry.problem === undefined &&
        entry.lintProblem === undefined &&
        (detail === undefined
          ? hint("Reading its lint…")
          : issues.length === 0
            ? callout("good", detail.config === undefined ? "No rules broken (no pixel.config.json above it: only the general ones)." : "No rules broken.")
            : h(
                "ul",
                { class: "issues" },
                issues.map((issue) =>
                  h(
                    "li",
                    { class: issue.severity },
                    icon(issue.severity === "error" ? "alert" : "info"),
                    h("span", {}, `${issueFrame(entry, issue)}${issue.message}`),
                    issue.at.length > 0 &&
                      button("Show", () => {
                        const frame = issue.frame === undefined ? undefined : entry.frames[issue.frame]
                        if (frame?.animation !== undefined) state.animation = frame.animation
                        state.playing = false
                        state.frame = frame?.index ?? 0
                        state.marks = { frame: issue.frame ?? 0, at: issue.at }
                        settleComposed()
                        renderStage()
                        repaint()
                      }, { small: true, variant: "ghost", title: "Pause on its frame with its pixels ringed" })
                  )
                )
              )),
      detail !== undefined &&
        group(
          "Files",
          prop("Asset", h("code", { title: detail.file }, entry.id)),
          detail.source !== undefined && prop("Made from", h("code", {}, detail.source), "The file the agent changes to make this one again"),
          detail.sheet !== undefined && prop("Frames", h("code", {}, detail.sheet)),
          detail.normal !== undefined && prop("Normal map", h("code", {}, detail.normal)),
          detail.normalData !== undefined && prop("Corrections", h("code", {}, detail.normalData), "What the map was made from, and the corrections the agent keeps there"),
          prop("Rules", h("code", {}, detail.config ?? "none"))
        )
    )
  )
}

const renderViewPanel = (): void => {
  if (!state.loaded) return redraw(viewBox)
  const swatch = (id: Backdrop, label: string, title: string): HTMLElement => {
    const [a, b] = id === "custom" ? [state.custom, state.custom] : BUILT_IN[id]
    return h(
      "button",
      {
        class: `fx-backdrop${state.backdrop === id ? " on" : ""}`,
        title,
        attrs: { type: "button", "aria-pressed": String(state.backdrop === id) },
        on: {
          click: () => {
            state.backdrop = id
            viewChanged()
          }
        }
      },
      h("span", { class: "fx-backdrop-swatch", attrs: { style: `background:linear-gradient(135deg, ${a} 50%, ${b} 50%)` } }),
      label
    )
  }
  redraw(
    viewBox,
    section(
      { id: "pixel-view", title: "View", closed: true, help: "What the art is drawn over, and how. The backdrop is in squares of 4 art pixels, so the pixel size shows; pick one near the game's own ground. Repeat draws the frame three by three, to see a tile's seams.", onToggle: renderViewPanel },
      group(
        "Backdrop",
        h(
          "div",
          { class: "fx-backdrops" },
          swatch("dark", "Dark", "A dark night blue"),
          swatch("light", "Light", "A light paper"),
          swatch("checker", "Checker", "Grey squares, to see what is transparent"),
          swatch("custom", "Yours", "The color below: the game's own ground"),
          h("input", {
            class: "pixel-color",
            props: { type: "color", value: state.custom },
            attrs: { "aria-label": "Your backdrop color", title: "Your backdrop color" },
            on: {
              input: (event) => {
                const target = event.currentTarget
                if (!(target instanceof HTMLInputElement)) return
                state.custom = target.value
                state.backdrop = "custom"
                remember()
                repaint()
                if (state.view === "set") renderStage()
              },
              change: () => renderViewPanel()
            }
          })
        )
      ),
      state.view === "asset" &&
        switchRow("Repeat", state.repeat, (on) => {
          state.repeat = on
          viewChanged()
        }, "Draw the frame three by three, to see whether a tile repeats without seams")
    )
  )
}

const viewChanged = (): void => {
  remember()
  renderViewPanel()
  renderStage()
}

const setPanel = (): HTMLElement =>
  section(
    { id: "pixel-set", title: "The whole set", help: "Every asset at one scale, side by side, to judge the art as one game: its sizes, outlines, palette, and detail should agree. A sheet shows its first frame. Pick some (the check on each) to compare them alone or approve them together; open one to comment on it.", onToggle: renderReview },
    hint(`${visible().length} shown at ${state.setZoom}×. Open one to comment on its pixels.`)
  )

const renderAbout = (): void =>
  redraw(
    aboutBox,
    h(
      "footer",
      { class: "about" },
      h("div", { class: "ruler", attrs: { "aria-hidden": "true" } }),
      h("div", { class: "about-head" }, mark(), "Pixel review, by Ritmo"),
      h(
        "p",
        {},
        "A game's pixel art, reviewed by a person and read back by the agent: ",
        h("code", {}, "ritmo-tools pixel notes"),
        ", ",
        h("code", {}, "ritmo-tools pixel resolve"),
        ". What you say is saved to ",
        h("code", {}, "pixel.review.json"),
        " at the game's root. Fixing pixels by hand belongs on the pixel fixer's page."
      ),
      h("p", { class: "hint" }, "Keys: ↑ ↓ change asset, Space plays, ← → step frames, + − zoom, 0 back to 1×, F as large as fits, V the whole set and back, L under the light, N the normal map, Esc drops a comment being drawn.")
    )
  )

// ---------------------------------------------------------------------------
// Messages, and the person's way of working

let toastTimer: ReturnType<typeof setTimeout> | undefined

function say(message: string): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  replace(toast, h("span", {}, message), button("Dismiss", () => toast.classList.remove("on"), { variant: "ghost", icon: "close", iconOnly: true, small: true }))
  toast.classList.add("on")
  toastTimer = setTimeout(() => toast.classList.remove("on"), 6000)
}

const VIEW_KEY = "ritmo-pixel-review-view"

/** Remembers how the person looks at art (backdrop, repeat): a convenience only. */
const remember = (): void => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ backdrop: state.backdrop, custom: state.custom, repeat: state.repeat, look: state.look, light: state.light }))
  } catch {
    // Storage may be off; the page works without it.
  }
}

const recall = (): void => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}")
    if (typeof raw !== "object" || raw === null) return
    if ("backdrop" in raw && (raw.backdrop === "dark" || raw.backdrop === "light" || raw.backdrop === "checker" || raw.backdrop === "custom")) state.backdrop = raw.backdrop
    if ("custom" in raw && typeof raw.custom === "string" && parseHex(raw.custom) !== undefined) state.custom = raw.custom
    if ("repeat" in raw && typeof raw.repeat === "boolean") state.repeat = raw.repeat
    if ("look" in raw && (raw.look === "art" || raw.look === "lit" || raw.look === "normal")) state.look = raw.look
    if ("light" in raw && typeof raw.light === "object" && raw.light !== null) {
      const light = raw.light
      const number = (name: string, least: number, most: number, fallback: number): number => {
        const value: unknown = Reflect.get(light, name)
        return typeof value === "number" && value >= least && value <= most ? value : fallback
      }
      const color: unknown = Reflect.get(light, "color")
      const was = state.light
      state.light = {
        x: number("x", 0, 1, was.x),
        y: number("y", 0, 1, was.y),
        height: number("height", 0.05, 1.5, was.height),
        reach: number("reach", 0.5, 6, was.reach),
        ambient: number("ambient", 0, 1, was.ambient),
        brightness: number("brightness", 0.2, 3, was.brightness),
        color: typeof color === "string" && parseHex(color) !== undefined ? color : was.color,
        steps: number("steps", 0, 4, was.steps)
      }
    }
  } catch {
    // Nothing remembered.
  }
}

function update(): void {
  renderTopbar()
  renderRail()
  renderStage()
  renderReview()
  renderComments()
  renderLightPanel()
  renderChecks()
  renderViewPanel()
  renderAbout()
}

// The arrows move through the list and the frames; Space plays; + and − zoom; V switches the view; Ctrl/Cmd+Z undoes.
window.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    if (event.key === "Escape" && target instanceof HTMLTextAreaElement) target.blur()
    return
  }
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault()
    if (event.shiftKey) history.redo()
    else history.undo()
  } else if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault()
    history.redo()
  } else if (mod || event.altKey) {
    return
  } else if (event.key === " ") {
    event.preventDefault()
    toggle()
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    step(event.key === "ArrowDown" ? 1 : -1)
  } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && state.view === "asset") {
    event.preventDefault()
    stepFrame(event.key === "ArrowRight" ? 1 : -1)
  } else if (event.key === "+" || event.key === "=") {
    zoomBy(1)
  } else if (event.key === "-" || event.key === "_") {
    zoomBy(-1)
  } else if (event.key === "0") {
    setZoom(1)
  } else if (event.key === "f" || event.key === "F") {
    fitAgain()
  } else if (event.key === "l" || event.key === "L") {
    toggleLook("lit")
  } else if (event.key === "n" || event.key === "N") {
    toggleLook("normal")
  } else if (event.key === "v" || event.key === "V") {
    // Not Tab: that key belongs to moving through the page's controls.
    setView(state.view === "asset" ? "set" : "asset")
  } else if (event.key === "Escape" && (state.composing !== undefined || state.marks !== undefined)) {
    dropComposed()
    state.marks = undefined
    renderRings()
    renderComments()
  }
})

const sizeChanged = (): void => {
  if (state.view === "set") {
    if (setColumns().count !== setColumnsDrawn) renderStage()
    return
  }
  const entry = entryOf(state.current)
  if (state.fit && entry !== undefined && entry.problem === undefined && fitZoom(entry) !== state.zoom) renderStage()
  else repaint()
}

window.addEventListener("resize", sizeChanged)
// The stage's own size, not only the window's: a browser may first lay it out before it has its full height, and the title above the art may wrap. Next frame, since drawing during the observer's own pass would report again.
const stageWatch = new ResizeObserver(() => requestAnimationFrame(sizeChanged))
stageWatch.observe(content)
stageWatch.observe(head)

/** Draws the page and opens the art from where `chosen` keeps it; follows the agent's changes. */
export const start = (chosen: Store): void => {
  store = chosen
  recall()
  update()
  void load()
  requestAnimationFrame(tick)
  setInterval(() => void follow(), 1500)
}
