/**
 * `ritmo-devtools keyboard`: plays a game's page by keyboard in Chromium and
 * checks what a keyboard player relies on, on each screen of a route.
 *
 * Six checks, each decided per screen as passed, failed, or not checked
 * (with the reason), never passed by default:
 *
 * - `focus-outside-menu`: a menu is open and focus is outside it;
 * - `tab-leaves-menu`: Tab moves focus out of the open menu;
 * - `unnamed-control`: a control Tab reaches has no accessible name;
 * - `key-not-pressed`: Enter or Space on the focused control did not press
 *   it (the click is stopped, so this changes nothing);
 * - `focus-dropped`: pressing a control dropped focus to `<body>` (the
 *   control is pressed for real, after a reload of the screen);
 * - `unreachable-control`: a visible control neither Tab nor the arrows of
 *   its group reach.
 *
 * A menu is a `dialog:modal`, a shown `aria-modal="true"` element (the
 * `checkVisibility` test `Keyboard.actions` uses), or a shown dialog
 * (`<dialog open>`, `role="dialog"`, `role="alertdialog"`). Accessible names
 * come from Chromium's own accessibility tree.
 *
 * @internal
 */
import type * as PlaywrightTypes from "playwright"

import * as Result from "@typeonce/ritmo/Result"

import { pageScript } from "./keyboardPage.ts"

/** A control a route names: by accessible name, and by role when given. */
export interface ControlName {
  readonly name: string
  readonly role?: string
}

/** One thing a route does to reach a screen. */
export type Step =
  | { readonly press: string }
  | { readonly click: { readonly role: string; readonly name: string } }
  | { readonly wait: number }

/** One screen of the walk: where it starts, how to reach it, and what not to press. */
export interface Screen {
  readonly name: string
  /** Appended to the URL: `/`, `?map=8`, `#settings`. */
  readonly path: string
  readonly steps: ReadonlyArray<Step>
  /** `true` presses nothing on this screen (no `focus-dropped`); a list skips those controls. */
  readonly noPress: true | ReadonlyArray<ControlName>
}

export interface Route {
  readonly screens: ReadonlyArray<Screen>
}

