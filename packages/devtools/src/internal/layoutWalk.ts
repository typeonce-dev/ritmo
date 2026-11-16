/**
 * `ritmo-devtools layout`: opens each screen of a route in Chromium at each
 * of the route's viewports and reports what is broken in the layout the
 * player sees, whatever the game.
 *
 * Errors (they fail the run) are what the browser measures exactly and a
 * game never means:
 *
 * - `overlap`: two things drawn over each other, neither part of the other
 *   (text over text, text over a button, a button over a Touch button), with
 *   nothing drawn above both;
 * - `cut-text`: text the edge of a box cuts, with nothing to say it is cut;
 * - `off-screen`: part of a text or control past the edge of the screen;
 * - `safe-area`: part of a text or control in the space the device keeps
 *   (a notch, the home bar), from the viewport's insets;
 * - `small-target`: the area that takes a tap is under `minTarget` either
 *   side (hit tests through the control's centre, so a `::after` that
 *   extends it counts);
 * - `layout-shift`: something moved while nothing was pressed (Chromium's
 *   own layout-shift entries);
 * - `never-settled`: the layout kept moving, so nothing could be measured.
 *
 * Warnings (reported, never failing) are what a game may mean:
 *
 * - `truncated-text`: text shortened with an ellipsis or a line clamp;
 * - `scroll-edge`: a control half hidden at the edge of a scrolling area, or
 *   a scrolling area that runs past the screen;
 * - every finding of the longer-text pass, which loads each screen again
 *   with every text about 40% longer: a layout with no room to spare, not a
 *   layout broken today.
 *
 * A route's `allow` lists what a game means, by check and selector. The
 * page side is `layoutPage.ts`; reaching a screen is the keyboard walk's.
 *
 * @internal
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import type * as PlaywrightTypes from "playwright"

import { pageScript } from "./layoutPage.ts"
import type { Opened } from "./pageOpen.ts"
import { open, reach, stalledSaw } from "./pageOpen.ts"
import type { Allow, LayoutCheckId, Route, Screen, Viewport } from "./route.ts"

/** Every check the audit decides on each screen at each viewport. */
export type CheckId = LayoutCheckId | "never-settled"

export const checks: ReadonlyArray<CheckId> = ["overlap", "cut-text", "off-screen", "safe-area", "small-target", "layout-shift", "never-settled", "truncated-text", "scroll-edge"]

/** What a finding is about: the route, the page, or a check. */
export type FindingCheck = CheckId | "route-step" | "page-error" | "nothing-measured"

export type Severity = "error" | "warning"

const warnings: ReadonlySet<FindingCheck> = new Set<FindingCheck>(["truncated-text", "scroll-edge"])

/** An element as the report names it. */
export interface Element {
  readonly kind: "text" | "control" | "touch"
  readonly selector: string
  readonly text: string
}

export interface Box {
  readonly l: number
  readonly t: number
  readonly r: number
  readonly b: number
}

/**
 * One finding: the check, how much it matters, where (screen, viewport, and
 * which pass), the element (and the other one of an overlap), what was
 * measured, and what to change.
 */
export interface Finding {
  readonly check: FindingCheck
  readonly severity: Severity
  readonly screen: string
  readonly viewport: string
  readonly pass: "normal" | "longer-text"
  readonly element?: Element
  readonly other?: Element
  readonly box?: Box
  readonly saw: string
  readonly fix: string
  /** The screenshot that marks it, and its number there, with `screenshots`. */
  readonly screenshot?: { readonly file: string; readonly number: number }
}

/** One check on one screen at one viewport: `warned` has only warnings, `count` its findings. */
export interface Outcome {
  readonly check: CheckId
  readonly screen: string
  readonly viewport: string
  readonly status: "passed" | "failed" | "warned" | "not-checked"
  readonly count: number
  readonly reason?: string
}

export interface Report {
  readonly ok: boolean
  readonly url: string
  readonly screens: ReadonlyArray<string>
  readonly viewports: ReadonlyArray<string>
  readonly findings: ReadonlyArray<Finding>
  readonly outcomes: ReadonlyArray<Outcome>
  /** Findings the route's `allow` left out. */
  readonly allowed: number
}

