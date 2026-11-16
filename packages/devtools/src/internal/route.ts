/**
 * The route file `ritmo-devtools keyboard` and `ritmo-devtools layout` both
 * read: the screens of a game's page, how to reach each one, and what each
 * walk needs to know about them. Each walk ignores the fields that belong to
 * the other (`noPress` is the keyboard walk's; `viewports`, `minTarget`, and
 * `allow` are the layout audit's), so one route serves both.
 *
 * @internal
 */
import * as Result from "@typeonce/ritmo/Result"

/** A control a route names: by accessible name, and by role when given. */
export interface ControlName {
  readonly name: string
  readonly role?: string
}

/** One thing a route does to reach a screen. */
export type Step =
  | { readonly press: string }
  | { readonly type: string }
  | { readonly click: { readonly role: string; readonly name: string } }
  | { readonly waitFor: { readonly role: string; readonly name: string } }
  | { readonly wait: number }

/** The layout audit's checks that a route may allow, by selector. */
export type LayoutCheckId =
  | "overlap"
  | "cut-text"
  | "off-screen"
  | "safe-area"
  | "small-target"
  | "layout-shift"
  | "truncated-text"
  | "scroll-edge"

export const layoutChecks: ReadonlyArray<LayoutCheckId> = ["overlap", "cut-text", "off-screen", "safe-area", "small-target", "layout-shift", "truncated-text", "scroll-edge"]

const isLayoutCheck = (value: unknown): value is LayoutCheckId => typeof value === "string" && (layoutChecks as ReadonlyArray<string>).includes(value)

/**
 * A finding the game means: the layout audit does not report a finding of
 * `check` whose element (or the other element of an overlap) matches
 * `selector` or is inside an element that does.
 */
export interface Allow {
  readonly check: LayoutCheckId
  readonly selector: string
}

/** One screen of the walk: where it starts, how to reach it, what not to press, and what is meant. */
export interface Screen {
  readonly name: string
  /** Appended to the URL: `/`, `?map=8`, `#settings`. */
  readonly path: string
  readonly steps: ReadonlyArray<Step>
  /** `true` presses nothing on this screen (no `focus-dropped`); a list skips those controls. */
  readonly noPress: true | ReadonlyArray<ControlName>
  /** Layout findings the game means on this screen (with the route's own `allow`). */
  readonly allow: ReadonlyArray<Allow>
}

/** Space the device keeps for itself on each side (a notch, a home bar), in CSS pixels. */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** A screen size the layout audit measures every screen at. */
export interface Viewport {
  readonly name: string
  readonly width: number
  readonly height: number
  /** A touch screen (a phone or a tablet): `hasTouch` and a mobile viewport. */
  readonly touch: boolean
  readonly insets: Insets
}

export interface Route {
  readonly screens: ReadonlyArray<Screen>
  /** The sizes the layout audit measures at (`defaultViewports` when the route names none). */
  readonly viewports: ReadonlyArray<Viewport>
  /** The smallest tap area, in CSS pixels, either side (44 by default). */
  readonly minTarget: number
  /** Layout findings the game means on every screen. */
  readonly allow: ReadonlyArray<Allow>
}

const noInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * A small phone and a phone with a notch, held sideways and upright, and a
 * desktop window. The notch insets are an iPhone's (the camera on one side
 * when sideways, at the top when upright, and the home bar at the bottom).
 */
export const defaultViewports: ReadonlyArray<Viewport> = [
  { name: "small-phone-landscape", width: 667, height: 375, touch: true, insets: noInsets },
  { name: "phone-landscape", width: 844, height: 390, touch: true, insets: { top: 0, right: 47, bottom: 21, left: 47 } },
  { name: "phone-portrait", width: 390, height: 844, touch: true, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: "desktop", width: 1280, height: 800, touch: false, insets: noInsets }
]