/** The route of a game that writes none: the start page, as one screen. */
export const startRoute: Route = { screens: [{ name: "start", path: "", steps: [], noPress: [] }] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const onlyKeys = (value: Record<string, unknown>, keys: ReadonlyArray<string>, at: string): string | undefined => {
  const extra = Object.keys(value).find((key) => !keys.includes(key))
  return extra === undefined ? undefined : `${at}.${extra} is not a field (expected ${keys.join(", ")})`
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

const parseControlName = (value: unknown, at: string): Result.Result<ControlName, string> => {
  if (!isRecord(value)) return Result.failure(`${at} must be an object { "name": string, "role"?: string }`)
  const extra = onlyKeys(value, ["name", "role"], at)
  if (extra !== undefined) return Result.failure(extra)
  if (!nonEmpty(value["name"])) return Result.failure(`${at}.name must be a non-empty string: the control's accessible name`)
  if (value["role"] !== undefined && !nonEmpty(value["role"])) return Result.failure(`${at}.role must be a non-empty string when given: an ARIA role such as "button"`)
  return Result.success(value["role"] === undefined ? { name: value["name"] } : { name: value["name"], role: value["role"] })
}

const parseStep = (value: unknown, at: string): Result.Result<Step, string> => {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    return Result.failure(`${at} must be one of { "press": "Escape" }, { "click": { "role": "button", "name": "Play" } }, { "wait": 500 }`)
  }
  if ("press" in value) {
    return nonEmpty(value["press"]) ? Result.success({ press: value["press"] }) : Result.failure(`${at}.press must be a key name, as Playwright's keyboard.press takes it ("Enter", "Escape", "a")`)
  }
  if ("wait" in value) {
    const wait = value["wait"]
    return typeof wait === "number" && Number.isInteger(wait) && wait >= 0 && wait <= 60_000
      ? Result.success({ wait })
      : Result.failure(`${at}.wait must be a whole number of milliseconds from 0 to 60000`)
  }
  if ("click" in value) {
    const click = value["click"]
    if (!isRecord(click)) return Result.failure(`${at}.click must be an object { "role": string, "name": string }`)
    const extra = onlyKeys(click, ["role", "name"], `${at}.click`)
    if (extra !== undefined) return Result.failure(extra)
    if (!nonEmpty(click["role"])) return Result.failure(`${at}.click.role must be a non-empty string: an ARIA role such as "button"`)
    if (!nonEmpty(click["name"])) return Result.failure(`${at}.click.name must be a non-empty string: the control's accessible name`)
    return Result.success({ click: { role: click["role"], name: click["name"] } })
  }
  return Result.failure(`${at} must be one of { "press": ... }, { "click": ... }, { "wait": ... }; ${Object.keys(value)[0]} is not a step`)
}

const parseScreen = (value: unknown, at: string): Result.Result<Screen, string> => {
  if (!isRecord(value)) return Result.failure(`${at} must be an object { "name", "path"?, "steps"?, "noPress"? }`)
  const extra = onlyKeys(value, ["name", "path", "steps", "noPress"], at)
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
  const rawNoPress = value["noPress"] ?? []
  if (rawNoPress === true) return Result.success({ name: value["name"], path, steps, noPress: true })
  if (!Array.isArray(rawNoPress)) return Result.failure(`${at}.noPress must be true (press nothing on this screen) or an array of { "name", "role"? }`)
  const noPress: Array<ControlName> = []
  for (const [index, raw] of rawNoPress.entries()) {
    const control = parseControlName(raw, `${at}.noPress[${index}]`)
    if (!control.ok) return control
    noPress.push(control.value)
  }
  return Result.success({ name: value["name"], path, steps, noPress })
}

/** Validates a route file's JSON; the error names the field that is wrong. */
export const parseRoute = (value: unknown): Result.Result<Route, string> => {
  if (!isRecord(value)) return Result.failure(`the route must be an object { "screens": [...] }`)
  const extra = onlyKeys(value, ["screens"], "route")
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
  return Result.success({ screens })
}

/** The six checks. */
export type CheckId = "focus-outside-menu" | "tab-leaves-menu" | "unnamed-control" | "key-not-pressed" | "focus-dropped" | "unreachable-control"

export const checks: ReadonlyArray<CheckId> = ["focus-outside-menu", "tab-leaves-menu", "unnamed-control", "key-not-pressed", "focus-dropped", "unreachable-control"]

/** A control as the report names it: its role and name from the accessibility tree, and a CSS selector that finds it. */
export interface Control {
  readonly role: string
  readonly name: string
  readonly selector: string
}

/** One failure: which check, on which screen, which control, what the walk saw, and what to change. */
export interface Failure {
  readonly check: CheckId | "route-step" | "page-error"
  readonly screen: string
  readonly control?: Control
  readonly saw: string
  readonly fix: string
}

/** A control a check could not decide, and why. */
export interface Undecided {
  readonly control?: Control
  readonly reason: string
}

/** One check on one screen. `passed` counts only what was decided; `undecided` lists the rest. */
export interface Outcome {
  readonly check: CheckId
  readonly screen: string
  readonly status: "passed" | "failed" | "not-checked"
  /** How many controls (or menus) the check decided. */
  readonly decided: number
  readonly undecided: ReadonlyArray<Undecided>
}

export interface Report {
  readonly ok: boolean
  readonly url: string
  readonly screens: ReadonlyArray<string>
  readonly failures: ReadonlyArray<Failure>
  readonly outcomes: ReadonlyArray<Outcome>
}

export const fixes: Record<Failure["check"], string> = {
  "focus-outside-menu": "move focus into the menu when it opens: showModal() on a <dialog> does it, an aria-modal element must focus its first control itself (ui-and-render.md step 8)",
  "tab-leaves-menu": "keep Tab inside the open menu: open it with showModal() on a <dialog>, or make the page behind an aria-modal element inert (ui-and-render.md step 8)",
  "unnamed-control": "give it a name: visible text, or aria-label on an icon (ui-and-render.md step 7)",
  "key-not-pressed": "leave Enter and Space on a focused control to the page: take game keys with Keyboard.actions, not a page key listener that calls preventDefault() (lint ritmo/use-keyboard-for-game-keys)",
  "focus-dropped": "update the control in place instead of rewriting its region (ui-and-render.md step 7); when the press closes a menu into play, focus the canvas (ui-and-render.md step 8, Keyboard.actions)",
  "unreachable-control": "let the keyboard reach it: remove tabIndex = -1 (Keyboard.actions leaves Enter and Space on a focused control to it and keeps every other key with the game), or make it part of a group whose one Tab stop reaches it with the arrows",
  "route-step": "fix the route so this step can run, or the page so it shows what the step names; the screen's checks did not run",
  "page-error": "fix the error the page threw; the checks it interrupted did not run"
}

/** What the walk needs from outside: the page's URL, the route, and how long to let a screen settle. */
export interface Options {
  readonly url: string
  readonly route: Route
  /** Milliseconds after a page load before the route's steps run (default 1500). */
  readonly settle?: number
}

interface Described {
  readonly id: number
  readonly tag: string
  readonly selector: string
  readonly keys: ReadonlyArray<string>
  readonly native: boolean
  /** A link to another site: pressing it for real would leave the game, so it is not pressed. */
  readonly external: boolean
  readonly canvas: boolean
}

interface PageState {
  readonly active: Described | null
  readonly menu: Described | null
  readonly inMenu: boolean
  readonly url: string
}

interface PressResult {
  readonly pressed: boolean
  readonly keydownPrevented: boolean | null
  readonly keyupPrevented: boolean | null
}

const keyName = (key: string): string => key === " " ? "Space" : key

/** Joins a screen's path to the base URL, keeping the base's own path. */
const screenUrl = (base: string, path: string): string => {
  if (path === "") return base
  if (path.startsWith("?") || path.startsWith("#")) return base.replace(/[?#].*$/, "") + path
  return new URL(path, base).href
}

const describeControl = (control: Control): string =>
  `${control.role === "" ? "element" : control.role} ${control.name === "" ? "(no name)" : JSON.stringify(control.name)} at ${control.selector}`

/** Runs the walk in an open Chromium; the caller launches and closes it. */
export const walk = async (browser: PlaywrightTypes.Browser, options: Options): Promise<Report> => {
  const settle = options.settle ?? 1500
  const failures: Array<Failure> = []
  const outcomes: Array<Outcome> = []
  for (const screen of options.route.screens) {
    const result = await walkScreen(browser, options.url, screen, settle)
    failures.push(...result.failures)
    outcomes.push(...result.outcomes)
  }
  return { ok: failures.length === 0, url: options.url, screens: options.route.screens.map((screen) => screen.name), failures, outcomes }
}

interface Opened {
  readonly page: PlaywrightTypes.Page
  readonly errors: Array<string>
  readonly state: () => Promise<PageState>
  readonly control: (described: Described) => Promise<Control>
  readonly close: () => Promise<void>
}

const open = async (browser: PlaywrightTypes.Browser): Promise<Opened> => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(pageScript)
  const errors: Array<string> = []
  page.on("pageerror", (error) => errors.push(error.message))
  const cdp = await page.context().newCDPSession(page)
  const state = () => page.evaluate(() => (Reflect.get(globalThis, "__ritmoKeyboardWalk") as { state: () => PageState }).state())
  const control = async (described: Described): Promise<Control> => {
    try {
      const evaluated = await cdp.send("Runtime.evaluate", { expression: `__ritmoKeyboardWalk.element(${described.id})`, objectGroup: "ritmo-keyboard" })
      const objectId = evaluated.result.objectId
      if (objectId === undefined) return { role: "", name: "", selector: described.selector }
      const tree = await cdp.send("Accessibility.getPartialAXTree", { objectId, fetchRelatives: false })
      const node = tree.nodes[0]
      const role = node?.role?.value
      const name = node?.name?.value
      return { role: typeof role === "string" ? role : "", name: typeof name === "string" ? name.trim() : "", selector: described.selector }
    } catch {
      return { role: "", name: "", selector: described.selector }
    }
  }
  return { page, errors, state, control, close: () => page.close() }
}

/** Opens the screen: loads its URL, lets it settle, and runs its steps. A failed step is returned as its message. */
const reach = async (opened: Opened, url: string, screen: Screen, settle: number): Promise<string | undefined> => {
  const { page } = opened
  try {
    await page.goto(screenUrl(url, screen.path), { waitUntil: "load" })
  } catch (error) {
    return `the page did not load: ${error instanceof Error ? error.message : String(error)}`
  }
  await page.waitForTimeout(settle)
  for (const [index, step] of screen.steps.entries()) {
    const at = `steps[${index}]`
    try {
      if ("press" in step) await page.keyboard.press(step.press)
      else if ("wait" in step) await page.waitForTimeout(step.wait)
      else {
        const target = await find(opened, step.click)
        if (target === undefined) return `${at}: no visible ${step.click.role} named ${JSON.stringify(step.click.name)} to click (names are the ones this report prints)`
        await page.locator(target.selector).first().click({ timeout: 5000 })
      }
    } catch (error) {
      return `${at} failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
    }
    await page.waitForTimeout(300)
  }
  return undefined
}

/**
 * The first visible element with this role and accessible name, by the names
 * this report prints (Chromium's accessibility tree), so a name copied from a
 * report finds its control. Waits up to five seconds for it to show.
 */
const find = async (opened: Opened, wanted: { readonly role: string; readonly name: string }): Promise<Described | undefined> => {
  for (let tries = 0; tries < 10; tries++) {
    const candidates = await call(opened.page, "controls", null) as ReadonlyArray<Described>
    for (const candidate of candidates) {
      const control = await opened.control(candidate)
      if (control.role === wanted.role && control.name === wanted.name) return candidate
    }
    await opened.page.waitForTimeout(500)
  }
  return undefined
}

const call = <A>(page: PlaywrightTypes.Page, name: string, argument: A): Promise<unknown> =>
  page.evaluate(
    ({ name, argument }) => (Reflect.get(globalThis, "__ritmoKeyboardWalk") as Record<string, (argument: unknown, more?: unknown) => unknown>)[name]!(argument),
    { name, argument }
  )

const press = async (opened: Opened, key: string, stop: boolean, wait: number): Promise<PressResult> => {
  await call(opened.page, "arm", stop)
  await opened.page.keyboard.press(key)
  await opened.page.waitForTimeout(wait)
  return await call(opened.page, "result", undefined) as PressResult
}

const notChecked = (check: CheckId, screen: string, reason: string): Outcome => ({ check, screen, status: "not-checked", decided: 0, undecided: [{ reason }] })

const matches = (control: Control, names: ReadonlyArray<ControlName>): boolean =>
  names.some((entry) => entry.name === control.name && (entry.role === undefined || entry.role === control.role))

interface ScreenResult {
  readonly failures: ReadonlyArray<Failure>
  readonly outcomes: ReadonlyArray<Outcome>
}

const walkScreen = async (browser: PlaywrightTypes.Browser, url: string, screen: Screen, settle: number): Promise<ScreenResult> => {
  const failures: Array<Failure> = []
  const outcomes: Array<Outcome> = []
  const fail = (check: Failure["check"], saw: string, control?: Control): void => {
    failures.push(control === undefined ? { check, screen: screen.name, saw, fix: fixes[check] } : { check, screen: screen.name, control, saw, fix: fixes[check] })
  }
  const skipAll = (reason: string): ScreenResult => ({ failures, outcomes: checks.map((check) => notChecked(check, screen.name, reason)) })

  const opened = await open(browser)
  try {
    const reached = await reach(opened, url, screen, settle)
    if (reached !== undefined) {
      fail("route-step", reached)
      return skipAll(`the route did not reach this screen (${reached})`)
    }
    if (opened.errors.length > 0) {
      fail("page-error", `the page threw while the screen opened: ${opened.errors[0]}`)
      return skipAll("the page threw while the screen opened")
    }

    // Pass 1: the Tab walk, with Enter and Space on each stop (the click stopped).
    const start = await opened.state()
    const menu = start.menu
    const stops: Array<Described> = []
    const escapes: Array<Described> = []
    const presses: Array<{ readonly stop: Described; readonly key: string; readonly result: PressResult }> = []
    const visit = async (at: PageState): Promise<void> => {
      const active = at.active!
      stops.push(active)
      if (menu !== null && at.menu?.id === menu.id && !at.inMenu) escapes.push(active)
      for (const key of active.keys) {
        const result = await press(opened, key, true, 80)
        presses.push({ stop: active, key, result })
        // The game may move focus on a key it took: walk on from where focus is now.
        const after = await opened.state()
        if (after.active?.id !== active.id) break
      }
    }
    if (start.active !== null) await visit(start)
    let atBody = 0
    for (let tabs = 0; tabs < 120; tabs++) {
      await opened.page.keyboard.press("Tab")
      await opened.page.waitForTimeout(40)
      const at = await opened.state()
      if (at.active === null) {
        if (++atBody >= 2) break
        continue
      }
      atBody = 0
      if (stops.some((stop) => stop.id === at.active!.id)) break
      await visit(at)
    }
    const pageErrors = opened.errors.length
    if (pageErrors > 0) {
      fail("page-error", `the page threw during the Tab walk: ${opened.errors[0]}`)
      return skipAll("the page threw during the Tab walk")
    }

    // focus-outside-menu and tab-leaves-menu.
    if (menu === null) {
      outcomes.push(notChecked("focus-outside-menu", screen.name, "no menu is open on this screen"))
      outcomes.push(notChecked("tab-leaves-menu", screen.name, "no menu is open on this screen"))
    } else {
      const menuControl = await opened.control(menu)
      const where = start.active === null ? "<body>" : describeControl(await opened.control(start.active))
      if (!start.inMenu) fail("focus-outside-menu", `this menu is open and focus is on ${where}`, menuControl)
      outcomes.push({ check: "focus-outside-menu", screen: screen.name, status: start.inMenu ? "passed" : "failed", decided: 1, undecided: [] })
      const inside = stops.length - escapes.length
      if (escapes.length > 0) {
        fail("tab-leaves-menu", `this menu is open and Tab reached ${describeControl(await opened.control(escapes[0]!))} outside it${escapes.length > 1 ? ` (and ${escapes.length - 1} more)` : ""}`, menuControl)
        outcomes.push({ check: "tab-leaves-menu", screen: screen.name, status: "failed", decided: 1, undecided: [] })
      } else if (inside === 0) {
        outcomes.push(notChecked("tab-leaves-menu", screen.name, "Tab reached nothing inside the open menu"))
      } else {
        outcomes.push({ check: "tab-leaves-menu", screen: screen.name, status: "passed", decided: 1, undecided: [] })
      }
    }

    // unnamed-control.
    const named = stops.filter((stop) => !stop.canvas)
    const controls = new Map<number, Control>()
    for (const stop of stops) controls.set(stop.id, await opened.control(stop))
    if (named.length === 0) outcomes.push(notChecked("unnamed-control", screen.name, "Tab reached no control"))
    else {
      const unnamed = named.filter((stop) => controls.get(stop.id)!.name === "")
      for (const stop of unnamed) fail("unnamed-control", "Tab reaches it and it has no accessible name", controls.get(stop.id))
      outcomes.push({ check: "unnamed-control", screen: screen.name, status: unnamed.length > 0 ? "failed" : "passed", decided: named.length, undecided: [] })
    }

    // key-not-pressed.
    {
      const undecided: Array<Undecided> = []
      const failedIds = new Set<number>()
      let decided = 0
      const byStop = new Map<number, Array<(typeof presses)[number]>>()
      for (const entry of presses) byStop.set(entry.stop.id, [...byStop.get(entry.stop.id) ?? [], entry])
      for (const [id, entries] of byStop) {
        const stop = entries[0]!.stop
        const control = controls.get(id)!
        if (!stop.native) {
          if (entries.some((entry) => entry.result.pressed)) decided++
          else undecided.push({ control, reason: "a custom control (not a native button, link, checkbox, or summary) showed no click and no change of aria-checked, aria-pressed, aria-expanded, or aria-selected, which may be right for it" })
          continue
        }
        decided++
        for (const entry of entries) {
          if (entry.result.pressed) continue
          const prevented = entry.result.keydownPrevented === true ? "a key listener called preventDefault() on its keydown" : entry.result.keyupPrevented === true ? "a key listener called preventDefault() on its keyup" : "no click followed"
          fail("key-not-pressed", `${keyName(entry.key)} with it focused did not press it: ${prevented}`, control)
          failedIds.add(id)
        }
      }
      const pressable = stops.filter((stop) => stop.keys.length > 0)
      outcomes.push(decided === 0
        ? { check: "key-not-pressed", screen: screen.name, status: "not-checked", decided: 0, undecided: undecided.length > 0 ? undecided : [{ reason: pressable.length === 0 ? "Tab reached no control that Enter or Space presses" : "no press could be judged" }] }
        : { check: "key-not-pressed", screen: screen.name, status: failedIds.size > 0 ? "failed" : "passed", decided, undecided })

      // unreachable-control: what Tab missed, unless the arrows of its group reach it.
      const visible = await call(opened.page, "controls", menu?.id ?? null) as ReadonlyArray<Described>
      const reachedIds = new Set(stops.map((stop) => stop.id))
      const missed = visible.filter((control) => !reachedIds.has(control.id))
      const probed = new Map<number, Set<number>>()
      const unreachable: Array<Described> = []
      for (const control of missed) {
        const from = await opened.page.evaluate(
          ({ control, stops }) => (Reflect.get(globalThis, "__ritmoKeyboardWalk") as { groupStops: (control: number, stops: ReadonlyArray<number>) => ReadonlyArray<number> }).groupStops(control, stops),
          { control: control.id, stops: [...reachedIds] }
        )
        let found = false
        for (const stop of from.slice(0, 2)) {
          let reachedFrom = probed.get(stop)
          if (reachedFrom === undefined) {
            reachedFrom = await probe(opened, stop, missed.length + 1)
            probed.set(stop, reachedFrom)
          }
          if (reachedFrom.has(control.id)) {
            found = true
            break
          }
        }
        if (!found) unreachable.push(control)
      }
      for (const control of unreachable) {
        const named = await opened.control(control)
        fail("unreachable-control", `it is visible${menu === null ? "" : " in the open menu"}, and neither Tab nor the arrow keys of its group reach it`, named)
      }
      outcomes.push(visible.length === 0
        ? notChecked("unreachable-control", screen.name, menu === null ? "no visible control on this screen" : "no visible control in the open menu")
        : { check: "unreachable-control", screen: screen.name, status: unreachable.length > 0 ? "failed" : "passed", decided: visible.length, undecided: [] })
      if (opened.errors.length > pageErrors) fail("page-error", `the page threw during the arrow-key probe: ${opened.errors[pageErrors]}`)

      // Pass 2, focus-dropped: press each control for real, on a fresh copy of the screen.
      if (screen.noPress === true) {
        outcomes.push(notChecked("focus-dropped", screen.name, "the route marks this screen not to be pressed (noPress: true)"))
      } else {
        const skip = screen.noPress
        const results = { decided: 0, undecided: [] as Array<Undecided>, failed: 0 }
        const candidates = stops.filter((stop) => stop.native && stop.keys.length > 0)
        for (const stop of candidates) {
          const control = controls.get(stop.id)!
          if (matches(control, skip)) {
            results.undecided.push({ control, reason: "the route marks it not to be pressed" })
            continue
          }
          if (stop.external) {
            results.undecided.push({ control, reason: "a link to another site is not pressed for real" })
            continue
          }
          if (failedIds.has(stop.id)) {
            results.undecided.push({ control, reason: "Enter or Space does not press it (key-not-pressed)" })
            continue
          }
          const outcome = await pressForReal(browser, url, screen, settle, stop)
          if (outcome._tag === "Undecided") results.undecided.push({ control, reason: outcome.reason })
          else if (outcome._tag === "PageError") {
            fail("page-error", `the page threw when ${keyName(outcome.key)} pressed it: ${outcome.message}`, control)
            results.undecided.push({ control, reason: "the page threw when it was pressed" })
          } else {
            results.decided++
            if (outcome._tag === "Dropped") {
              results.failed++
              fail("focus-dropped", `${keyName(outcome.key)} pressed it and focus fell to <body>`, control)
            }
          }
        }
        outcomes.push(results.decided === 0
          ? { check: "focus-dropped", screen: screen.name, status: "not-checked", decided: 0, undecided: results.undecided.length > 0 ? results.undecided : [{ reason: "Tab reached no control that Enter or Space presses" }] }
          : { check: "focus-dropped", screen: screen.name, status: results.failed > 0 ? "failed" : "passed", decided: results.decided, undecided: results.undecided })
      }
    }
    return { failures, outcomes: checks.map((check) => outcomes.find((outcome) => outcome.check === check)!) }
  } finally {
    await opened.close()
  }
}

/** Every element the arrow keys reach from `stop`, focused by script after the walk's last key. */
const probe = async (opened: Opened, stop: number, most: number): Promise<Set<number>> => {
  const reached = new Set<number>()
  for (const keys of [["ArrowRight", "ArrowLeft"], ["ArrowDown", "ArrowUp"]] as const) {
    for (const key of keys) {
      const focused = await call(opened.page, "focus", stop)
      if (focused !== true) return reached
      for (let step = 0; step < most; step++) {
        await opened.page.keyboard.press(key)
        await opened.page.waitForTimeout(30)
        const at = await opened.state()
        if (at.active === null || reached.has(at.active.id)) break
        reached.add(at.active.id)
      }
    }
  }
  return reached
}

type Pressed =
  | { readonly _tag: "Kept"; readonly key: string }
  | { readonly _tag: "Dropped"; readonly key: string }
  | { readonly _tag: "PageError"; readonly key: string; readonly message: string }
  | { readonly _tag: "Undecided"; readonly reason: string }

/** Reloads the screen, tabs to the control again (by its selector), and presses it with the click let through. */
const pressForReal = async (browser: PlaywrightTypes.Browser, url: string, screen: Screen, settle: number, stop: Described): Promise<Pressed> => {
  const opened = await open(browser)
  try {
    const reached = await reach(opened, url, screen, settle)
    if (reached !== undefined) return { _tag: "Undecided", reason: `the route did not reach the screen again (${reached})` }
    let at = await opened.state()
    for (let tabs = 0; at.active?.selector !== stop.selector && tabs < 120; tabs++) {
      await opened.page.keyboard.press("Tab")
      await opened.page.waitForTimeout(40)
      at = await opened.state()
    }
    if (at.active?.selector !== stop.selector) return { _tag: "Undecided", reason: "Tab did not reach it again after a reload" }
    const key = stop.keys[0]!
    const before = opened.errors.length
    const popups: Array<PlaywrightTypes.Page> = []
    const onPopup = (popup: PlaywrightTypes.Page): void => {
      popups.push(popup)
    }
    opened.page.on("popup", onPopup)
    const result = await press(opened, key, false, 700)
    opened.page.off("popup", onPopup)
    await Promise.all(popups.map((popup) => popup.close().catch(() => undefined)))
    if (popups.length > 0) return { _tag: "Undecided", reason: "the press opened another page" }
    if (opened.errors.length > before) return { _tag: "PageError", key, message: opened.errors[before]! }
    const after = await opened.state()
    if (after.url.replace(/#.*$/, "") !== at.url.replace(/#.*$/, "")) return { _tag: "Undecided", reason: "the press left the page" }
    if (!result.pressed) return { _tag: "Undecided", reason: `${keyName(key)} did not press it after a reload` }
    return after.active === null ? { _tag: "Dropped", key } : { _tag: "Kept", key }
  } catch (error) {
    return { _tag: "Undecided", reason: `the press failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` }
  } finally {
    await opened.close()
  }
}

/** The report as text: one line per failure, then what passed and what was not checked, per screen. */
export const format = (report: Report): string => {
  const lines: Array<string> = []
  for (const failure of report.failures) {
    lines.push(`FAIL ${failure.check} [${failure.screen}]${failure.control === undefined ? "" : ` ${describeControl(failure.control)}`}: ${failure.saw}. Fix: ${failure.fix}.`)
  }
  if (lines.length > 0) lines.push("")
  for (const screen of report.screens) {
    const outcomes = report.outcomes.filter((outcome) => outcome.screen === screen)
    lines.push(`[${screen}]`)
    for (const outcome of outcomes) {
      const count = outcome.decided > 0 ? ` (${outcome.decided} decided)` : ""
      lines.push(`  ${outcome.status === "passed" ? "pass" : outcome.status === "failed" ? "FAIL" : "not checked"} ${outcome.check}${count}`)
      for (const entry of outcome.undecided) lines.push(`    not checked${entry.control === undefined ? "" : ` ${describeControl(entry.control)}`}: ${entry.reason}`)
    }
  }
  const failed = report.outcomes.filter((outcome) => outcome.status === "failed").length
  const passed = report.outcomes.filter((outcome) => outcome.status === "passed").length
  const skipped = report.outcomes.filter((outcome) => outcome.status === "not-checked").length
  const other = report.failures.filter((failure) => failure.check === "route-step" || failure.check === "page-error").length
  lines.push("")
  lines.push(`keyboard walk of ${report.url}: ${report.failures.length} failure${report.failures.length === 1 ? "" : "s"}${other > 0 ? ` (${other} route or page error${other === 1 ? "" : "s"})` : ""}; checks ${failed} failed, ${passed} passed, ${skipped} not checked on ${report.screens.length} screen${report.screens.length === 1 ? "" : "s"}`)
  return lines.join("\n")
}
