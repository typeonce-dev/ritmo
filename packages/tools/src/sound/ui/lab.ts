/**
 * The sound lab's review page, served by `ritmo-tools sound review <bank>` (`main.ts`)
 * and shown on the website with an example bank kept in the tab (`demo.ts`): the person
 * listens to each sound of a bank, compares the takes the agent offered,
 * tunes with sliders, and leaves a status and a note. Every change is saved
 * to the bank and its review as it happens, for the agent to read back
 * (`ritmo-tools sound notes`); changes the agent writes while the page is open show up
 * in it.
 *
 * Built from the pixel fixer's kit, so the two tools look and work alike.
 */
import { badge, button, cliChip, callout, group, hint, icon, mark, numberInput, prop, section, segmented, selectInput, sliderRow, switchRow } from "../../pixel/ui/kit.ts"
import { h, replace } from "../../pixel/ui/dom.ts"
import { makeHistory } from "../../pixel/ui/history.ts"
import { issuesOf, measure, checkBank, type Issue, type Measures } from "../core/measure.ts"
import { applyTune, decodeBank, describeLayer, encodeBank, filters, neutralTune, waves, type Bank, type Filter as NoiseFilter, type Layer, type Recipe, type Tune, type Wave } from "../core/recipe.ts"
import { layerEnd, render, type Rendered } from "../core/render.ts"
import { decodeReview, emptyReview, encodeReview, newSound, type SoundReview, type Status } from "../core/review.ts"
import { makeTakes, towards, type Take, type Toward } from "../core/takes.ts"
import { toWav } from "../core/wav.ts"
import { makePlayer } from "./player.ts"
import type { Store } from "./store.ts"
import { drawWave } from "./wave.ts"

const RITMO_URL = "https://ritmo.typeonce.dev/"

/** Where the bank and its review are read and written: set once by `start`. */
let store!: Store

// ---------------------------------------------------------------------------
// State

type Show = "all" | "new" | "changes" | "approved"

const state = {
  bankFile: "",
  name: "",
  bank: { sounds: {} } as Bank,
  review: emptyReview,
  selected: "",
  show: "all" as Show,
  search: "",
  toward: "wider" as Toward,
  count: 4,
  seed: 1,
  /** The layer open in the Layers section. */
  layer: 0,
  message: "",
  saving: "saved" as "saved" | "saving" | "failed",
  version: "",
  loaded: false
}

interface Checked {
  readonly measures: Measures
  readonly issues: ReadonlyArray<Issue>
}

/** Each sound's measures, against its kind's middle loudness from the whole bank. */
let checked = new Map<string, Checked>()
let middle: { readonly heavy: number | undefined; readonly other: number | undefined } = { heavy: undefined, other: undefined }

const recipeOf = (name: string): Recipe | undefined => state.bank.sounds[name]
const reviewOf = (name: string): SoundReview => state.review.sounds[name] ?? newSound
const names = (): Array<string> => Object.keys(state.bank.sounds)

/** Renders are cached by what they render, so playing and drawing never render twice. */
const renders = new Map<string, Rendered>()
const rendered = (recipe: Recipe): Rendered => {
  const key = JSON.stringify([state.bank.master ?? 1, recipe])
  let found = renders.get(key)
  if (found === undefined) {
    if (renders.size > 200) renders.clear()
    found = render(recipe, { master: state.bank.master })
    renders.set(key, found)
  }
  return found
}

const recheck = (name: string): void => {
  const recipe = recipeOf(name)
  if (recipe === undefined) return
  const measures = measure(rendered(recipe))
  checked.set(name, { measures, issues: issuesOf(recipe, measures, recipe.heavy === true ? middle.heavy : middle.other) })
}

const checkAll = (): void => {
  const report = checkBank(state.bank)
  middle = report.middle
  checked = new Map(report.sounds.map((sound) => [sound.name, { measures: sound, issues: sound.issues }]))
}

// ---------------------------------------------------------------------------
// Saving: the bank and the review go back to their files as they change

let bankDirty = false
let reviewDirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

const put = async (file: "bank" | "review", text: string): Promise<void> => {
  state.version = await store.save(file, text)
}