/** The route of a game that writes none: the start page, as one screen. */
export const startRoute: Route = {
  screens: [{ name: "start", path: "", steps: [], noPress: [], allow: [] }],
  viewports: defaultViewports,
  minTarget: 44,
  allow: []
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const onlyKeys = (value: Record<string, unknown>, keys: ReadonlyArray<string>, at: string): string | undefined => {
  const extra = Object.keys(value).find((key) => !keys.includes(key))
  return extra === undefined ? undefined : `${at}.${extra} is not a field (expected ${keys.join(", ")})`
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

const wholeIn = (value: unknown, least: number, most: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= least && value <= most

const parseControlName = (value: unknown, at: string): Result.Result<ControlName, string> => {
  if (!isRecord(value)) return Result.failure(`${at} must be an object { "name": string, "role"?: string }`)
  const extra = onlyKeys(value, ["name", "role"], at)
  if (extra !== undefined) return Result.failure(extra)
  if (!nonEmpty(value["name"])) return Result.failure(`${at}.name must be a non-empty string: the control's accessible name`)
  if (value["role"] !== undefined && !nonEmpty(value["role"])) return Result.failure(`${at}.role must be a non-empty string when given: an ARIA role such as "button"`)
  return Result.success(value["role"] === undefined ? { name: value["name"] } : { name: value["name"], role: value["role"] })
}

const stepKinds = `{ "press": "Escape" }, { "type": "Ada" }, { "click": { "role": "button", "name": "Play" } }, { "waitFor": { "role": "button", "name": "Play" } }, { "wait": 500 }`

const parseStep = (value: unknown, at: string): Result.Result<Step, string> => {
  if (!isRecord(value) || Object.keys(value).length !== 1) return Result.failure(`${at} must be one of ${stepKinds}`)
  if ("press" in value) {
    return nonEmpty(value["press"]) ? Result.success({ press: value["press"] }) : Result.failure(`${at}.press must be a key name, as Playwright's keyboard.press takes it ("Enter", "Escape", "a")`)
  }
  if ("type" in value) {
    return typeof value["type"] === "string" && value["type"] !== "" ? Result.success({ type: value["type"] }) : Result.failure(`${at}.type must be the text to type into the focused field ("Ada")`)
  }
  if ("wait" in value) {
    const wait = value["wait"]
    return wholeIn(wait, 0, 60_000) ? Result.success({ wait }) : Result.failure(`${at}.wait must be a whole number of milliseconds from 0 to 60000`)
  }
  for (const kind of ["click", "waitFor"] as const) {
    if (!(kind in value)) continue
    const named = value[kind]
    if (!isRecord(named)) return Result.failure(`${at}.${kind} must be an object { "role": string, "name": string }`)
    const extra = onlyKeys(named, ["role", "name"], `${at}.${kind}`)
    if (extra !== undefined) return Result.failure(extra)
    if (!nonEmpty(named["role"])) return Result.failure(`${at}.${kind}.role must be a non-empty string: an ARIA role such as "button"`)
    if (!nonEmpty(named["name"])) return Result.failure(`${at}.${kind}.name must be a non-empty string: the control's accessible name`)
    const control = { role: named["role"], name: named["name"] }
    return Result.success(kind === "click" ? { click: control } : { waitFor: control })
  }
  return Result.failure(`${at} must be one of ${stepKinds}; ${Object.keys(value)[0]} is not a step`)
}

const parseAllow = (value: unknown, at: string): Result.Result<ReadonlyArray<Allow>, string> => {
  const raw = value ?? []
  if (!Array.isArray(raw)) return Result.failure(`${at} must be an array of { "check", "selector" }`)
  const allow: Array<Allow> = []
  for (const [index, entry] of raw.entries()) {
    const where = `${at}[${index}]`
    if (!isRecord(entry)) return Result.failure(`${where} must be an object { "check": string, "selector": string }`)
    const extra = onlyKeys(entry, ["check", "selector"], where)
    if (extra !== undefined) return Result.failure(extra)
    if (!isLayoutCheck(entry["check"])) return Result.failure(`${where}.check must be one of ${layoutChecks.join(", ")}`)
    if (!nonEmpty(entry["selector"])) return Result.failure(`${where}.selector must be a CSS selector of the element the finding names, such as ".card .badge"`)
    allow.push({ check: entry["check"], selector: entry["selector"] })
  }
  return Result.success(allow)
}

const parseScreen = (value: unknown, at: string): Result.Result<Screen, string> => {
  if (!isRecord(value)) return Result.failure(`${at} must be an object { "name", "path"?, "steps"?, "noPress"?, "allow"? }`)
  const extra = onlyKeys(value, ["name", "path", "steps", "noPress", "allow"], at)
  if (extra !== undefined) return Result.failure(extra)
  if (!nonEmpty(value["name"])) return Result.failure(`${at}.name must be a non-empty string`)
  const path = value["path"] ?? ""
  if (typeof path !== "string") return Result.failure(`${at}.path must be a string appended to the URL ("/", "?map=8")`)
  const rawSteps = value["steps"] ?? []
  if (!Array.isArray(rawSteps)) return Result.failure(`${at}.steps must be an array`)
  const steps: Array<Step> = []
  for (const [index, raw] of rawSteps.entries()) {
    const step = parseStep(raw, `${at}.steps[${index}]`)
    if (!step.ok) return step
    steps.push(step.value)
  }
  const allow = parseAllow(value["allow"], `${at}.allow`)
  if (!allow.ok) return allow
  const rawNoPress = value["noPress"] ?? []
  if (rawNoPress === true) return Result.success({ name: value["name"], path, steps, noPress: true, allow: allow.value })
  if (!Array.isArray(rawNoPress)) return Result.failure(`${at}.noPress must be true (press nothing on this screen) or an array of { "name", "role"? }`)
  const noPress: Array<ControlName> = []
  for (const [index, raw] of rawNoPress.entries()) {
    const control = parseControlName(raw, `${at}.noPress[${index}]`)
    if (!control.ok) return control
    noPress.push(control.value)
  }
  return Result.success({ name: value["name"], path, steps, noPress, allow: allow.value })
}

const parseViewport = (value: unknown, at: string): Result.Result<Viewport, string> => {
  if (!isRecord(value)) return Result.failure(`${at} must be an object { "name", "width", "height", "touch"?, "insets"? }`)
  const extra = onlyKeys(value, ["name", "width", "height", "touch", "insets"], at)
  if (extra !== undefined) return Result.failure(extra)
  if (!nonEmpty(value["name"])) return Result.failure(`${at}.name must be a non-empty string`)
  if (!wholeIn(value["width"], 200, 4000)) return Result.failure(`${at}.width must be a whole number of CSS pixels from 200 to 4000`)
  if (!wholeIn(value["height"], 200, 4000)) return Result.failure(`${at}.height must be a whole number of CSS pixels from 200 to 4000`)
  const touch = value["touch"] ?? false
  if (typeof touch !== "boolean") return Result.failure(`${at}.touch must be true (a phone or tablet) or false`)
  const rawInsets = value["insets"] ?? noInsets
  if (!isRecord(rawInsets)) return Result.failure(`${at}.insets must be an object { "top", "right", "bottom", "left" } of CSS pixels`)
  const insetsExtra = onlyKeys(rawInsets, ["top", "right", "bottom", "left"], `${at}.insets`)
  if (insetsExtra !== undefined) return Result.failure(insetsExtra)
  const sides = ["top", "right", "bottom", "left"] as const
  for (const side of sides) {
    if (!wholeIn(rawInsets[side] ?? 0, 0, 200)) return Result.failure(`${at}.insets.${side} must be a whole number of CSS pixels from 0 to 200`)
  }
  const inset = (side: (typeof sides)[number]): number => {
    const given = rawInsets[side]
    return typeof given === "number" ? given : 0
  }
  return Result.success({
    name: value["name"],
    width: value["width"],
    height: value["height"],
    touch,
    insets: { top: inset("top"), right: inset("right"), bottom: inset("bottom"), left: inset("left") }
  })
}

/** Validates a route file's JSON; the error names the field that is wrong. */
export const parseRoute = (value: unknown): Result.Result<Route, string> => {
  if (!isRecord(value)) return Result.failure(`the route must be an object { "screens": [...] }`)
  const extra = onlyKeys(value, ["screens", "viewports", "minTarget", "allow"], "route")
  if (extra !== undefined) return Result.failure(extra)
  const raw = value["screens"]
  if (!Array.isArray(raw) || raw.length === 0) return Result.failure(`route.screens must be a non-empty array`)
  const screens: Array<Screen> = []
  for (const [index, entry] of raw.entries()) {
    const screen = parseScreen(entry, `route.screens[${index}]`)
    if (!screen.ok) return screen
    if (screens.some((other) => other.name === screen.value.name)) return Result.failure(`route.screens[${index}].name "${screen.value.name}" is already the name of another screen`)
    screens.push(screen.value)
  }
  let viewports = defaultViewports
  if (value["viewports"] !== undefined) {
    const rawViewports = value["viewports"]
    if (!Array.isArray(rawViewports) || rawViewports.length === 0) return Result.failure(`route.viewports must be a non-empty array of { "name", "width", "height", "touch"?, "insets"? }`)
    const parsed: Array<Viewport> = []
    for (const [index, entry] of rawViewports.entries()) {
      const viewport = parseViewport(entry, `route.viewports[${index}]`)
      if (!viewport.ok) return viewport
      if (parsed.some((other) => other.name === viewport.value.name)) return Result.failure(`route.viewports[${index}].name "${viewport.value.name}" is already the name of another viewport`)
      parsed.push(viewport.value)
    }
    viewports = parsed
  }
  const minTarget = value["minTarget"] ?? 44
  if (!wholeIn(minTarget, 1, 200)) return Result.failure(`route.minTarget must be a whole number of CSS pixels from 1 to 200 (the smallest tap area either side)`)
  const allow = parseAllow(value["allow"], "route.allow")
  if (!allow.ok) return allow
  return Result.success({ screens, viewports, minTarget, allow: allow.value })
}

/** Joins a screen's path to the base URL, keeping the base's own path. */
export const screenUrl = (base: string, path: string): string => {
  if (path === "") return base
  if (path.startsWith("?") || path.startsWith("#")) return base.replace(/[?#].*$/, "") + path
  return new URL(path, base).href
}
