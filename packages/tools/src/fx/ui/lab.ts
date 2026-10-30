/**
 * The effects lab's review page, served by `ritmo-tools fx review <bank>`:
 * the person watches every draft of an effect side by side, slowed down or
 * frame by frame, picks the one the game gets, tunes its params with
 * sliders, and leaves a status and a note. Every change is saved to the bank
 * and its review as it happens, for the agent to read back (`ritmo-tools fx
 * notes`); a draft the agent edits while the page is open plays anew.
 *
 * Built from the pixel fixer's kit and the sound lab's layout, so the tools
 * look and work alike.
 */
import { button, callout, cliChip, group, hint, icon, mark, prop, section, segmented, sliderRow } from "../../pixel/ui/kit.ts"
import { h, replace } from "../../pixel/ui/dom.ts"
import { parseHex } from "../../pixel/core/color.ts"
import { decodeBank, decodeReview, emptyReview, encodeBank, encodeReview, newEffect, usedDraft, type Bank, type Comment, type Draft, type EffectReview, type Review, type Status } from "../core/bank.ts"
import { checkEffect, paletteIssues, type Checked, type Context, type Issue } from "../core/check.ts"
import type { Spot } from "../core/craft.ts"
import { decodeEffect, tuned, type Effect } from "../core/effect.ts"
import type { PageRules, Store } from "./store.ts"

const RITMO_URL = "https://ritmo.typeonce.dev/"

/** Where the bank and its review are read and written: set once by `start`. */
let store!: Store

// ---------------------------------------------------------------------------
// State

type Speed = "0.25" | "0.5" | "1"

const state = {
  bankFile: "",
  name: "",
  bank: { palette: {}, effects: {} } as Bank,
  review: emptyReview,
  sources: {} as Readonly<Record<string, string | null>>,
  selected: "",
  /** The draft the Tune and Check sections are about. */
  focus: "",
  playing: true,
  speed: "1" as Speed,
  zoom: 6,
  /** "dark", "light", "checker", or one of the bank's backdrops by name. */
  backdrop: "dark",
  /** The frame shown while paused, the same on every draft (wrapped to each one's length). */
  frame: 0,
  rules: {} as PageRules,
  /** Pixels ringed on one draft: where a check fires, shown from the Check section. */
  marks: undefined as { readonly draft: string; readonly code: string; readonly spots: ReadonlyArray<Spot> } | undefined,
  /** A comment being written, pinned to a pixel the person clicked. */
  composing: undefined as { readonly draft: string; readonly frame: number; readonly x: number; readonly y: number } | undefined,
  saving: "saved" as "saved" | "saving" | "failed",
  version: "",
  loaded: false
}

type Loaded = { readonly ok: true; readonly effect: Effect } | { readonly ok: false; readonly error: string }

/** Each draft module by its source, so an unchanged file is never loaded twice. */
const modules = new Map<string, Loaded>()