const flush = async (): Promise<void> => {
  saveTimer = undefined
  try {
    if (bankDirty) {
      bankDirty = false
      await put("bank", encodeBank(state.bank))
    }
    if (reviewDirty) {
      reviewDirty = false
      await put("review", encodeReview(state.review))
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

const history = makeHistory(
  () => `${encodeBank(state.bank)}\u0000${encodeReview(state.review)}`,
  (snapshot) => {
    const [bankText = "", reviewText = ""] = snapshot.split("\u0000")
    const bank = decodeBank(bankText)
    const review = decodeReview(reviewText)
    if (bank.ok) state.bank = bank.value
    if (review.ok) state.review = review.value
    recheck(state.selected)
    save({ bank: true, review: true })
    update()
  },
  () => renderTopbar()
)

/** Records a change: undoable, saved, and drawn. */
const changed = (what: { readonly bank?: boolean; readonly review?: boolean }): void => {
  if (what.bank === true) recheck(state.selected)
  save(what)
  history.schedule()
  update()
}

const setRecipe = (name: string, recipe: Recipe): void => {
  state.bank = { ...state.bank, sounds: { ...state.bank.sounds, [name]: recipe } }
}

const setReview = (name: string, entry: Partial<SoundReview>): void => {
  state.review = { sounds: { ...state.review.sounds, [name]: { ...reviewOf(name), ...entry } } }
}

// ---------------------------------------------------------------------------
// Loading, and following changes the agent makes while the page is open

const load = async (): Promise<void> => {
  const answer = await store.session()
  if (answer === undefined) return say("The server sent no bank.")
  const bank = decodeBank(answer.bankText)
  if (!bank.ok) return say(`The bank has problems: ${bank.error}`)
  const review = answer.reviewText === null ? undefined : decodeReview(answer.reviewText)
  state.bank = bank.value
  state.review = review?.ok === true ? review.value : emptyReview
  state.bankFile = answer.bank
  state.name = answer.name
  state.version = answer.version
  if (recipeOf(state.selected) === undefined) state.selected = names()[0] ?? ""
  checkAll()
  history.reset()
  history.schedule()
  state.loaded = true
  update()
}

const follow = async (): Promise<void> => {
  if (saveTimer !== undefined || state.saving === "saving") return
  try {
    const version = await store.version()
    if (version === undefined || version === state.version) return
    await load()
    say("The agent changed the bank: the page shows it now.")
  } catch {
    // The CLI was stopped; the page keeps what it has.
  }
}


// ---------------------------------------------------------------------------
// Playing

const player = makePlayer(() => drawWaves())

const playSound = (name: string): void => {
  const recipe = recipeOf(name)
  if (recipe !== undefined) player.play(rendered(recipe), name)
}

const playTake = (take: Take): void => player.play(rendered(take.recipe), `take:${take.id}`)

const toggle = (): void => {
  if (player.playing() !== undefined) player.stop()
  else playSound(state.selected)
}

const select = (name: string, play = false): void => {
  if (recipeOf(name) === undefined) return
  state.selected = name
  state.layer = 0
  update()
  // Only the list scrolls to the sound: on a phone the page around it stays put.
  const row = rows.querySelector(`[data-sound="${CSS.escape(name)}"]`)
  if (row instanceof HTMLElement) {
    if (row.offsetTop < rows.scrollTop) rows.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > rows.scrollTop + rows.clientHeight) rows.scrollTop = row.offsetTop + row.offsetHeight - rows.clientHeight
  }
  if (play) playSound(name)
}

const visible = (): Array<string> =>
  names().filter((name) => {
    if (state.show !== "all" && reviewOf(name).status !== state.show) return false
    const query = state.search.trim().toLowerCase()
    return query === "" || name.toLowerCase().includes(query) || (recipeOf(name)?.about ?? "").toLowerCase().includes(query)
  })

const step = (by: number): void => {
  const list = visible()
  if (list.length === 0) return
  const at = list.indexOf(state.selected)
  select(list[(at + by + list.length) % list.length]!, true)
}

const download = (rendered: Rendered, file: string): void => {
  const url = URL.createObjectURL(new Blob([toWav(rendered)], { type: "audio/wav" }))
  const link = h("a", { attrs: { href: url, download: file } })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// The page

const app = document.getElementById("app")!
const topbar = h("header", { class: "topbar" })
const list = h("aside", { class: "sounds", attrs: { "aria-label": "Sounds" } })
const content = h("div", { class: "sound-view" })
const playback = h("div", { class: "floating playback" })
const toast = h("div", { class: "toast", attrs: { role: "status", "aria-live": "polite" } })
const panels = h("aside", { class: "inspector", attrs: { "aria-label": "Settings" } })
const stage = h("div", { class: "stage" }, content, playback, toast)

app.append(topbar, h("main", { class: "layout lab" }, list, h("section", { class: "workspace" }, stage), panels))

/** Canvases to redraw while a sound plays, each with what it shows. */
let canvases: Array<{ readonly canvas: HTMLCanvasElement; readonly draw: () => void }> = []
const drawWaves = (): void => {
  for (const entry of canvases) entry.draw()
  renderPlayback()
}

const statusLabel: Record<Status, string> = { new: "To review", approved: "Approved", changes: "Changes asked" }

const count = (status: Status): number => names().filter((name) => reviewOf(name).status === status).length

const seconds = (value: number): string => (value < 1 ? `${Math.round(value * 1000)} ms` : `${Math.round(value * 100) / 100} s`)

const renderTopbar = (): void => {
  const total = names().length
  replace(
    topbar,
    h(
      "div",
      { class: "topbar-start" },
      h(
        "div",
        { class: "brand" },
        mark(),
        h("span", {}, "Sound lab"),
        h("a", { class: "by", title: "Ritmo, the agent-first type safe ECS runtime", attrs: { href: RITMO_URL, target: "_blank", rel: "noopener" } }, "by ", h("b", {}, "ritmo")),
        store.demo && cliChip("npx @typeonce/ritmo-tools sound review game.sounds.json", "Your coding agent can drive the sound lab on your game's own sounds: it writes and checks them, then opens this page for you to listen and leave notes it reads back.")
      ),
      state.loaded &&
        h(
          "div",
          { class: "file", title: state.bankFile },
          h("span", { class: "file-name" }, state.name),
          h("span", { class: "file-meta" }, `${total} sounds · ${count("approved")} approved`)
        )
    ),
    h(
      "div",
      { class: "topbar-center" },
      state.loaded &&
        segmented(
          state.show,
          [
            { id: "all", label: `All ${total}` },
            { id: "new", label: `To review ${count("new")}` },
            { id: "changes", label: `Changes ${count("changes")}` },
            { id: "approved", label: `Approved ${count("approved")}` }
          ],
          (show) => {
            state.show = show
            update()
          },
          { label: "Show" }
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
        { class: `save-state ${state.saving}`, title: store.demo ? "A demo: changes stay in this tab" : "Changes are written to the bank and its review as you make them" },
        state.saving === "saved" ? icon("check") : state.saving === "failed" ? icon("alert") : null,
        state.saving === "saved" ? (store.demo ? "Kept in this tab" : "Saved") : state.saving === "saving" ? "Saving…" : "Not saved"
      ),
      button(
        "WAV",
        () => {
          const recipe = recipeOf(state.selected)
          if (recipe !== undefined) download(rendered(recipe), `${state.selected}.wav`)
        },
        { variant: "primary", icon: "download", disabled: recipeOf(state.selected) === undefined, title: "Download this sound as a WAV file" }
      )
    )
  )
}

const statusDot = (status: Status): HTMLElement => h("span", { class: `dot ${status}`, title: statusLabel[status] })

const renderList = (): void => {
  const shown = visible()
  replace(
    list,
    h(
      "div",
      { class: "sounds-head" },
      h("label", { class: "input search" }, icon("search"), h("input", {
        props: { type: "search", value: state.search },
        attrs: { placeholder: "Find a sound", "aria-label": "Find a sound", spellcheck: "false" },
        on: {
          input: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLInputElement)) return
            state.search = target.value
            renderListRows()
          }
        }
      }))
    ),
    rows
  )
  renderListRows(shown)
}

