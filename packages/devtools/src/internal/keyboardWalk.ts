/**
 * `ritmo-devtools keyboard`: plays a game's page by keyboard in Chromium and
 * checks what a keyboard player relies on, on each screen of a route.
 *
 * Six checks, each decided per screen as passed, failed, or not checked
 * (with the reason), never passed by default:
 *
 * - `focus-outside-menu`: a menu is open and focus is outside it;
 * - `tab-leaves-menu`: Tab moves focus out of the open menu;
 * - `unnamed-control`: a control the keyboard reaches (by Tab, or by the
 *   arrows of its group) has no accessible name;
 * - `key-not-pressed`: Enter or Space on the focused control did not press
 *   it (the click is stopped, so this changes nothing);
 * - `focus-dropped`: pressing a control dropped focus to `<body>` (the
 *   control is pressed for real, after a reload of the screen);
 * - `unreachable-control`: a visible control neither Tab nor the arrows of
 *   its group reach.
 *
 * A loaded screen is walked once it has stopped changing: no request in
 * flight, and the same menu, focus, and visible controls for 400 ms, or
 * `settle` at the latest. `focus-dropped` presses on several pages at once
 * (`pages`); a press that did not keep focus is run again with no other page
 * open, and that second result is the one reported, so a failure never comes
 * from a busy machine.
 *
 * A page that stops answering for `stall` milliseconds (its main thread is
 * busy, or its renderer hung) is closed and reported as a `page-error`, so
 * the walk fails instead of waiting for ever.
 *
 * A screen on which no check could be decided is a failure too
 * (`nothing-checked`): nothing checked is never an exit code of 0.
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
  | { readonly waitFor: { readonly role: string; readonly name: string } }
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
    return Result.failure(`${at} must be one of { "press": "Escape" }, { "click": { "role": "button", "name": "Play" } }, { "waitFor": { "role": "button", "name": "Play" } }, { "wait": 500 }`)
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
  return Result.failure(`${at} must be one of { "press": ... }, { "click": ... }, { "waitFor": ... }, { "wait": ... }; ${Object.keys(value)[0]} is not a step`)
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
  readonly check: CheckId | "route-step" | "page-error" | "nothing-checked"
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
  "focus-dropped": "update the control in place instead of rewriting its region (ui-and-render.md step 7); when the press hides or removes the control (it closes a menu, dismisses a hint), move focus on, to the canvas when play resumes (Keyboard.actions)",
  "unreachable-control": "let the keyboard reach it: remove tabIndex = -1 (Keyboard.actions leaves Enter and Space on a focused control to it and keeps every other key with the game), or make it part of a group whose one Tab stop reaches it with the arrows",
  "route-step": "fix the route so this step can run, or the page so it shows what the step names; the screen's checks did not run",
  "page-error": "fix the error the page threw; the checks it interrupted did not run",
  "nothing-checked": "give this screen steps that reach the game's DOM controls, or take it out of the route; controls drawn on the canvas, and elements that are not a <button>, a link, a form field, or an ARIA role, are not for this walk"
}

/** What the walk needs from outside: the page's URL, the route, and how long to let a screen settle. */
export interface Options {
  readonly url: string
  readonly route: Route
  /** The most milliseconds a loaded page gets to stop changing before the route's steps run (default 1500). */
  readonly settle?: number
  /** How many pages press controls at once for `focus-dropped` (default 1). */
  readonly pages?: number
  /** How many milliseconds a page may go without answering before it is closed and reported (default 20000). */
  readonly stall?: number
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
    const result = await walkScreen(browser, { url: options.url, settle, pages: Math.max(1, options.pages ?? 1), stall: options.stall ?? 20_000 }, screen)
    failures.push(...result.failures)
    outcomes.push(...result.outcomes)
  }
  return { ok: failures.length === 0, url: options.url, screens: options.route.screens.map((screen) => screen.name), failures, outcomes }
}