const load = async (file: string, source: string | null): Promise<Loaded> => {
  if (source === null) return { ok: false, error: `cannot read ${file}` }
  const known = modules.get(source)
  if (known !== undefined) return known
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
  let loaded: Loaded
  try {
    const decoded = decodeEffect(await import(/* @vite-ignore */ url))
    loaded = decoded.ok ? { ok: true, effect: decoded.value } : { ok: false, error: `${file}: ${decoded.error}` }
  } catch (error) {
    loaded = { ok: false, error: `${file} does not load: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    URL.revokeObjectURL(url)
  }
  modules.set(source, loaded)
  return loaded
}

/** Every draft's loaded module, by its file. */
let loadedFiles = new Map<string, Loaded>()

const loadAll = async (): Promise<void> => {
  const next = new Map<string, Loaded>()
  for (const [file, source] of Object.entries(state.sources)) next.set(file, await load(file, source))
  loadedFiles = next
}

const runs = new Map<string, Checked>()
/** A draft's frames and check, cached by everything that changes them. */
const checkedOf = (draft: Draft): Checked | { readonly error: string } => {
  const loaded = loadedFiles.get(draft.file)
  if (loaded === undefined) return { error: "loading…" }
  if (!loaded.ok) return { error: loaded.error }
  const key = JSON.stringify([state.sources[draft.file], draft.seed, draft.tune, draft.accept, state.bank.palette, state.bank.backdrops, state.rules])
  let found = runs.get(key)
  if (found === undefined) {
    if (runs.size > 300) runs.clear()
    found = checkEffect(loaded.effect, state.bank.palette, { seed: draft.seed, tune: draft.tune, accept: draft.accept }, context())
    runs.set(key, found)
  }
  return found
}

/** The project's rules and the game's backgrounds, as `fx check` uses them. */
const context = (): Context => ({
  rules: {
    palette: state.rules.palette?.flatMap((hex) => {
      const rgb = parseHex(hex)
      return rgb === undefined ? [] : [rgb]
    }),
    maxColors: state.rules.maxColors
  },
  backdrops: state.bank.backdrops
})

const effectOf = (draft: Draft): Effect | undefined => {
  const loaded = loadedFiles.get(draft.file)
  return loaded?.ok === true ? loaded.effect : undefined
}

const names = (): Array<string> => Object.keys(state.bank.effects)
const reviewOf = (name: string): EffectReview => state.review.effects[name] ?? newEffect

// ---------------------------------------------------------------------------
// Saving: the bank and the review go back to their files as they change

let bankDirty = false
let reviewDirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

const flush = async (): Promise<void> => {
  saveTimer = undefined
  try {
    if (bankDirty) {
      bankDirty = false
      state.version = await store.save("bank", encodeBank(state.bank))
    }
    if (reviewDirty) {
      reviewDirty = false
      state.version = await store.save("review", encodeReview(state.review))
    }
    state.saving = bankDirty || reviewDirty ? "saving" : "saved"
  } catch (error) {
    state.saving = "failed"
    say(`Not saved: ${error instanceof Error ? error.message : String(error)}`)
  }
  renderTopbar()
}

const save = (what: { readonly bank?: boolean; readonly review?: boolean }): void => {
  if (what.bank === true) bankDirty = true
  if (what.review === true) reviewDirty = true
  state.saving = "saving"
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), 400)
}

const setReview = (name: string, change: Partial<EffectReview>): void => {
  const review: Review = { effects: { ...state.review.effects, [name]: { ...reviewOf(name), ...change } } }
  state.review = review
}

const setDraft = (name: string, id: string, change: Partial<Draft>): void => {
  const entry = state.bank.effects[name]
  const draft = entry?.drafts[id]
  if (entry === undefined || draft === undefined) return
  state.bank = { ...state.bank, effects: { ...state.bank.effects, [name]: { ...entry, drafts: { ...entry.drafts, [id]: { ...draft, ...change } } } } }
}

const useDraft = (name: string, id: string): void => {
  const entry = state.bank.effects[name]
  if (entry === undefined) return
  state.bank = { ...state.bank, effects: { ...state.bank.effects, [name]: { ...entry, use: id } } }
  state.focus = id
  save({ bank: true })
  update()
}

// ---------------------------------------------------------------------------
// Loading, and following the agent's edits

const open = async (): Promise<void> => {
  const session = await store.session()
  if (session === undefined) return
  const bank = decodeBank(session.bankText)
  if (!bank.ok) {
    say(`The bank does not read: ${bank.error}`)
    return
  }
  const review = session.reviewText === null ? undefined : decodeReview(session.reviewText)
  state.bankFile = session.bank
  state.name = session.name
  state.bank = bank.value
  state.review = review?.ok === true ? review.value : emptyReview
  state.sources = session.sources
  state.rules = session.rules
  state.version = session.version
  if (!(state.backdrop in BUILT_IN) && state.bank.backdrops?.[state.backdrop] === undefined) state.backdrop = "dark"
  await loadAll()
  state.loaded = true
  if (!(state.selected in state.bank.effects)) state.selected = names()[0] ?? ""
  const entry = state.bank.effects[state.selected]
  if (entry !== undefined && !(state.focus in entry.drafts)) state.focus = usedDraft(entry) ?? ""
  update()
}

const follow = async (): Promise<void> => {
  if (saveTimer !== undefined) return
  const now = await store.version()
  if (now === undefined || now === state.version) return
  await open()
  say("The agent changed the bank: it is up to date.")
}

// ---------------------------------------------------------------------------
// The page

const app = document.getElementById("app")!
const topbar = h("header", { class: "topbar" })
const list = h("aside", { class: "sounds", attrs: { "aria-label": "Effects" } })
const content = h("div", { class: "sound-view" })
const playback = h("div", { class: "floating playback" })
const toast = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } })
const panels = h("aside", { class: "inspector", attrs: { "aria-label": "Settings" } })
const stage = h("div", { class: "stage fx-stage" }, content, playback, toast)

app.append(topbar, h("main", { class: "layout lab" }, list, h("section", { class: "workspace" }, stage), panels))

const statusLabel: Record<Status, string> = { new: "To review", approved: "Approved", changes: "Changes asked" }
const count = (status: Status): number => names().filter((name) => reviewOf(name).status === status).length

const renderTopbar = (): void => {
  replace(
    topbar,
    h(
      "div",
      { class: "topbar-start" },
      h(
        "div",
        { class: "brand" },
        mark(),
        h("span", {}, "Effects lab"),
        h("a", { class: "by", title: "Ritmo, the agent-first type safe ECS runtime", attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "by ", h("b", {}, "ritmo")),
        store.demo && cliChip("npx @typeonce/ritmo-tools fx review game.fx.json", "Your coding agent can drive the effects lab on your game's own effects: it writes drafts as code and checks them, then opens this page for you to watch, pick, tune, and comment on, and reads it all back.")
      ),
      state.loaded &&
        h(
          "div",
          { class: "file", title: state.bankFile },
          h("span", { class: "file-name" }, state.name),
          h("span", { class: "file-meta" }, `${names().length} effects · ${count("approved")} approved`)
        )
    ),
    h("div", { class: "topbar-center" }),
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

const select = (name: string): void => {
  state.selected = name
  const entry = state.bank.effects[name]
  state.focus = entry === undefined ? "" : (usedDraft(entry) ?? "")
  state.frame = 0
  state.marks = undefined
  state.composing = undefined
  clock = performance.now()
  update()
}

const renderList = (): void => {
  replace(
    list,
    h("div", { class: "sounds-head" }, h("p", { class: "hint" }, "Effects")),
    h(
      "div",
      { class: "sound-rows", attrs: { role: "listbox" } },
      names().map((name) => {
        const entry = state.bank.effects[name]!
        const drafts = Object.values(entry.drafts).map(checkedOf)
        const errors = drafts.some((checked) => "error" in checked || checked.issues.some((issue) => issue.level === "error"))
        const warnings = drafts.some((checked) => "issues" in checked && checked.issues.length > 0)
        return h(
          "div",
          {
            class: `sound-row${name === state.selected ? " on" : ""}`,
            attrs: { role: "option", "aria-selected": String(name === state.selected), tabindex: 0 },
            on: { click: () => select(name) }
          },
          h("span", { class: `dot ${reviewOf(name).status}`, title: statusLabel[reviewOf(name).status] }),
          h("span", { class: "sound-name" }, name),
          (errors || warnings) && h("span", { class: `sound-flag ${errors ? "bad" : "warn"}`, title: errors ? "A draft has errors" : "A draft has warnings" }, icon("alert")),
          h("span", { class: "sound-length", title: "Drafts" }, `${Object.keys(entry.drafts).length}`)
        )
      })
    )
  )
}

// ---------------------------------------------------------------------------
// Playing: one clock for every draft, so their timing compares

/** When the current play started, in page time. */
let clock = performance.now()
/** How long a one-shot's empty pause lasts before it plays again, in milliseconds. */
const REST = 450

const BUILT_IN: Readonly<Record<string, readonly [string, string]>> = {
  dark: ["#1a1c2c", "#1f2133"],
  light: ["#e8e4d8", "#dcd8cc"],
  checker: ["#3a3a44", "#5a5a66"]
}

/** A backdrop's two square colors: a built-in one, or one of the bank's with a faintly lighter or darker square, so the pixel size shows. */
const backdropColors = (name: string): readonly [string, string] => {
  const built = BUILT_IN[name]
  if (built !== undefined) return built
  const hex = state.bank.backdrops?.[name] ?? "#1a1c2c"
  const rgb = parseHex(hex) ?? { r: 26, g: 28, b: 44 }
  const shift = (rgb.r + rgb.g + rgb.b) / 3 > 128 ? -10 : 10
  const nudge = (v: number): string => Math.max(0, Math.min(255, v + shift)).toString(16).padStart(2, "0")
  return [hex, `#${nudge(rgb.r)}${nudge(rgb.g)}${nudge(rgb.b)}`]
}

/** Magenta: the debug color, in almost no game's palette, so a ring shows on fire, ice, and smoke alike. */
const MARK = "#ff2bd6"

/** The frame a draft shows now, or -1 while a one-shot rests between plays. */
const frameNow = (checked: Checked, now: number): number => {
  const frames = checked.run.frames.length
  if (!state.playing) return ((state.frame % frames) + frames) % frames
  const elapsed = (now - clock) * Number(state.speed)
  const step = 1000 / checked.run.fps
  if (checked.run.loop) return Math.floor(elapsed / step) % frames
  const at = elapsed % (frames * step + REST)
  return at < frames * step ? Math.floor(at / step) : -1
}

let cards: Array<{ readonly id: string; readonly canvas: HTMLCanvasElement; readonly checked: Checked; readonly counter: HTMLElement | undefined }> = []

/** The pixels ringed on a draft's frame: the comments pinned there, and the marks shown from the Check section. */
const ringsOn = (id: string, frame: number): Array<{ readonly x: number; readonly y: number; readonly label?: string }> => {
  // Open comments only: resolved ones are done.
  const comments = reviewOf(state.selected).comments.flatMap((comment, index) =>
    comment.draft === id && comment.frame === frame && comment.resolved !== true ? [{ x: comment.x, y: comment.y, label: String(index + 1) }] : []
  )
  const composing = state.composing?.draft === id && state.composing.frame === frame ? [{ x: state.composing.x, y: state.composing.y, label: "+" }] : []
  const marks = state.marks?.draft === id ? state.marks.spots.filter((spot) => spot.frame === frame) : []
  return [...comments, ...composing, ...marks]
}

const paint = (canvas: HTMLCanvasElement, checked: Checked, frame: number, id: string): void => {
  const { width, height } = checked.run
  const zoom = state.zoom
  if (canvas.width !== width * zoom) canvas.width = width * zoom
  if (canvas.height !== height * zoom) canvas.height = height * zoom
  const context = canvas.getContext("2d")
  if (context === null) return
  const [a, b] = backdropColors(state.backdrop)
  // The backdrop is in squares of 4 effect pixels, so the pixel size shows.
  for (let y = 0; y < height; y += 4)
    for (let x = 0; x < width; x += 4) {
      context.fillStyle = (x / 4 + y / 4) % 2 === 0 ? a : b
      context.fillRect(x * zoom, y * zoom, 4 * zoom, 4 * zoom)
    }
  const pixels = frame < 0 ? undefined : checked.run.frames[frame]
  if (pixels === undefined) return
  const colors = Object.values(state.bank.palette)
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]!
    if (v === 0) continue
    context.fillStyle = colors[v - 1] ?? "#ff00ff"
    context.fillRect((i % width) * zoom, Math.floor(i / width) * zoom, zoom, zoom)
  }
  for (const ring of ringsOn(id, frame)) {
    context.strokeStyle = MARK
    context.lineWidth = 2
    context.strokeRect(ring.x * zoom - 2, ring.y * zoom - 2, zoom + 4, zoom + 4)
    if (ring.label !== undefined) {
      context.fillStyle = MARK
      context.font = "600 11px Inter, system-ui, sans-serif"
      context.fillText(ring.label, ring.x * zoom + zoom + 4, ring.y * zoom - 3)
    }
  }
}

