/**
 * Opening one screen of a route in Chromium, for `ritmo-devtools keyboard`
 * and `ritmo-devtools layout`: a page at a viewport, the keyboard walk's page
 * script installed (it finds controls by the names a report prints), the
 * route's steps run, and errors the page throws collected.
 *
 * A loaded screen is ready once it has stopped changing: no request in
 * flight, and the same menu, focus, and visible controls for 400 ms, or
 * `settle` at the latest. A page that stops answering for `stall`
 * milliseconds (its main thread is busy, or its renderer hung) is closed, so
 * a walk reports it instead of waiting for ever.
 *
 * @internal
 */
import type * as PlaywrightTypes from "playwright"

import { pageScript } from "./keyboardPage.ts"
import type { Insets, Screen } from "./route.ts"
import { screenUrl } from "./route.ts"

/** A control as the report names it: its role and name from the accessibility tree, and a CSS selector that finds it. */
export interface Control {
  readonly role: string
  readonly name: string
  readonly selector: string
}

export interface Described {
  readonly id: number
  readonly tag: string
  readonly selector: string
  readonly keys: ReadonlyArray<string>
  readonly native: boolean
  /** A link to another site: pressing it for real would leave the game, so it is not pressed. */
  readonly external: boolean
  readonly canvas: boolean
}

export interface PageState {
  readonly active: Described | null
  readonly menu: Described | null
  readonly inMenu: boolean
  readonly url: string
}

export interface Opened {
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

/** How to open a page: its size, a touch screen or not, what the device keeps for itself, and more scripts to install. */
export interface OpenOptions {
  readonly width: number
  readonly height: number
  readonly touch: boolean
  readonly insets?: Insets
  readonly reducedMotion?: boolean
  readonly scripts?: ReadonlyArray<string>
}

const desktop: OpenOptions = { width: 1280, height: 800, touch: false }

/** What a walk says of a page that stopped answering. */
export const stalledSaw = (stall: number): string => `the page stopped answering for ${stall / 1000} seconds: its main thread is busy, or its renderer hung`

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

/** Opens a page that is closed once it has not answered for `stall` milliseconds. */
export const open = async (browser: PlaywrightTypes.Browser, stall: number, options: OpenOptions = desktop): Promise<Opened> => {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    hasTouch: options.touch,
    isMobile: options.touch,
    reducedMotion: options.reducedMotion === true ? "reduce" : "no-preference"
  })
  const page = await context.newPage()
  await page.addInitScript(pageScript)
  for (const script of options.scripts ?? []) await page.addInitScript(script)
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
  const cdp = await context.newCDPSession(page)
  // The device's own space (a notch, a home bar): what CSS reads as env(safe-area-inset-*).
  if (options.insets !== undefined) await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: options.insets })
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
  return { page, errors, network, stalled: () => stalled, state, control, close: () => context.close().catch(() => undefined) }
}

/** Opens the screen: loads its URL, lets it settle, and runs its steps. A failed step is returned as its message. */
export const reach = async (opened: Opened, url: string, screen: Screen, settle: number): Promise<string | undefined> => {
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
      else if ("type" in step) await page.keyboard.type(step.type)
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
 * The first visible element with this role and accessible name (in the open
 * menu first, then on the page), by the names
 * this report prints (Chromium's accessibility tree), so a name copied from a
 * report finds its control. Waits up to about `most` milliseconds for it to show.
 */
export const find = async (opened: Opened, wanted: { readonly role: string; readonly name: string }, most: number): Promise<Described | undefined> => {
  for (let waited = 0; waited <= most; waited += 150) {
    // An open menu first: its button wins over one of the same name behind it (a confirm's "Skip" over the HUD's).
    const menu = (await opened.state()).menu
    const inMenu = menu === null ? [] : await call(opened.page, "controls", menu.id) as ReadonlyArray<Described>
    const candidates = [...inMenu, ...await call(opened.page, "controls", null) as ReadonlyArray<Described>]
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
export const settled = async (opened: Opened, most: number): Promise<void> => {
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

export const call = <A>(page: PlaywrightTypes.Page, name: string, argument: A): Promise<unknown> =>
  page.evaluate(
    ({ name, argument }) => (Reflect.get(globalThis, "__ritmoKeyboardWalk") as Record<string, (argument: unknown, more?: unknown) => unknown>)[name]!(argument),
    { name, argument }
  )