const rows = h("div", { class: "sound-rows", attrs: { role: "listbox" } })

const renderListRows = (shown = visible()): void => {
  replace(
    rows,
    shown.length === 0 && h("p", { class: "hint empty-list" }, "No sound matches."),
    shown.map((name) => {
      const entry = reviewOf(name)
      const check = checked.get(name)
      const errors = check?.issues.some((issue) => issue.severity === "error") === true
      const warnings = check?.issues.length ?? 0
      return h(
        "div",
        {
          class: `sound-row${name === state.selected ? " on" : ""}`,
          attrs: { role: "option", "aria-selected": String(name === state.selected), "data-sound": name, tabindex: 0 },
          on: { click: () => select(name, true) }
        },
        statusDot(entry.status),
        h("span", { class: "sound-name" }, name),
        warnings > 0 && h("span", { class: `sound-flag ${errors ? "bad" : "warn"}`, title: check?.issues.map((issue) => issue.message).join("\n") }, icon("alert")),
        entry.takes.length > 0 && entry.picked === undefined && h("span", { class: "sound-takes", title: `${entry.takes.length} takes to choose from` }, `${entry.takes.length}`),
        h("span", { class: "sound-length" }, check === undefined ? "" : seconds(check.measures.duration))
      )
    })
  )
}