const tick = (now: number): void => {
  for (const card of cards) {
    const frame = frameNow(card.checked, now)
    paint(card.canvas, card.checked, frame, card.id)
    // Frames count from 0, as in the draft's code, `fx check`, and comments.
    if (card.counter !== undefined) card.counter.textContent = frame < 0 ? "–" : `frame ${frame}`
  }
  requestAnimationFrame(tick)
}

const renderStage = (): void => {
  cards = []
  const name = state.selected
  const entry = state.bank.effects[name]
  if (entry === undefined) {
    replace(content, h("div", { class: "empty-card lab-empty" }, h("div", { class: "empty-icon" }, mark()), h("h2", {}, state.loaded ? "No effects in this bank" : "Opening the bank…")))
    return
  }
  const said = reviewOf(name)
  const use = usedDraft(entry)
  // Every card is the size of the effect's largest draft at this zoom, so drafts of other sizes,
  // a counter's changing digits, or a new canvas never move the cards around.
  const sizes = Object.values(entry.drafts).flatMap((draft) => {
    const checked = checkedOf(draft)
    return "run" in checked ? [{ w: checked.run.width * state.zoom, h: checked.run.height * state.zoom }] : []
  })
  const screen = { w: Math.max(220, ...sizes.map((size) => size.w)), h: Math.max(96, ...sizes.map((size) => size.h)) }
  replace(
    content,
    h(
      "div",
      { class: "sound-head" },
      h("div", { class: "sound-title" }, h("h1", {}, name), said.status !== "new" && h("span", { class: `stage-pill ${said.status}` }, statusLabel[said.status])),
      entry.about !== undefined && h("p", { class: "sound-about" }, entry.about)
    ),
    paletteNotice(),
    h(
      "div",
      { class: "fx-drafts", attrs: { style: `--fx-screen-w:${screen.w}px;--fx-screen-h:${screen.h}px` } },
      Object.entries(entry.drafts).map(([id, draft], index) => {
        const checked = checkedOf(draft)
        const effect = effectOf(draft)
        const isUsed = id === use
        const isTuned = draft.tune !== undefined && Object.keys(draft.tune).length > 0
        const head = h(
          "div",
          { class: "fx-card-head" },
          h("span", { class: "take-number" }, String(index + 1)),
          h("b", {}, id),
          h("span", { class: "fx-label" }, effect?.label ?? ""),
          isTuned && h("span", { class: "stage-pill tuned" }, "Tuned"),
          isUsed
            ? h("span", { class: "take-picked", title: "The game gets this draft" }, icon("check"), "In use")
            : button("Use", (event) => {
                event.stopPropagation()
                useDraft(name, id)
              }, { small: true, variant: "ghost", title: "The game gets this draft" })
        )
        if ("error" in checked)
          return h("div", { class: `fx-card${id === state.focus ? " on" : ""}`, on: { click: () => focus(id) } }, head, callout("bad", checked.error))
        // Sized now, not on its first paint: a canvas starts at 300 × 150.
        const canvas = h("canvas", {
          class: "fx-canvas",
          title: id === state.focus ? "Click a pixel to comment on it (pauses on this frame)" : "Click to focus this draft",
          props: { width: checked.run.width * state.zoom, height: checked.run.height * state.zoom },
          on: { click: (event) => pin(id, checked, event) }
        })
        const counter = h("span", { class: "fx-counter", title: "Frames count from 0, as in the draft's code" })
        cards.push({ id, canvas, checked, counter })
        const timing = `${checked.measures.frames} frames · ${checked.measures.fps} fps · ${checked.measures.duration} ms${checked.run.loop ? " · loop" : ""}`
        const errors = checked.issues.filter((issue) => issue.level === "error").length
        const warnings = checked.issues.length - errors
        return h(
          "div",
          { class: `fx-card${id === state.focus ? " on" : ""}${isUsed ? " used" : ""}`, on: { click: () => focus(id) } },
          head,
          h("div", { class: "fx-screen" }, canvas),
          h(
            "div",
            { class: "fx-card-foot" },
            h("span", { title: timing }, timing),
            errors + warnings > 0 && h("span", { class: `sound-flag ${errors > 0 ? "bad" : "warn"}`, title: checked.issues.map((issue) => issue.message).join("\n") }, icon("alert")),
            counter
          )
        )
      })
    )
  )
}