interface Opened {
  readonly page: PlaywrightTypes.Page
  readonly errors: Array<string>
  /** Requests in flight, and a count that moves whenever one starts or ends. */
  readonly network: { inFlight: number; activity: number }
  /** True once the page stopped answering and was closed for it. */
  readonly stalled: () => boolean
  readonly state: () => Promise<PageState>
  readonly control: (described: Described) => Promise<Control>
  readonly close: () => Promise<void>
}

/** What every page of one walk shares. */
interface Walk {
  readonly url: string
  readonly settle: number
  readonly pages: number
  readonly stall: number
}

const stalledSaw = (stall: number): string => `the page stopped answering for ${stall / 1000} seconds: its main thread is busy, or its renderer hung`

/** Whether the page runs a script within `most` milliseconds. A page that is closed or navigating has answered. */
const answers = (page: PlaywrightTypes.Page, most: number): Promise<boolean> =>
  new Promise((resolve) => {
    // oxlint-disable-next-line ritmo/use-clock-for-time -- a tool on the developer's machine, not a simulation: it times a page that no longer answers, so no page timer or tick can do it
    const timer = setTimeout(() => resolve(false), most)
    void page.evaluate(() => true).then(() => true, () => true).then((answered) => {
      clearTimeout(timer)
      resolve(answered)
    })
  })

const open = async (browser: PlaywrightTypes.Browser, stall: number): Promise<Opened> => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(pageScript)
  const errors: Array<string> = []
  page.on("pageerror", (error) => errors.push(error.message))
  const network = { inFlight: 0, activity: 0 }
  page.on("request", () => {
    network.inFlight++
    network.activity++
  })
  const ended = (): void => {
    network.inFlight = Math.max(0, network.inFlight - 1)
    network.activity++
  }
  page.on("requestfinished", ended)
  page.on("requestfailed", ended)
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
  // Closing a page that stopped answering rejects every call still waiting on it, so the walk moves on.
  let stalled = false
  const watch = async (): Promise<void> => {
    while (!page.isClosed()) {
      if (!(await answers(page, stall))) {
        stalled = !page.isClosed()
        await page.close().catch(() => undefined)
        return
      }
      await page.waitForTimeout(1000).catch(() => undefined)
    }
  }
  void watch()
  return { page, errors, network, stalled: () => stalled, state, control, close: () => page.close().catch(() => undefined) }
}