const LAYER_COLORS: Record<Layer["type"], string> = {
  tone: "#7aa2f7",
  noise: "#9aa0a9",
  swish: "#4cc38a",
  crunch: "#f0a843",
  metal: "#c0a6ff",
  click: "#ececef"
}

/** One wave canvas, drawn now and redrawn while it plays. */
const waveCanvas = (sound: Rendered, id: string, span: number, options: { readonly ruler?: boolean; readonly class: string }): HTMLCanvasElement => {
  const canvas = h("canvas", { class: options.class })
  const draw = (): void => {
    const playing = player.playing()
    drawWave(canvas, sound, {
      seconds: span,
      color: playing?.id === id ? "#f3f1ec" : "#bdbab3",
      playhead: playing?.id === id ? playing.at : undefined,
      ruler: options.ruler === true ? { line: "rgba(243, 241, 236, 0.07)", text: "rgba(243, 241, 236, 0.4)" } : undefined
    })
  }
  canvases.push({ canvas, draw })
  return canvas
}

const renderStage = (): void => {
  canvases = []
  const name = state.selected
  const recipe = recipeOf(name)
  if (recipe === undefined) {
    replace(content, h("div", { class: "empty-card lab-empty" }, h("div", { class: "empty-icon" }, mark()), h("h2", {}, state.loaded ? "No sounds in this bank" : "Opening the bank…")))
    return
  }
  const sound = rendered(recipe)
  const length = sound.samples.length / sound.sampleRate
  const entry = reviewOf(name)
  const takes = entry.takes
  const takeRenders = takes.map((take) => rendered(take.recipe))
  // The sound and its takes share one time scale, so lengths compare at a glance.
  const span = Math.max(0.2, length, ...takeRenders.map((take) => take.samples.length / take.sampleRate))
  const tuned = recipe.tune !== undefined && JSON.stringify(recipe.tune) !== JSON.stringify(neutralTune)
  // The bars show the layers as played: the tune folded in, on the wave's time scale.
  const layers = applyTune(recipe).layers
  const check = checked.get(name)

  replace(
    content,
    h(
      "div",
      { class: "sound-head" },
      h(
        "div",
        { class: "sound-title" },
        h("h1", {}, name),
        h("span", { class: `stage-pill ${entry.status}` }, statusLabel[entry.status]),
        recipe.heavy === true && h("span", { class: "stage-pill" }, "Heavy"),
        tuned && h("span", { class: "stage-pill tuned" }, "Tuned")
      ),
      recipe.about !== undefined && h("p", { class: "sound-about" }, recipe.about),
      check !== undefined &&
        h(
          "p",
          { class: "sound-stats" },
          h("span", {}, seconds(check.measures.duration)),
          h("span", {}, `${check.measures.loudness} dBFS loud`),
          h("span", {}, `peak ${check.measures.peak} dBFS`),
          h("span", {}, `${Math.round(check.measures.brightness)} Hz bright`)
        )
    ),
    h(
      "div",
      { class: "wave-card" },
      h(
        "div",
        { class: "lane mix" },
        h("span", { class: "lane-label", title: "Every layer together: the sound as the game plays it" }, "all"),
        waveCanvas(sound, name, span, { ruler: true, class: "wave big" })
      ),
      h(
        "div",
        { class: "lanes" },
        layers.map((layer, index) => {
          const start = layer.delay
          const end = layerEnd(layer)
          return h(
            "div",
            { class: `lane${state.layer === index ? " on" : ""}` },
            h("span", { class: "lane-label" }, h("span", { class: "lane-swatch", attrs: { style: `--color:${LAYER_COLORS[layer.type]}` } }), layer.type),
            h(
              "div",
              { class: "lane-track" },
              h(
                "button",
                {
                  class: "lane-bar",
                  title: `${describeLayer(layer)}, gain ${layer.gain}. Edit it under Layers.`,
                  attrs: {
                    type: "button",
                    style: `--color:${LAYER_COLORS[layer.type]};left:${(start / span) * 100}%;width:${Math.max(0.6, ((end - start) / span) * 100)}%;opacity:${0.45 + Math.min(1, layer.gain) * 0.55}`
                  },
                  on: {
                    click: () => {
                      state.layer = index
                      update()
                    }
                  }
                },
                h("span", {}, describeLayer(layer))
              )
            )
          )
        })
      )
    ),
    takes.length > 0 &&
      h(
        "div",
        { class: "takes" },
        h(
          "div",
          { class: "takes-head" },
          h("h2", {}, "Takes"),
          h("span", {}, `${towards.find((toward) => toward.id === (entry.toward ?? "wider"))?.label ?? ""} · pick the one that sounds right; it becomes the sound`)
        ),
        h(
          "div",
          { class: "take-grid" },
          takes.map((take, index) => {
            const picked = entry.picked === take.id
            const id = `take:${take.id}`
            return h(
              "div",
              { class: `take${picked ? " picked" : ""}${player.playing()?.id === id ? " playing" : ""}` },
              h(
                "button",
                { class: "take-play", title: `Play take ${index + 1} (${index + 1})`, attrs: { type: "button" }, on: { click: () => playTake(take) } },
                waveCanvas(takeRenders[index]!, id, span, { class: "wave small" })
              ),
              h(
                "div",
                { class: "take-foot" },
                h("span", { class: "take-number" }, String(index + 1)),
                h("span", { class: "take-label", title: take.label }, take.label),
                picked
                  ? h("span", { class: "take-picked" }, icon("check"), "In use")
                  : button("Use", () => useTake(take), { small: true, variant: "ghost", class: "take-use", title: "Make this take the sound" })
              )
            )
          })
        )
      )
  )
  requestAnimationFrame(drawWaves)
}