/** On the draft in focus, pauses on the frame shown and starts a comment on the pixel clicked; on another draft, only focuses it (the card's own click). */
const pin = (id: string, checked: Checked, event: MouseEvent): void => {
  const target = event.currentTarget
  if (!(target instanceof HTMLCanvasElement) || state.focus !== id) return
  const frame = state.playing ? frameNow(checked, performance.now()) : ((state.frame % checked.run.frames.length) + checked.run.frames.length) % checked.run.frames.length
  if (state.playing) toggle()
  if (frame < 0) {
    // Clicked while a one-shot rests between plays: there is no pixel to pin, so stop on its first frame for the next click.
    state.frame = 0
    renderStage()
    return
  }
  state.frame = frame
  const box = target.getBoundingClientRect()
  const x = Math.floor(((event.clientX - box.left) / box.width) * checked.run.width)
  const y = Math.floor(((event.clientY - box.top) / box.height) * checked.run.height)
  state.composing = { draft: id, frame, x, y }
  state.focus = id
  update()
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".fx-compose textarea")?.focus())
}

/** Pauses on a comment's frame, on its draft, with its pixel ringed. */
const goTo = (comment: Comment): void => {
  if (state.playing) toggle()
  state.frame = comment.frame
  state.focus = comment.draft
  state.marks = undefined
  update()
}