export const fixes: Record<FindingCheck, string> = {
  overlap: "give each its own space at this size (anchor them to different edges, let one wrap or shrink); when one is meant to sit over the other, list it in the route's allow",
  "cut-text": "let the text wrap or give its box room at this size; when a cut is meant, end it with text-overflow: ellipsis so the player sees that text is missing",
  "off-screen": "keep it inside the screen at this size: anchor it to the edges, or let the layout wrap or shrink",
  "safe-area": "keep it out of the device's own space: offset its edge by env(safe-area-inset-*)",
  "small-target": "make the area that takes a tap bigger (padding, or a ::after that extends it), or set the route's minTarget when the game's own rule is smaller",
  "layout-shift": "keep its size while its content changes: size it to its widest value (a min-width, font-variant-numeric: tabular-nums for numbers), and animate with transform",
  "never-settled": "keep the layout still while nothing happens: animate with transform, not position or size, and honour prefers-reduced-motion; or wait longer in the route's steps",
  "truncated-text": "check the player can still tell what it says, and show the whole text where there is room; list it in the route's allow when the cut is meant",
  "scroll-edge": "when the player must find what is past the edge, show that the area scrolls; otherwise nothing to change",
  "route-step": "fix the route so this step can run, or the page so it shows what the step names; this screen was not measured",
  "page-error": "fix the error the page threw; the screen was still measured, unless the page stopped answering",
  "nothing-measured": "give this screen steps that reach what the game shows, or take it out of the route; drawing on a canvas is not measured, only text, controls, and Touch buttons"
}

/** What the audit needs from outside. */
export interface Options {
  readonly url: string
  readonly route: Route
  /** The most milliseconds a loaded page gets to stop changing before the route's steps run (default 1500). */
  readonly settle?: number
  /** How many milliseconds a page may go without answering before it is closed and reported (default 20000). */
  readonly stall?: number
  /** Milliseconds of a still screen watched for layout shifts (default 1500). */
  readonly steadyFor?: number
  /** Longest wait for the layout to hold still, in milliseconds (default 6000). */
  readonly settleLimit?: number
  /** A directory for one screenshot per screen and viewport with findings, each finding boxed and numbered. */
  readonly screenshots?: string
  /** The longer-text pass (default true). */
  readonly longerText?: boolean
}

interface PageFinding {
  readonly check: CheckId
  readonly element?: Element
  readonly other?: Element
  readonly box?: Box
  readonly saw: string
}

interface Audited {
  readonly findings: ReadonlyArray<PageFinding>
  readonly measured: number
  readonly allowed: number
}

const callPage = (page: PlaywrightTypes.Page, name: string, argument?: unknown): Promise<unknown> =>
  page.evaluate(
    ({ name, argument }) => (Reflect.get(globalThis, "__ritmoLayout") as Record<string, (argument: unknown) => unknown>)[name]!(argument),
    { name, argument }
  )

const fileName = (text: string): string => text.replace(/[^a-z0-9@._-]+/gi, "-")

/** Waits for fonts, then until two layout readings 250 ms apart agree; the elements that still move when they never do. */
const settleLayout = async (page: PlaywrightTypes.Page, limit: number): Promise<ReadonlyArray<string> | undefined> => {
  await page.evaluate("document.fonts.ready.then(() => true)").catch(() => true)
  let last = await callPage(page, "snapshot") as string
  for (let waited = 0; waited < limit; waited += 250) {
    await page.waitForTimeout(250)
    const next = await callPage(page, "snapshot") as string
    if (next === last) return undefined
    last = next
  }
  const before = JSON.parse(last) as ReadonlyArray<ReadonlyArray<string | number>>
  await page.waitForTimeout(250)
  const after = JSON.parse(await callPage(page, "snapshot") as string) as ReadonlyArray<ReadonlyArray<string | number>>
  const kept = new Map(before.map((entry) => [String(entry[0]), JSON.stringify(entry)]))
  const moving = after.filter((entry) => kept.get(String(entry[0])) !== JSON.stringify(entry)).map((entry) => String(entry[0]))
  return moving.length > 0 ? moving : ["elements that come and go"]
}

const colors: Record<Severity, string> = { error: "#e5195f", warning: "#f5a000" }

const keyOf = (finding: PageFinding): string => `${finding.check}|${finding.element?.selector ?? ""}|${finding.other?.selector ?? ""}`

const describeElement = (element: Element): string =>
  element.kind === "touch"
    ? `touch button ${JSON.stringify(element.text)} on ${element.selector}`
    : `${element.kind} ${element.text === "" ? "(no text)" : JSON.stringify(element.text)} at ${element.selector}`

/** Runs the audit in an open Chromium; the caller launches and closes it. */
export const walk = async (browser: PlaywrightTypes.Browser, options: Options): Promise<Report> => {
  const findings: Array<Finding> = []
  const outcomes: Array<Outcome> = []
  let allowed = 0
  if (options.screenshots !== undefined) mkdirSync(options.screenshots, { recursive: true })
  for (const screen of options.route.screens) {
    for (const viewport of options.route.viewports) {
      const result = await auditScreen(browser, options, screen, viewport)
      findings.push(...result.findings)
      outcomes.push(...result.outcomes)
      allowed += result.allowed
    }
  }
  return {
    ok: findings.every((finding) => finding.severity === "warning"),
    url: options.url,
    screens: options.route.screens.map((screen) => screen.name),
    viewports: options.route.viewports.map((viewport) => viewport.name),
    findings,
    outcomes,
    allowed
  }
}