const useTake = (take: Take): void => {
  const recipe = recipeOf(state.selected)
  if (recipe === undefined) return
  setRecipe(state.selected, { ...take.recipe, about: recipe.about, heavy: recipe.heavy, interval: recipe.interval, tune: undefined })
  setReview(state.selected, { picked: take.id })
  say(`Take ${take.id.slice(1)} is the sound now. Undo puts the old one back.`)
  changed({ bank: true, review: true })
  playTake(take)
}

const renderPlayback = (): void => {
  const playing = player.playing()
  const recipe = recipeOf(state.selected)
  playback.hidden = recipe === undefined
  if (recipe === undefined) return
  const length = rendered(recipe).samples.length / 44100
  const label = playing === undefined ? `${state.selected} · ${seconds(length)}` : `${playing.id.startsWith("take:") ? `take ${playing.id.slice(6)}` : playing.id} · ${(Math.round(playing.at * 100) / 100).toFixed(2)} s`
  if (playback.dataset.label === label && playback.dataset.on === String(playing !== undefined)) return
  playback.dataset.label = label
  playback.dataset.on = String(playing !== undefined)
  replace(
    playback,
    button("Previous sound", () => step(-1), { variant: "ghost", icon: "previous", iconOnly: true, title: "Previous sound (↑)" }),
    button(playing === undefined ? "Play" : "Stop", toggle, { variant: "ghost", icon: playing === undefined ? "play" : "pause", iconOnly: true, title: "Play (Space)" }),
    button("Next sound", () => step(1), { variant: "ghost", icon: "next", iconOnly: true, title: "Next sound (↓)" }),
    h("span", { class: "divider" }),
    h("span", { class: "frame-counter" }, label)
  )
}

// ---------------------------------------------------------------------------
// The inspector

const statusOptions: ReadonlyArray<{ readonly id: Status; readonly label: string; readonly icon: "sparkle" | "check" | "alert"; readonly title: string }> = [
  { id: "new", label: "To review", icon: "sparkle", title: "Not reviewed yet" },
  { id: "approved", label: "Approved", icon: "check", title: "It sounds right" },
  { id: "changes", label: "Changes", icon: "alert", title: "Ask the agent for changes: say what in the note" }
]

const reviewPanel = (name: string): HTMLElement => {
  const entry = reviewOf(name)
  return section(
    {
      id: "review",
      title: "Review",
      help: "Approve the sound, or ask for changes and say what in your own words (\"too thin\", \"more crunch, less ring\"). The agent reads every note with `ritmo-tools sound notes`.",
      onToggle: update
    },
    segmented(
      entry.status,
      statusOptions,
      (status) => {
        setReview(name, { status })
        changed({ review: true })
      },
      { label: "Status", class: "fill" }
    ),
    h(
      "label",
      { class: "input note" },
      h("textarea", {
        props: { value: entry.note, rows: 3 },
        attrs: { placeholder: entry.status === "changes" ? "What should change?" : "A note for the agent (optional)", "aria-label": "Note" },
        on: {
          input: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLTextAreaElement)) return
            setReview(name, { note: target.value })
            save({ review: true })
            history.schedule()
            renderTopbar()
          }
        }
      })
    )
  )
}