const focus = (id: string): void => {
  if (state.focus === id) return
  state.focus = id
  renderStage()
  renderPanels()
}

const renderPlayback = (): void => {
  replace(
    playback,
    button(state.playing ? "Pause" : "Play", () => toggle(), { variant: "ghost", icon: state.playing ? "pause" : "play", iconOnly: true, title: state.playing ? "Pause (Space)" : "Play (Space)" }),
    button("Previous frame", () => stepFrame(-1), { variant: "ghost", icon: "previous", iconOnly: true, title: "Previous frame (←)" }),
    button("Next frame", () => stepFrame(1), { variant: "ghost", icon: "next", iconOnly: true, title: "Next frame (→)" }),
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
      String(state.zoom) as "2" | "4" | "6" | "8",
      [
        { id: "2", label: "2×", title: "Each pixel 2 screen pixels: near game size" },
        { id: "4", label: "4×" },
        { id: "6", label: "6×" },
        { id: "8", label: "8×", title: "Each pixel 8 screen pixels: to see detail" }
      ],
      (zoom) => {
        state.zoom = Number(zoom)
        renderStage()
        renderPlayback()
      },
      { label: "Zoom" }
    )
  )
}

const toggle = (): void => {
  if (state.playing) {
    // Pause on the frame the focused draft shows now.
    const draft = state.bank.effects[state.selected]?.drafts[state.focus]
    const checked = draft === undefined ? undefined : checkedOf(draft)
    state.frame = checked !== undefined && "run" in checked ? Math.max(0, frameNow(checked, performance.now())) : 0
  } else {
    clock = performance.now()
  }
  state.playing = !state.playing
  renderPlayback()
}