interface ScreenResult {
  readonly findings: ReadonlyArray<Finding>
  readonly outcomes: ReadonlyArray<Outcome>
  readonly allowed: number
}

const auditScreen = async (browser: PlaywrightTypes.Browser, options: Options, screen: Screen, viewport: Viewport): Promise<ScreenResult> => {
  const settle = options.settle ?? 1500
  const limit = options.settleLimit ?? 6000
  const stall = options.stall ?? 20_000
  const allow: ReadonlyArray<Allow> = [...options.route.allow, ...screen.allow]
  const findings: Array<Finding> = []
  const at = { screen: screen.name, viewport: viewport.name }
  const walkFinding = (check: FindingCheck, saw: string): Finding => ({ check, severity: "error", ...at, pass: "normal", saw, fix: fixes[check] })
  const notChecked = (reason: string): ScreenResult => ({
    findings,
    outcomes: checks.map((check) => ({ check, ...at, status: "not-checked", count: 0, reason })),
    allowed: 0
  })
  const opening = { width: viewport.width, height: viewport.height, touch: viewport.touch, insets: viewport.insets, reducedMotion: true, scripts: [pageScript] }

  // The screen as the player sees it.
  let opened: Opened = await open(browser, stall, opening)
  // What was seen before a page stopped answering is dropped with it: the report says one thing about the screen.
  const stalled = (): ScreenResult => {
    findings.length = 0
    findings.push(walkFinding("page-error", stalledSaw(stall)))
    return notChecked("the page stopped answering")
  }
  let base: Audited
  let shifted: Audited
  try {
    const reached = await reach(opened, options.url, screen, settle)
    if (opened.stalled()) return stalled()
    if (reached !== undefined) {
      findings.push(walkFinding("route-step", reached))
      return notChecked(`the route did not reach this screen (${reached})`)
    }
    const moving = await settleLayout(opened.page, limit)
    if (opened.errors.length > 0) findings.push(walkFinding("page-error", `the page threw while the screen opened: ${opened.errors[0]}`))
    if (moving !== undefined) {
      findings.push({ ...walkFinding("never-settled", `the layout kept moving for ${limit / 1000} s: ${moving.slice(0, 4).join(", ")}${moving.length > 4 ? ` and ${moving.length - 4} more` : ""}`) })
      return { ...notChecked("the layout never held still"), outcomes: checks.map((check) => check === "never-settled" ? { check, ...at, status: "failed" as const, count: 1 } : { check, ...at, status: "not-checked" as const, count: 0, reason: "the layout never held still" }) }
    }
    await callPage(opened.page, "steady")
    base = await callPage(opened.page, "audit", { width: viewport.width, height: viewport.height, insets: viewport.insets, minTarget: options.route.minTarget, allow, checks: checks.filter((check) => check !== "layout-shift" && check !== "never-settled") }) as Audited
    await opened.page.waitForTimeout(options.steadyFor ?? 1500)
    shifted = await callPage(opened.page, "shifts", allow) as Audited
    if (base.measured === 0) {
      findings.push(walkFinding("nothing-measured", "the screen showed no text, control, or Touch button to measure"))
      return notChecked("nothing to measure")
    }
    const normal = [...base.findings, ...shifted.findings].map((finding): Finding => ({
      ...finding,
      severity: warnings.has(finding.check) ? "warning" : "error",
      ...at,
      pass: "normal",
      fix: fixes[finding.check]
    }))
    findings.push(...await shoot(opened, options, normal, `${screen.name}@${viewport.name}`))
  } catch (error) {
    if (!opened.stalled()) throw error
    return stalled()
  } finally {
    await opened.close()
  }

  // The same screen with every text about 40% longer: what has no room to spare.
  let longer: Audited | undefined
  if (options.longerText !== false) {
    opened = await open(browser, stall, opening)
    try {
      const reached = await reach(opened, options.url, screen, settle)
      if (reached === undefined && !opened.stalled()) {
        await callPage(opened.page, "pad")
        const moving = await settleLayout(opened.page, limit)
        if (moving === undefined) {
          longer = await callPage(opened.page, "audit", { width: viewport.width, height: viewport.height, insets: viewport.insets, minTarget: options.route.minTarget, allow, checks: ["overlap", "cut-text", "off-screen", "safe-area"] }) as Audited
          const known = new Set(base.findings.map(keyOf))
          const fresh = longer.findings.filter((finding) => !known.has(keyOf(finding))).map((finding): Finding => ({
            ...finding,
            severity: "warning",
            ...at,
            pass: "longer-text",
            saw: `with every text about 40% longer, ${finding.saw}`,
            fix: `${fixes[finding.check]}; this is a layout with no room to spare (a longer name, a translation), not one broken today`
          }))
          findings.push(...await shoot(opened, options, fresh, `${screen.name}@${viewport.name}-longer-text`))
        }
      }
    } catch (error) {
      // The screen was measured once already: a page that hangs only with longer text is reported, and what was measured is kept.
      if (!opened.stalled()) throw error
    } finally {
      if (opened.stalled()) findings.push({ ...walkFinding("page-error", `with every text about 40% longer, ${stalledSaw(stall)}`), pass: "longer-text" })
      await opened.close()
    }
  }

  const outcomes = checks.map((check): Outcome => {
    const mine = findings.filter((finding) => finding.check === check && finding.pass === "normal")
    const status = mine.some((finding) => finding.severity === "error") ? "failed" : mine.length > 0 ? "warned" : "passed"
    return { check, ...at, status, count: mine.length }
  })
  return { findings, outcomes, allowed: base.allowed + shifted.allowed + (longer?.allowed ?? 0) }
}

