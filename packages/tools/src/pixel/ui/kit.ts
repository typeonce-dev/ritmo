/**
 * The page's controls, one look for each kind: icons, buttons, property rows
 * (a label on the left, its control on the right), switches, sliders,
 * segmented controls, and collapsible inspector sections. Panels build from
 * these, never from bare inputs, so spacing and sizes stay the same
 * everywhere.
 */
import { evaluate } from "../core/math.ts"
import { h } from "./dom.ts"

type Child = Node | string | false | undefined | null

// ---------------------------------------------------------------------------
// Icons (24×24, stroked, in the style of Lucide)

const paths = {
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  erase: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  restore:
    '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  pick: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  open: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  sparkle: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  lines: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  brush: '<path d="m14.6 3.4 6 6L10 20H4v-6z"/><path d="m12 6 6 6"/>',
  pixel: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  area: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  previous: '<path d="M19 20 9 12l10-8v16zM5 19V5"/>',
  next: '<path d="m5 4 10 8-10 8V4zM19 5v14"/>',
  frames: '<rect x="2" y="6" width="6" height="12" rx="1"/><rect x="9" y="6" width="6" height="12" rx="1"/><rect x="16" y="6" width="6" height="12" rx="1"/>',
  onion: '<rect x="3" y="3" width="13" height="13" rx="2" stroke-dasharray="2 2"/><rect x="8" y="8" width="13" height="13" rx="2"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',
  volume:
    '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.7"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  wave: '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>',
  shuffle:
    '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.46-7.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.97a4 4 0 0 1 3.3 1.7l.67.94"/><path d="M22 18h-6.03a4 4 0 0 1-3.3-1.7l-.67-.94"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
} as const

export type IconName = keyof typeof paths