const stepFrame = (by: number): void => {
  if (state.playing) toggle()
  state.frame += by
}

// ---------------------------------------------------------------------------
// Panels

const statusOptions = [
  { id: "new" as const, label: "To review", icon: "sparkle" as const, title: "Not reviewed yet" },
  { id: "approved" as const, label: "Approved", icon: "check" as const, title: "It looks right" },
  { id: "changes" as const, label: "Changes", icon: "alert" as const, title: "Ask the agent for changes: say what in the note" }
]

const reviewPanel = (name: string): HTMLElement => {
  const said = reviewOf(name)
  return section(
    {
      id: "review",
      title: "Review",
      help: "Pick the draft the game gets with Use, then approve it, or ask for changes and say what in your own words (\"b, but faster\", \"the sparks of c on a\", \"less smoke\"). The agent reads every note with `ritmo-tools fx notes`.",
      onToggle: update
    },
    segmented(
      said.status,
      statusOptions,
      (status) => {
        setReview(name, { status })
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
            setReview(name, { note: target.value })
            save({ review: true })
            renderTopbar()
          }
        }
      })
    ),
    commentsGroup(name)
  )
}

const commentsGroup = (name: string): HTMLElement => {
  const comments = reviewOf(name).comments
  const open = comments.filter((comment) => comment.resolved !== true).length
  const composing = state.composing
  const setComment = (index: number, change: Partial<Comment>): void => {
    setReview(name, { comments: reviewOf(name).comments.map((comment, i) => (i === index ? { ...comment, ...change } : comment)) })
    save({ review: true })
    update()
  }
  return group(
    `Comments${comments.length > 0 ? ` · ${open} open` : ""}`,
    composing !== undefined &&
      h(
        "div",
        { class: "fx-compose" },
        h("p", { class: "hint" }, `Draft ${composing.draft}, frame ${composing.frame}, pixel ${composing.x}, ${composing.y}`),
        h("label", { class: "input note" }, h("textarea", { props: { rows: 2 }, attrs: { placeholder: "What about this pixel? (\"breaks apart here\", \"too bright\")", "aria-label": "Comment" } })),
        h(
          "div",
          { class: "fx-compose-actions" },
          button("Cancel", () => {
            state.composing = undefined
            renderPanels()
          }, { small: true, variant: "ghost" }),
          button("Add", () => {
            const text = document.querySelector<HTMLTextAreaElement>(".fx-compose textarea")?.value.trim() ?? ""
            if (text === "") return
            setReview(name, { comments: [...reviewOf(name).comments, { ...composing, text }] })
            state.composing = undefined
            save({ review: true })
            update()
          }, { small: true, variant: "primary" })
        )
      ),
    comments.length === 0 && composing === undefined
      ? hint("Click a pixel of the draft in focus to pin a comment to it (it pauses there): the agent sees the spot ringed.")
      : h(
          "ol",
          { class: "fx-comments" },
          comments.map((comment, index) =>
            h(
              "li",
              { class: comment.resolved === true ? "resolved" : "" },
              h(
                "button",
                { class: "fx-comment", title: "Show this frame, with the pixel ringed", attrs: { type: "button" }, on: { click: () => goTo(comment) } },
                h("span", { class: "fx-comment-number" }, comment.resolved === true ? icon("check") : String(index + 1)),
                h("span", { class: "fx-comment-where" }, `${comment.draft} · frame ${comment.frame}${comment.resolved === true ? " · resolved" : ""}`),
                h("span", { class: "fx-comment-text" }, comment.text),
                comment.resolved === true && comment.reply !== undefined && h("span", { class: "fx-comment-reply" }, `Agent: ${comment.reply}`)
              ),
              comment.resolved === true &&
                button("Reopen", () => setComment(index, { resolved: undefined, reply: undefined }), { small: true, variant: "ghost", title: "It is not done: the agent sees it again in fx notes" }),
              button("Delete", () => {
                setReview(name, { comments: reviewOf(name).comments.filter((_, i) => i !== index) })
                save({ review: true })
                update()
              }, { small: true, variant: "ghost", icon: "trash", iconOnly: true, title: "Delete this comment" })
            )
          )
        )
  )
}