/** With `screenshots`, boxes and numbers each finding on the page and saves it; the findings then name their file and number. */
const shoot = async (opened: Opened, options: Options, found: ReadonlyArray<Finding>, name: string): Promise<ReadonlyArray<Finding>> => {
  if (options.screenshots === undefined || found.length === 0) return found
  const file = join(options.screenshots, `${fileName(name)}.png`)
  const numbered = found.map((finding, index) => ({ ...finding, screenshot: { file, number: index + 1 } }))
  await callPage(opened.page, "mark", numbered.filter((finding) => finding.box !== undefined).map((finding) => ({ ...finding.box, number: finding.screenshot.number, color: colors[finding.severity] })))
  await opened.page.screenshot({ path: file })
  await callPage(opened.page, "unmark")
  return numbered
}

/** The report as text: one line per finding, then each screen's checks per viewport, then the totals. */
export const format = (report: Report): string => {
  const lines: Array<string> = []
  for (const finding of report.findings) {
    const where = `[${finding.screen} @ ${finding.viewport}${finding.pass === "longer-text" ? ", longer text" : ""}]`
    const what = finding.element === undefined ? "" : ` ${describeElement(finding.element)}${finding.other === undefined ? "" : `, and ${describeElement(finding.other)}`}`
    const shot = finding.screenshot === undefined ? "" : ` (${finding.screenshot.file} #${finding.screenshot.number})`
    lines.push(`${finding.severity === "error" ? "FAIL" : "warn"} ${finding.check} ${where}${what}: ${finding.saw}.${shot} Fix: ${finding.fix}.`)
  }
  if (lines.length > 0) lines.push("")
  for (const screen of report.screens) {
    lines.push(`[${screen}]`)
    for (const viewport of report.viewports) {
      const mine = report.outcomes.filter((outcome) => outcome.screen === screen && outcome.viewport === viewport)
      const skipped = mine.find((outcome) => outcome.status === "not-checked" && outcome.check !== "never-settled") ?? mine.find((outcome) => outcome.status === "not-checked")
      const said = mine.filter((outcome) => outcome.status === "failed" || outcome.status === "warned").map((outcome) => `${outcome.status === "failed" ? "FAIL" : "warn"} ${outcome.check} (${outcome.count})`)
      const passed = mine.filter((outcome) => outcome.status === "passed").length
      const parts = [...said, ...(passed > 0 ? [`pass ${passed} more`] : [])]
      lines.push(`  ${viewport}: ${parts.join(", ")}${skipped?.reason === undefined ? "" : `${parts.length > 0 ? "; " : ""}not checked: ${skipped.reason}`}`)
    }
  }
  const errors = report.findings.filter((finding) => finding.severity === "error").length
  const warned = report.findings.length - errors
  lines.push("")
  lines.push(`layout audit of ${report.url}: ${errors} error${errors === 1 ? "" : "s"}, ${warned} warning${warned === 1 ? "" : "s"} on ${report.screens.length} screen${report.screens.length === 1 ? "" : "s"} at ${report.viewports.length} viewport${report.viewports.length === 1 ? "" : "s"}${report.allowed > 0 ? ` (${report.allowed} left out by the route's allow)` : ""}`)
  return lines.join("\n")
}