const checkPanel = (name: string): HTMLElement => {
  const check = checked.get(name)
  const errors = check?.issues.filter((issue) => issue.severity === "error") ?? []
  return section(
    {
      id: "check",
      title: "Check",
      help: "What can be measured without listening: the same numbers `ritmo-tools sound check` gives the agent. Loudness is compared with the middle of the bank's sounds of the same kind (heavy, or the rest).",
      onToggle: update,
      action: check === undefined ? undefined : badge(errors.length > 0 ? "Errors" : check.issues.length > 0 ? "Warnings" : "Clean", errors.length > 0 ? "bad" : check.issues.length > 0 ? "warn" : "good")
    },
    check === undefined
      ? hint("Measuring…")
      : [
          prop("Length", h("span", { class: "value" }, seconds(check.measures.duration))),
          prop("Loudness", h("span", { class: "value" }, `${check.measures.loudness} dBFS`), "The loudest 50 ms"),
          prop("Peak", h("span", { class: "value" }, `${check.measures.peak} dBFS`), "The loudest sample: above 0 clips"),
          prop("Attack", h("span", { class: "value" }, `${check.measures.attack} ms`), "How long until it is heard"),
          prop("Brightness", h("span", { class: "value" }, `${Math.round(check.measures.brightness)} Hz`), "Low for thuds, high for hiss"),
          prop("Ending", h("span", { class: "value" }, `${check.measures.ending} dBFS`), "Loud here means a click at the end"),
          check.issues.length === 0
            ? callout("good", "Nothing to fix.")
            : h(
                "ul",
                { class: "issues" },
                check.issues.map((issue) => h("li", { class: issue.severity }, icon("alert"), h("span", {}, issue.message)))
              )
        ]
  )
}