const tunePanel = (name: string): HTMLElement | undefined => {
  const draft = state.bank.effects[name]?.drafts[state.focus]
  const effect = draft === undefined ? undefined : effectOf(draft)
  if (draft === undefined || effect === undefined) return undefined
  const values = tuned(effect, draft.tune)
  const params = Object.entries(effect.params)
  return section(
    {
      id: "tune",
      title: `Tune draft ${state.focus}`,
      help: "The params the agent left open in this draft. Moving one saves it to the draft's tune in the bank; the game gets it when this draft is in use. Click a draft to tune it.",
      onToggle: update,
      action:
        draft.tune !== undefined &&
        button(
          "Reset",
          () => {
            setDraft(name, state.focus, { tune: undefined })
            save({ bank: true })
            update()
          },
          { small: true, variant: "ghost", title: "Back to the draft's own values" }
        )
    },
    params.length === 0
      ? hint("This draft has no params to tune.")
      : params.map(([param, spec]) => {
          // A power of ten, so the draft's own value (and any round number) is on a step.
          const step = spec.step ?? 10 ** Math.floor(Math.log10((spec.max - spec.min) / 20))
          const decimals = Math.max(0, -Math.floor(Math.log10(step)))
          return sliderRow(
            param,
            values[param]!,
            { min: spec.min, max: spec.max, step },
            (value) => value.toFixed(decimals),
            (value) => {
              const current = state.bank.effects[name]?.drafts[state.focus]?.tune ?? {}
              setDraft(name, state.focus, { tune: { ...current, [param]: value } })
              renderStage()
            },
            () => {
              save({ bank: true })
              renderList()
            },
            `From ${spec.min} to ${spec.max}; the draft's own value is ${spec.value}`
          )
        })
  )
}

const checkPanel = (name: string): HTMLElement | undefined => {
  const draft = state.bank.effects[name]?.drafts[state.focus]
  if (draft === undefined) return undefined
  const checked = checkedOf(draft)
  return section(
    {
      id: "check",
      title: `Check draft ${state.focus}`,
      help: "What `ritmo-tools fx check` measures, for the agent: it cannot see the effect, so these are what it reads. Warnings are its call; your eyes decide.",
      onToggle: update
    },
    "error" in checked
      ? callout("bad", checked.error)
      : [
          group(
            "Measures",
            prop("File", h("span", { class: "value mono" }, draft.file)),
            prop("Size", h("span", { class: "value" }, `${checked.run.width} × ${checked.run.height}`)),
            prop("Anchor", h("span", { class: "value" }, `${checked.run.anchor.x}, ${checked.run.anchor.y}`), "The pixel the game places on the effect's spot (the draft's anchor)"),
            prop("Length", h("span", { class: "value" }, `${checked.measures.duration} ms`)),
            prop("Fills", h("span", { class: "value" }, checked.measures.bounds === undefined ? "nothing" : `${checked.measures.bounds.w} × ${checked.measures.bounds.h}`)),
            prop("Colors", h("span", { class: "fx-swatches" }, checked.measures.colors.map((color) => h("span", { class: "fx-swatch", title: color, attrs: { style: `background:${state.bank.palette[color] ?? "#000"}` } }))))
          ),
          checked.issues.length === 0 ? hint("Nothing to flag.") : issueList(checked.issues, state.focus),
          checked.accepted.length > 0 &&
            group(
              "Accepted",
              h(
                "ul",
                { class: "issues accepted" },
                checked.accepted.map((issue) => h("li", { class: "accepted", title: issue.message }, icon("check"), h("span", {}, h("b", {}, issue.code), ": ", issue.why)))
              )
            )
        ]
  )
}

/** Issues, each with Show when it says where: pauses on its first frame with its pixels ringed. */
const issueList = (issues: ReadonlyArray<Issue>, draft: string | undefined): HTMLElement =>
  h(
    "ul",
    { class: "issues" },
    issues.map((issue) => {
      const spots = issue.at ?? []
      const shown = state.marks?.draft === draft && state.marks?.code === issue.code
      return h(
        "li",
        { class: issue.level },
        icon("alert"),
        h("span", {}, issue.message),
        draft !== undefined &&
          spots.length > 0 &&
          button(shown ? "Hide" : "Show", () => {
            if (shown) state.marks = undefined
            else {
              if (state.playing) toggle()
              state.frame = spots[0]!.frame
              state.marks = { draft, code: issue.code, spots }
            }
            renderPanels()
          }, { small: true, variant: "ghost", title: "Pause on its frame with its pixels ringed" })
      )
    })
  )