/** Opens the screen: loads its URL, lets it settle, and runs its steps. A failed step is returned as its message. */
const reach = async (opened: Opened, url: string, screen: Screen, settle: number): Promise<string | undefined> => {
  const { page } = opened
  try {
    await page.goto(screenUrl(url, screen.path), { waitUntil: "load" })
  } catch (error) {
    return `the page did not load: ${error instanceof Error ? error.message : String(error)}`
  }
  await settled(opened, settle)
  for (const [index, step] of screen.steps.entries()) {
    const at = `steps[${index}]`
    try {
      if ("press" in step) await page.keyboard.press(step.press)
      else if ("wait" in step) await page.waitForTimeout(step.wait)
      else if ("waitFor" in step) {
        const target = await find(opened, step.waitFor, 15_000)
        if (target === undefined) return `${at}: no visible ${step.waitFor.role} named ${JSON.stringify(step.waitFor.name)} showed within 15 seconds (names are the ones this report prints)`
      } else {
        const target = await find(opened, step.click, 5000)
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
 * report finds its control. Waits up to about `most` milliseconds for it to show.
 */
const find = async (opened: Opened, wanted: { readonly role: string; readonly name: string }, most: number): Promise<Described | undefined> => {
  for (let waited = 0; waited <= most; waited += 150) {
    const candidates = await call(opened.page, "controls", null) as ReadonlyArray<Described>
    for (const candidate of candidates) {
      const control = await opened.control(candidate)
      if (control.role === wanted.role && control.name === wanted.name) return candidate
    }
    await opened.page.waitForTimeout(150)
  }
  return undefined
}

/**
 * Waits for a loaded page to stop changing: no request in flight, and the
 * same menu, focus, and visible controls for 400 ms of the page's own clock,
 * or `most` milliseconds at the latest. A page that never goes quiet (it
 * polls a server, or keeps redrawing its controls) waits the whole `most`.
 */
const settled = async (opened: Opened, most: number): Promise<void> => {
  const quiet = 400
  let start: number | undefined
  let since = 0
  let seen: string | undefined
  // The count bounds a page whose clock cannot be read (it is navigating).
  for (let polls = 0; polls * 50 <= most * 2; polls++) {
    try {
      const at = await opened.page.evaluate(() => (Reflect.get(globalThis, "__ritmoKeyboardWalk") as { signature: () => { now: number; key: string } }).signature())
      const key = `${at.key} ${opened.network.activity}`
      if (start === undefined || at.now < since) start = since = at.now
      if (key !== seen || opened.network.inFlight > 0) since = at.now
      seen = key
      if (at.now - since >= quiet || at.now - start >= most) return
    } catch {
      seen = undefined
    }
    await opened.page.waitForTimeout(50)
  }
}

/** Runs `run` on every item, at most `most` at once; the results keep the items' order. */
const inParallel = async <A, B>(items: ReadonlyArray<A>, most: number, run: (item: A) => Promise<B>): Promise<ReadonlyArray<B>> => {
  const results: Array<B> = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(most, items.length) }, worker))
  return results
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

const walkScreen = async (browser: PlaywrightTypes.Browser, { url, settle, pages, stall }: Walk, screen: Screen): Promise<ScreenResult> => {
  const failures: Array<Failure> = []
  const outcomes: Array<Outcome> = []
  const fail = (check: Failure["check"], saw: string, control?: Control): void => {
    failures.push(control === undefined ? { check, screen: screen.name, saw, fix: fixes[check] } : { check, screen: screen.name, control, saw, fix: fixes[check] })
  }
  const skipAll = (reason: string): ScreenResult => ({ failures, outcomes: checks.map((check) => notChecked(check, screen.name, reason)) })

  const opened = await open(browser, stall)
  // What was seen before a page stopped answering is dropped with it: the report says one thing about the screen.
  const stalled = (): ScreenResult => {
    failures.length = 0
    fail("page-error", stalledSaw(stall))
    return skipAll("the page stopped answering")
  }
  try {
    const reached = await reach(opened, url, screen, settle)
    if (opened.stalled()) return stalled()
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

    const controls = new Map<number, Control>()
    for (const stop of stops) controls.set(stop.id, await opened.control(stop))

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
      // Named before the arrow keys are pressed: a game that takes them may redraw what they name.
      for (const control of missed) controls.set(control.id, await opened.control(control))
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
        fail("unreachable-control", `it is visible${menu === null ? "" : " in the open menu"}, and neither Tab nor the arrow keys of its group reach it`, controls.get(control.id))
      }
      outcomes.push(visible.length === 0
        ? notChecked("unreachable-control", screen.name, menu === null ? "no visible control on this screen" : "no visible control in the open menu")
        : { check: "unreachable-control", screen: screen.name, status: unreachable.length > 0 ? "failed" : "passed", decided: visible.length, undecided: [] })
      if (opened.errors.length > pageErrors) fail("page-error", `the page threw during the arrow-key probe: ${opened.errors[pageErrors]}`)

      // unnamed-control: every control the keyboard reaches, by Tab or by the arrows of its group.
      const reached = [...stops.filter((stop) => !stop.canvas), ...missed.filter((control) => !unreachable.includes(control))]
      if (reached.length === 0) outcomes.push(notChecked("unnamed-control", screen.name, "the keyboard reached no control"))
      else {
        const unnamed = reached.filter((control) => controls.get(control.id)!.name === "")
        for (const control of unnamed) fail("unnamed-control", "the keyboard reaches it and it has no accessible name", controls.get(control.id))
        outcomes.push({ check: "unnamed-control", screen: screen.name, status: unnamed.length > 0 ? "failed" : "passed", decided: reached.length, undecided: [] })
      }

      // Pass 2, focus-dropped: press each control for real, on a fresh copy of the screen.
      if (screen.noPress === true) {
        outcomes.push(notChecked("focus-dropped", screen.name, "the route marks this screen not to be pressed (noPress: true)"))
      } else {
        const skip = screen.noPress
        const results = { decided: 0, undecided: [] as Array<Undecided>, failed: 0 }
        const candidates = stops.filter((stop) => stop.native && stop.keys.length > 0)
        const skipped = (stop: Described): string | undefined =>
          matches(controls.get(stop.id)!, skip)
            ? "the route marks it not to be pressed"
            : stop.external
            ? "a link to another site is not pressed for real"
            : failedIds.has(stop.id)
            ? "Enter or Space does not press it (key-not-pressed)"
            : undefined
        const pressed = await inParallel(candidates.filter((stop) => skipped(stop) === undefined), pages, (stop) => pressForReal(browser, { url, settle, pages, stall }, screen, stop))
        let at = 0
        for (const stop of candidates) {
          const control = controls.get(stop.id)!
          const reason = skipped(stop)
          if (reason !== undefined) {
            results.undecided.push({ control, reason })
            continue
          }
          let outcome = pressed[at++]!
          // A press that shared the machine with others and did not keep focus is run again alone: only that result is reported.
          if (pages > 1 && outcome._tag !== "Kept") outcome = await pressForReal(browser, { url, settle, pages, stall }, screen, stop)
          if (outcome._tag === "Undecided") results.undecided.push({ control, reason: outcome.reason })
          else if (outcome._tag === "PageError") {
            fail("page-error", outcome.saw, control)
            results.undecided.push({ control, reason: outcome.reason })
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
    // Nothing decided is not a pass: the route missed the game's controls, or the page has none this walk can see.
    if (failures.length === 0 && outcomes.every((outcome) => outcome.status === "not-checked")) {
      fail("nothing-checked", "no check could be decided on this screen: no menu is open, and it shows no control")
    }
    return { failures, outcomes: checks.map((check) => outcomes.find((outcome) => outcome.check === check)!) }
  } catch (error) {
    if (!opened.stalled()) throw error
    return stalled()
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
  | { readonly _tag: "PageError"; readonly saw: string; readonly reason: string }
  | { readonly _tag: "Undecided"; readonly reason: string }

/** Reloads the screen, tabs to the control again (by its selector), and presses it with the click let through. */
const pressForReal = async (browser: PlaywrightTypes.Browser, { url, settle, stall }: Walk, screen: Screen, stop: Described): Promise<Pressed> => {
  const opened = await open(browser, stall)
  try {
    const reached = await reach(opened, url, screen, settle)
    if (opened.stalled()) return { _tag: "PageError", saw: stalledSaw(stall), reason: "the page stopped answering" }
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
    if (opened.errors.length > before) return { _tag: "PageError", saw: `the page threw when ${keyName(key)} pressed it: ${opened.errors[before]!}`, reason: "the page threw when it was pressed" }
    const after = await opened.state()
    if (after.url.replace(/#.*$/, "") !== at.url.replace(/#.*$/, "")) return { _tag: "Undecided", reason: "the press left the page" }
    if (!result.pressed) return { _tag: "Undecided", reason: `${keyName(key)} did not press it after a reload` }
    return after.active === null ? { _tag: "Dropped", key } : { _tag: "Kept", key }
  } catch (error) {
    if (opened.stalled()) return { _tag: "PageError", saw: stalledSaw(stall), reason: "the page stopped answering" }
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
  const other = report.failures.filter((failure) => failure.check === "route-step" || failure.check === "page-error" || failure.check === "nothing-checked").length
  lines.push("")
  lines.push(`keyboard walk of ${report.url}: ${report.failures.length} failure${report.failures.length === 1 ? "" : "s"}${other > 0 ? ` (${other} from the route or the page, not from a check)` : ""}; checks ${failed} failed, ${passed} passed, ${skipped} not checked on ${report.screens.length} screen${report.screens.length === 1 ? "" : "s"}`)
  return lines.join("\n")
}