/** An inline icon, sized by the surrounding font (1.15em) and colored by `currentColor`. */
export const icon = (name: IconName): HTMLElement => {
  const span = h("span", { class: "icon", attrs: { "aria-hidden": "true" } })
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`
  return span
}

/**
 * Ritmo's mark (brand/assets/ritmo-icon.svg): three blocks in the text color
 * and the one cell that changes, in Tick.
 */
export const mark = (): HTMLElement => {
  const span = h("span", { class: "mark", attrs: { "aria-hidden": "true" } })
  span.innerHTML =
    '<svg viewBox="0 0 100 100"><g fill="currentColor"><rect x="6" y="6" width="40" height="40" rx="6"/><rect x="54" y="6" width="40" height="40" rx="6"/><rect x="6" y="54" width="40" height="40" rx="6"/></g><rect x="62" y="62" width="24" height="24" rx="4" fill="#FF5A36"/></svg>'
  return span
}

// ---------------------------------------------------------------------------
// Buttons

export type Variant = "primary" | "secondary" | "ghost" | "danger"

export interface ButtonOptions {
  readonly variant?: Variant
  readonly icon?: IconName
  readonly title?: string
  readonly disabled?: boolean
  readonly pressed?: boolean
  readonly small?: boolean
  /** Icon only: the label becomes the accessible name and the tooltip. */
  readonly iconOnly?: boolean
  readonly class?: string
}

export const button = (label: string, onClick: (event: MouseEvent) => void, options: ButtonOptions = {}): HTMLButtonElement => {
  const classes = ["btn", options.variant ?? "secondary"]
  if (options.small === true) classes.push("small")
  if (options.iconOnly === true) classes.push("icon-only")
  if (options.class !== undefined) classes.push(options.class)
  return h(
    "button",
    {
      class: classes.join(" "),
      title: options.title ?? (options.iconOnly === true ? label : undefined),
      attrs: {
        type: "button",
        disabled: options.disabled === true,
        "aria-pressed": options.pressed === undefined ? undefined : String(options.pressed),
        "aria-label": options.iconOnly === true ? label : undefined
      },
      on: { click: onClick }
    },
    options.icon !== undefined && icon(options.icon),
    options.iconOnly !== true && h("span", {}, label)
  )
}

/** A row of choices, one of them on: views, tools, and small enumerations. */
export const segmented = <T extends string>(
  value: T,
  options: ReadonlyArray<{ readonly id: T; readonly label: string; readonly icon?: IconName; readonly title?: string; readonly iconOnly?: boolean }>,
  onChange: (value: T) => void,
  extra: { readonly label?: string; readonly class?: string } = {}
): HTMLElement =>
  h(
    "div",
    { class: `segmented${extra.class === undefined ? "" : ` ${extra.class}`}`, attrs: { role: "group", "aria-label": extra.label } },
    options.map((option) =>
      h(
        "button",
        {
          class: option.id === value ? "on" : "",
          title: option.title ?? (option.iconOnly === true ? option.label : undefined),
          attrs: { type: "button", "aria-pressed": String(option.id === value), "aria-label": option.iconOnly === true ? option.label : undefined },
          on: { click: () => onChange(option.id) }
        },
        option.icon !== undefined && icon(option.icon),
        option.iconOnly !== true && h("span", {}, option.label)
      )
    )
  )

// ---------------------------------------------------------------------------
// Property rows: a label on the left, its control on the right

/** One property: `label` names it, `control` sets it. */
export const prop = (label: string, control: Child, title?: string): HTMLElement =>
  h("div", { class: "prop", title }, h("span", { class: "prop-label" }, label), h("div", { class: "prop-control" }, control))

/** Typed values keep this many decimals, so `1015/51` does not show fifteen digits. */
const DECIMALS = 1e4

/**
 * A number input; `prefix` is a short letter shown inside it ("W", "X").
 * It takes math (`1015/51`, or `*2` to double the value there), clamped to
 * `min` and `max`; ArrowUp and ArrowDown step by `step` (Shift: ten steps),
 * and Escape puts the value back. Emptied, it reports 0.
 */
export const numberInput = (
  value: number | undefined,
  onChange: (value: number) => void,
  options: {
    readonly min?: number
    readonly max?: number
    readonly step?: number
    readonly prefix?: string
    readonly label?: string
    readonly suffix?: string
    /** Shown when there is no value. */
    readonly placeholder?: string
  } = {}
): HTMLElement => {
  const shown = value === undefined ? "" : String(value)
  const clamp = (next: number): number =>
    Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, Math.round(next * DECIMALS) / DECIMALS))
  const commit = (target: HTMLInputElement, next: number): void => {
    const clamped = clamp(next)
    target.value = String(clamped)
    if (clamped !== value) onChange(clamped)
  }
  return h(
    "label",
    { class: "input" },
    options.prefix !== undefined && h("span", { class: "affix" }, options.prefix),
    h("input", {
      props: { type: "text", value: shown },
      attrs: {
        inputmode: "decimal",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: options.placeholder,
        "aria-label": options.label ?? options.prefix,
        title: "Math works: 1015/51, or *2 to double the value"
      },
      on: {
        change: (event) => {
          const target = event.currentTarget
          if (!(target instanceof HTMLInputElement)) return
          if (target.value.trim() === "") {
            onChange(0)
            return
          }
          const next = evaluate(target.value, value)
          if (next === undefined) target.value = shown
          else commit(target, next)
        },
        keydown: (event) => {
          const target = event.currentTarget
          if (!(target instanceof HTMLInputElement)) return
          if (event.key === "Enter") target.blur()
          else if (event.key === "Escape") {
            target.value = shown
            target.blur()
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault()
            const now = evaluate(target.value, value) ?? value ?? 0
            const step = (options.step ?? 0.01) * (event.shiftKey ? 10 : 1)
            commit(target, now + (event.key === "ArrowUp" ? step : -step))
          }
        }
      }
    }),
    options.suffix !== undefined && h("span", { class: "affix" }, options.suffix)
  )
}

export const textInput = (
  value: string,
  onChange: (value: string) => void,
  options: { readonly placeholder?: string; readonly label?: string } = {}
): HTMLElement =>
  h(
    "label",
    { class: "input" },
    h("input", {
      props: { type: "text", value },
      attrs: { placeholder: options.placeholder, "aria-label": options.label, spellcheck: "false" },
      on: {
        change: (event) => {
          const target = event.currentTarget
          if (target instanceof HTMLInputElement) onChange(target.value)
        },
        keydown: (event) => {
          if (event.key === "Enter" && event.currentTarget instanceof HTMLInputElement) event.currentTarget.blur()
        }
      }
    })
  )

export const selectInput = <T extends string>(
  value: T,
  options: ReadonlyArray<{ readonly id: T; readonly label: string }>,
  onChange: (value: T) => void,
  label?: string
): HTMLElement =>
  h(
    "label",
    { class: "input select" },
    h(
      "select",
      {
        attrs: { "aria-label": label },
        on: {
          change: (event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLSelectElement)) return
            const chosen = options.find((option) => option.id === target.value)
            if (chosen !== undefined) onChange(chosen.id)
          }
        }
      },
      options.map((option) => h("option", { props: { value: option.id, selected: option.id === value } }, option.label))
    ),
    icon("chevron")
  )

/** An on/off property, as a switch at the end of its row. */
export const switchRow = (label: string, checked: boolean, onChange: (checked: boolean) => void, title?: string): HTMLElement =>
  h(
    "label",
    { class: "switch-row", title },
    h("span", {}, label),
    h("input", {
      class: "switch",
      props: { type: "checkbox", checked },
      attrs: { role: "switch" },
      on: {
        change: (event) => {
          const target = event.currentTarget
          if (target instanceof HTMLInputElement) onChange(target.checked)
        }
      }
    })
  )

/**
 * A slider with its value at the end. `onInput` runs on every move (the
 * picture follows), `onCommit` once on release.
 */
export const sliderRow = (
  label: string,
  value: number,
  range: { readonly min: number; readonly max: number; readonly step: number },
  show: (value: number) => string,
  onInput: (value: number) => void,
  onCommit: () => void,
  title?: string
): HTMLElement => {
  const output = h("output", {}, show(value))
  const fill = (input: HTMLInputElement): void => {
    const share = (Number(input.value) - range.min) / Math.max(1e-9, range.max - range.min)
    input.style.setProperty("--fill", `${Math.round(share * 1000) / 10}%`)
  }
  const input = h("input", {
    class: "range",
    props: { type: "range", min: String(range.min), max: String(range.max), step: String(range.step), value: String(value) },
    attrs: { "aria-label": label },
    on: {
      input: (event) => {
        const target = event.currentTarget
        if (!(target instanceof HTMLInputElement)) return
        output.textContent = show(Number(target.value))
        fill(target)
        onInput(Number(target.value))
      },
      change: () => onCommit()
    }
  })
  fill(input)
  return h("div", { class: "prop slider", title }, h("span", { class: "prop-label" }, label), h("div", { class: "prop-control" }, input, output))
}

// ---------------------------------------------------------------------------
// Text

export const hint = (...children: Array<Child>): HTMLElement => h("p", { class: "hint" }, ...children)

export type Tone = "neutral" | "good" | "warn" | "bad" | "accent"

/** A short status in a colored pill. */
export const badge = (text: string, tone: Tone, iconName?: IconName): HTMLElement =>
  h("span", { class: `badge ${tone}` }, iconName !== undefined && icon(iconName), text)

/** A callout: a status line with an icon, for notes that matter (the grid found, a check's verdict). */
export const callout = (tone: Tone, ...children: Array<Child>): HTMLElement =>
  h("div", { class: `callout ${tone}` }, icon(tone === "good" ? "check" : tone === "neutral" || tone === "accent" ? "info" : "alert"), h("div", {}, ...children))

/** A color square. */
export const chip = (hex: string, extra: { readonly class?: string; readonly title?: string } = {}): HTMLElement =>
  h("span", { class: `chip${extra.class === undefined ? "" : ` ${extra.class}`}`, title: extra.title ?? hex, attrs: { style: `--color:${hex}` } })

// ---------------------------------------------------------------------------
// Inspector sections

const SECTIONS_KEY = "ritmo-tools:sections"

/** The sections the person opened or closed, by id; the rest follow their default. */
const readChoices = (): Map<string, boolean> => {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    const parsed: unknown = raw === null ? {} : JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Map()
    return new Map(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
  } catch {
    return new Map()
  }
}

const choices = readChoices()
const helpOpen = new Set<string>()

const save = (): void => {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(Object.fromEntries(choices)))
  } catch {
    // Remembering which sections are open is a convenience only.
  }
}

export interface SectionOptions {
  readonly id: string
  readonly title: string
  /** A small control at the end of the header (Auto-detect, a count). */
  readonly action?: Child
  /** A longer explanation, shown under the header when its info button is pressed. */
  readonly help?: string
  /** Called after opening or closing, to redraw. */
  readonly onToggle: () => void
  /** Starts closed until the person opens it: for sections most visits do not need. */
  readonly closed?: boolean
}

/** A collapsible inspector section, remembered across visits. */
export const section = (options: SectionOptions, ...children: Array<Child | ReadonlyArray<Child>>): HTMLElement => {
  const open = choices.get(options.id) ?? options.closed !== true
  const showHelp = helpOpen.has(options.id)
  return h(
    "section",
    { class: `section${open ? "" : " closed"}`, attrs: { "data-section": options.id } },
    h(
      "header",
      { class: "section-head" },
      h(
        "button",
        {
          class: "section-toggle",
          attrs: { type: "button", "aria-expanded": String(open) },
          on: {
            click: () => {
              choices.set(options.id, !open)
              save()
              options.onToggle()
            }
          }
        },
        icon("chevron"),
        h("h2", {}, options.title)
      ),
      open &&
        options.help !== undefined &&
        h(
          "button",
          {
            class: `btn ghost icon-only small${showHelp ? " on" : ""}`,
            title: showHelp ? "Hide help" : "What is this?",
            attrs: { type: "button", "aria-pressed": String(showHelp), "aria-label": "Help" },
            on: {
              click: () => {
                if (showHelp) helpOpen.delete(options.id)
                else helpOpen.add(options.id)
                options.onToggle()
              }
            }
          },
          icon("info")
        ),
      open && options.action !== undefined && h("div", { class: "section-action" }, options.action)
    ),
    open && h("div", { class: "section-body" }, showHelp && options.help !== undefined && h("p", { class: "help" }, options.help), ...children.flat())
  )
}

/** Opens a section (when it was closed) and scrolls it into view. */
export const reveal = (id: string, onToggle: () => void): void => {
  if (document.querySelector(`[data-section="${id}"]`)?.classList.contains("closed") === true) {
    choices.set(id, true)
    save()
    onToggle()
  }
  requestAnimationFrame(() => document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }))
}

/** A titled group of rows inside a section. */
export const group = (title: string, ...children: Array<Child | ReadonlyArray<Child>>): HTMLElement =>
  h("div", { class: "group" }, h("h3", {}, title), ...children.flat())