/** The bank's palette against the project's pixel.config.json: shown above every effect when it breaks. */
const paletteNotice = (): HTMLElement | false => {
  const issues = paletteIssues(state.bank.palette, context().rules)
  return issues.length > 0 && h("div", { class: "fx-palette-issues" }, issueList(issues, undefined))
}

const aboutPanel = (): HTMLElement =>
  h(
    "footer",
    { class: "about" },
    h("div", { class: "ruler", attrs: { "aria-hidden": "true" } }),
    h("div", { class: "about-head" }, mark(), "Effects lab, by Ritmo"),
    h(
      "p",
      {},
      "Pixel art effects as code, a few drafts each. Agents write, check, and look at them from the command line: ",
      h("code", {}, "ritmo-tools fx check"),
      ", ",
      h("code", {}, "ritmo-tools fx look"),
      ", ",
      h("code", {}, "ritmo-tools fx notes"),
      ". What you pick, tune, and note here is saved to ",
      h("code", {}, state.name),
      " and its review.",
      store.demo && [" This demo keeps it in the tab. To open your own bank: ", h("code", {}, "npx @typeonce/ritmo-tools fx review game.fx.json"), "."],
      " Keys: Space plays, ← → step frames, ↑ ↓ change effect, 1–9 focus a draft. Click a pixel to comment on it."
    )
  )

/** What the drafts play over: the game's own backgrounds (the bank's `backdrops`) first, then neutral ones. */
const backgroundPanel = (): HTMLElement => {
  const swatch = (id: string, label: string, title: string): HTMLElement => {
    const [a, b] = backdropColors(id)
    return h(
      "button",
      {
        class: `fx-backdrop${state.backdrop === id ? " on" : ""}`,
        title,
        attrs: { type: "button", "aria-pressed": String(state.backdrop === id) },
        on: {
          click: () => {
            state.backdrop = id
            renderPanels()
          }
        }
      },
      h("span", { class: "fx-backdrop-swatch", attrs: { style: `background:linear-gradient(135deg, ${a} 50%, ${b} 50%)` } }),
      h("span", {}, label)
    )
  }
  const game = Object.entries(state.bank.backdrops ?? {})
  return section(
    {
      id: "background",
      title: "Background",
      help: "What every draft plays over. The game's own backgrounds come from the bank's backdrops, and `fx check` warns when an effect barely shows on one of them; the neutral ones are for judging the effect alone.",
      onToggle: update
    },
    game.length > 0 && group("The game's", h("div", { class: "fx-backdrops" }, game.map(([name, hex]) => swatch(name, name, `The game's ${name} background (${hex})`)))),
    group(
      "Neutral",
      h(
        "div",
        { class: "fx-backdrops" },
        swatch("dark", "Dark", "A dark background"),
        swatch("light", "Light", "A light background"),
        swatch("checker", "Grey", "A grey checkerboard")
      )
    )
  )
}

const renderPanels = (): void => {
  const scroll = panels.scrollTop
  const name = state.selected
  replace(panels, name in state.bank.effects && [reviewPanel(name), backgroundPanel(), tunePanel(name), checkPanel(name)], aboutPanel())
  panels.scrollTop = scroll
}

// ---------------------------------------------------------------------------
// Messages

let toastTimer: ReturnType<typeof setTimeout> | undefined

function say(message: string): void {
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  replace(toast, h("span", {}, message), button("Dismiss", () => toast.classList.remove("on"), { variant: "ghost", icon: "close", iconOnly: true, small: true }))
  toast.classList.add("on")
  toastTimer = setTimeout(() => toast.classList.remove("on"), 5000)
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
  // A slider keeps its own arrow keys.
  if (target instanceof HTMLInputElement && (target.type !== "range" || event.key.startsWith("Arrow"))) return
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === "Escape" && (state.marks !== undefined || state.composing !== undefined)) {
    state.marks = undefined
    state.composing = undefined
    renderPanels()
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
  } else if (/^[1-9]$/.test(event.key)) {
    const id = Object.keys(state.bank.effects[state.selected]?.drafts ?? {})[Number(event.key) - 1]
    if (id !== undefined) focus(id)
  }
})

/** Draws the page, opens the bank from where `chosen` keeps it, and follows the agent's changes when it can make them. */
export const start = (chosen: Store, first = ""): void => {
  store = chosen
  state.selected = first
  update()
  void open()
  if (store.follows) setInterval(() => void follow(), 1500)
  requestAnimationFrame(tick)
}