const TUNES: ReadonlyArray<{ readonly key: keyof Tune; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly show: (value: number) => string; readonly title: string }> = [
  { key: "pitch", label: "Pitch", min: -12, max: 12, step: 0.5, show: (v) => `${v > 0 ? "+" : ""}${v} st`, title: "Every frequency, in semitones" },
  { key: "length", label: "Length", min: 0.5, max: 2, step: 0.05, show: (v) => `×${v.toFixed(2)}`, title: "Every duration and delay" },
  { key: "brightness", label: "Brightness", min: -12, max: 12, step: 0.5, show: (v) => `${v > 0 ? "+" : ""}${v} st`, title: "The noise's filters only: brighter or darker, the notes stay" },
  { key: "echo", label: "Echo", min: -0.5, max: 0.5, step: 0.01, show: (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`, title: "More or less of the room" },
  { key: "volume", label: "Volume", min: -12, max: 12, step: 0.5, show: (v) => `${v > 0 ? "+" : ""}${v} dB`, title: "Louder or quieter" }
]

const tunePanel = (name: string, recipe: Recipe): HTMLElement => {
  const tune = recipe.tune ?? neutralTune
  const neutral = JSON.stringify(tune) === JSON.stringify(neutralTune)
  return section(
    {
      id: "tune",
      title: "Tune",
      help: "Broad changes over the whole sound, kept apart from its layers in the bank (`tune`), so the agent sees exactly what you moved.",
      onToggle: update,
      action: button("Reset", () => {
        setRecipe(name, { ...recipe, tune: undefined })
        changed({ bank: true })
      }, { small: true, variant: "ghost", disabled: neutral })
    },
    TUNES.map((entry) =>
      sliderRow(
        entry.label,
        tune[entry.key],
        entry,
        entry.show,
        (value) => {
          const current = recipeOf(name)
          if (current === undefined) return
          setRecipe(name, { ...current, tune: { ...(current.tune ?? neutralTune), [entry.key]: value } })
          recheck(name)
          renderStage()
          renderPlayback()
        },
        () => {
          changed({ bank: true })
          playSound(name)
        },
        entry.title
      )
    )
  )
}

const takesPanel = (name: string, recipe: Recipe): HTMLElement => {
  const chosen = towards.find((entry) => entry.id === state.toward)
  return section(
    {
      id: "takes",
      title: "Takes",
      help: "Other versions of this sound to choose from, nudged one way and each a little different. Listen, then Use the one that sounds right. The agent makes them too, with `ritmo-tools sound vary`.",
      onToggle: update,
      closed: true
    },
    prop(
      "Toward",
      selectInput(
        state.toward,
        towards.map((entry) => ({ id: entry.id, label: entry.label })),
        (toward) => {
          state.toward = toward
          update()
        },
        "Toward"
      )
    ),
    chosen !== undefined && hint(chosen.hint),
    prop("Takes", numberInput(state.count, (value) => {
      state.count = Math.round(value)
      update()
    }, { min: 1, max: 12, step: 1, label: "How many takes" })),
    button(
      "Make takes",
      () => {
        state.seed += 1
        const takes = makeTakes(recipe, state.toward, state.count, state.seed)
        setReview(name, { takes, toward: state.toward, picked: undefined })
        changed({ review: true })
        say(`${takes.length} takes, ${chosen?.label.toLowerCase() ?? ""}: play them with 1 to ${Math.min(9, takes.length)}.`)
      },
      { variant: "primary", icon: "shuffle", class: "block" }
    )
  )
}

/** The numbers each kind of layer has, in the order they read. */
const FIELDS: Record<Layer["type"], ReadonlyArray<{ readonly key: string; readonly label: string; readonly step: number; readonly min: number; readonly max: number; readonly suffix?: string }>> = {
  tone: [
    { key: "from", label: "From", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "to", label: "To", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "duration", label: "Duration", step: 0.01, min: 0.001, max: 5, suffix: "s" },
    { key: "attack", label: "Attack", step: 0.001, min: 0.0005, max: 2, suffix: "s" }
  ],
  noise: [
    { key: "from", label: "From", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "to", label: "To", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "q", label: "Q", step: 0.1, min: 0.0001, max: 40 },
    { key: "duration", label: "Duration", step: 0.01, min: 0.001, max: 5, suffix: "s" },
    { key: "attack", label: "Attack", step: 0.001, min: 0.0005, max: 2, suffix: "s" }
  ],
  swish: [
    { key: "low", label: "Low", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "peak", label: "Peak", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "peakAt", label: "Peak at", step: 0.05, min: 0, max: 1 },
    { key: "q", label: "Q", step: 0.1, min: 0.0001, max: 40 },
    { key: "duration", label: "Duration", step: 0.01, min: 0.001, max: 5, suffix: "s" }
  ],
  crunch: [
    { key: "from", label: "From", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "to", label: "To", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "duration", label: "Duration", step: 0.01, min: 0.001, max: 5, suffix: "s" }
  ],
  metal: [
    { key: "pitch", label: "Pitch", step: 1, min: 20, max: 20000, suffix: "Hz" },
    { key: "duration", label: "Duration", step: 0.01, min: 0.001, max: 5, suffix: "s" }
  ],
  click: []
}

const numberOf = (layer: Layer, key: string): number => {
  const value: unknown = Reflect.get(layer, key)
  return typeof value === "number" ? value : 0
}

const layersPanel = (name: string, recipe: Recipe): HTMLElement => {
  const edit = (index: number, next: Layer): void => {
    setRecipe(name, { ...recipe, layers: recipe.layers.map((layer, i) => (i === index ? next : layer)) })
    changed({ bank: true })
  }
  const open = Math.min(state.layer, recipe.layers.length - 1)
  const layer = recipe.layers[open]
  return section(
    {
      id: "layers",
      title: "Layers",
      help: "The recipe itself: the room, and each layer's numbers. Pick a layer here or on its bar over the stage.",
      onToggle: update,
      closed: true,
      action: h("span", { class: "meta" }, `${recipe.layers.length}`)
    },
    sliderRow("Room", recipe.reverb, { min: 0, max: 1, step: 0.01 }, (v) => `${Math.round(v * 100)}%`, (reverb) => {
      setRecipe(name, { ...recipe, reverb })
      recheck(name)
      renderStage()
    }, () => changed({ bank: true }), "How much of the sound goes to the room"),
    switchRow("Heavy", recipe.heavy === true, (heavy) => {
      setRecipe(name, { ...recipe, heavy: heavy ? true : undefined })
      changed({ bank: true })
    }, "A heavy sound turns the others down for a moment in the game"),
    recipe.layers.length > 0 &&
      h(
        "div",
        { class: "layer-tabs" },
        recipe.layers.map((entry, index) =>
          h(
            "button",
            {
              class: `layer-tab${index === open ? " on" : ""}`,
              attrs: { type: "button", style: `--color:${LAYER_COLORS[entry.type]}` },
              on: {
                click: () => {
                  state.layer = index
                  update()
                }
              }
            },
            h("span", { class: "lane-swatch" }),
            entry.type
          )
        )
      ),
    layer !== undefined &&
      group(
        describeLayer(layer),
        layer.type === "tone" &&
          prop("Wave", selectInput<Wave>(layer.wave, waves.map((wave) => ({ id: wave, label: wave })), (wave) => edit(open, { ...layer, wave }), "Wave")),
        layer.type === "noise" &&
          prop("Filter", selectInput<NoiseFilter>(layer.filter, filters.map((filter) => ({ id: filter, label: filter })), (filter) => edit(open, { ...layer, filter }), "Filter")),
        FIELDS[layer.type].map((field) =>
          prop(
            field.label,
            numberInput(numberOf(layer, field.key), (value) => edit(open, { ...layer, [field.key]: value }), {
              min: field.min,
              max: field.max,
              step: field.step,
              label: field.label,
              ...(field.suffix === undefined ? {} : { suffix: field.suffix })
            })
          )
        ),
        prop("Gain", numberInput(layer.gain, (gain) => edit(open, { ...layer, gain }), { min: 0, max: 4, step: 0.01, label: "Gain" })),
        prop("Delay", numberInput(layer.delay, (delay) => edit(open, { ...layer, delay }), { min: 0, max: 5, step: 0.01, label: "Delay", suffix: "s" }))
      )
  )
}

const aboutPanel = (): HTMLElement =>
  h(
    "footer",
    { class: "about" },
    h("div", { class: "ruler", attrs: { "aria-hidden": "true" } }),
    h("div", { class: "about-head" }, mark(), "Sound lab, by Ritmo"),
    h(
      "p",
      {},
      "Game sounds as JSON recipes. Agents check, render, and vary them from the command line: ",
      h("code", {}, "ritmo-tools sound check"),
      ", ",
      h("code", {}, "ritmo-tools sound vary"),
      ", ",
      h("code", {}, "ritmo-tools sound notes"),
      ". What you pick, tune, and note here is saved to ",
      h("code", {}, state.name),
      " and its review.",
      store.demo && [" This demo keeps it in the tab. To open your own bank: ", h("code", {}, "npx @typeonce/ritmo-tools sound review game.sounds.json"), "."]
    )
  )

const renderPanels = (): void => {
  const recipe = recipeOf(state.selected)
  const scroll = panels.scrollTop
  replace(
    panels,
    recipe !== undefined && [reviewPanel(state.selected), checkPanel(state.selected), takesPanel(state.selected, recipe), tunePanel(state.selected, recipe), layersPanel(state.selected, recipe)],
    aboutPanel()
  )
  panels.scrollTop = scroll
}

// ---------------------------------------------------------------------------
// Messages

let toastTimer: ReturnType<typeof setTimeout> | undefined

function say(message: string): void {
  state.message = message
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  replace(
    toast,
    h("span", {}, message),
    button("Dismiss", () => toast.classList.remove("on"), { variant: "ghost", icon: "close", iconOnly: true, small: true })
  )
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

// Space plays, the arrows move through the list, 1 to 9 play the takes; Ctrl/Cmd+Z undoes.
window.addEventListener("keydown", (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox") return
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault()
    if (event.shiftKey) history.redo()
    else history.undo()
  } else if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault()
    history.redo()
  } else if (event.key === " ") {
    event.preventDefault()
    toggle()
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    step(event.key === "ArrowDown" ? 1 : -1)
  } else if (/^[1-9]$/.test(event.key) && !mod) {
    const take = reviewOf(state.selected).takes[Number(event.key) - 1]
    if (take !== undefined) playTake(take)
  }
})

window.addEventListener("resize", () => drawWaves())

/** Draws the page and loads the bank from where `chosen` keeps it, on the sound `first` (the bank's first when missing); follows the agent's changes when it can make them. */
export const start = (chosen: Store, first = ""): void => {
  store = chosen
  state.selected = first
  update()
  void load()
  if (store.follows) setInterval(() => void follow(), 1500)
}
