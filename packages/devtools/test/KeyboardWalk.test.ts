import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as KeyboardWalkModule from "../src/internal/keyboardWalk.ts"
import type * as RouteModule from "../src/internal/route.ts"

// The walk is internal to the CLI (the package exports no `internal/*`): load its source to call it with a short settle time.
const KeyboardWalk = await import(new URL("../src/internal/keyboardWalk.ts", import.meta.url).href) as typeof KeyboardWalkModule
const Route = await import(new URL("../src/internal/route.ts", import.meta.url).href) as typeof RouteModule

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const fixtures = fileURLToPath(new URL("./fixtures/keyboard/", import.meta.url))

const run = (args: ReadonlyArray<string>, cwd: string) =>
  new Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }>((done) => {
    execFile(process.execPath, [cli, "keyboard", ...args], { cwd }, (error, stdout, stderr) => {
      done({ status: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout, stderr })
    })
  })

describe("ritmo-devtools keyboard arguments", () => {
  it("refuses a bad route or URL with exit code 2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ritmo-keyboard-"))
    const route = join(dir, "route.json")
    writeFileSync(route, JSON.stringify({ screens: [{ name: "a", steps: [{ wait: -1 }] }] }))
    expect(await run(["--route", route], fixtures)).toMatchObject({ status: 2, stdout: "", stderr: `${route} is not a keyboard route: route.screens[0].steps[0].wait must be a whole number of milliseconds from 0 to 60000\n` })
    expect(await run(["--url", "localhost:5173"], fixtures)).toMatchObject({ status: 2, stderr: "--url must be an http(s) URL of the game's page, such as http://localhost:5173/; got localhost:5173\n" })
    expect((await run(["--route"], fixtures)).status).toBe(2)
  }, 60_000)
})

// The browsers are downloaded only where browser runs are checked (the CI job "Determinism across engines").
const skipped = await (async () => {
  try {
    const playwright = await import("playwright")
    return existsSync(playwright.chromium.executablePath()) ? undefined : "chromium is not downloaded (npx playwright install chromium)"
  } catch {
    return "playwright is not installed"
  }
})()
if (skipped !== undefined) console.warn(`keyboard walk tests skipped: ${skipped}`)

const types: Record<string, string> = { ".html": "text/html" }

describe.skipIf(skipped !== undefined)("ritmo-devtools keyboard", () => {
  let server: Server
  let base = ""
  let browser: Awaited<ReturnType<typeof import("playwright")["chromium"]["launch"]>>

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname
      const file = join(fixtures, path === "/" ? "index.html" : path)
      if (!file.startsWith(fixtures) || !existsSync(file)) {
        response.statusCode = 404
        response.end()
        return
      }
      response.setHeader("content-type", types[file.slice(file.lastIndexOf("."))] ?? "text/plain")
      response.end(readFileSync(file))
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/`
    browser = await (await import("playwright")).chromium.launch()
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise((done) => server?.close(done))
  })

  const walk = (screens: ReadonlyArray<Partial<RouteModule.Screen> & { readonly name: string }>, options: { readonly settle?: number; readonly pages?: number; readonly stall?: number } = {}) =>
    KeyboardWalk.walk(browser, { url: base, route: { ...Route.startRoute, screens: screens.map((screen) => ({ path: "", steps: [], noPress: [], allow: [], ...screen })) }, settle: 100, ...options })
  const statuses = (report: KeyboardWalkModule.Report, screen: string) =>
    Object.fromEntries(report.outcomes.filter((outcome) => outcome.screen === screen).map((outcome) => [outcome.check, outcome.status]))

  it("passes every check on a page built for the keyboard, and decides each one it can", async () => {
    const report = await walk([{ name: "play" }, { name: "paused", path: "#paused" }])
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(statuses(report, "play")).toEqual({
      "focus-outside-menu": "not-checked",
      "tab-leaves-menu": "not-checked",
      "unnamed-control": "passed",
      "key-not-pressed": "passed",
      "focus-dropped": "passed",
      "unreachable-control": "passed"
    })
    expect(statuses(report, "paused")).toEqual({
      "focus-outside-menu": "passed",
      "tab-leaves-menu": "passed",
      "unnamed-control": "passed",
      "key-not-pressed": "passed",
      "focus-dropped": "passed",
      "unreachable-control": "passed"
    })
    // The roving toolbar's other buttons are reached by its arrows, not by Tab.
    expect(report.outcomes.find((outcome) => outcome.screen === "play" && outcome.check === "unreachable-control")?.decided).toBe(5)
  }, 120_000)

  it("fails each check on the page that breaks it, naming the control and the fix", async () => {
    const report = await walk(["focus-outside-menu", "tab-leaves-menu", "unnamed-control", "key-not-pressed", "focus-dropped", "unreachable-control"]
      .map((name) => ({ name, path: `${name}.html` })))
    expect(report.ok).toBe(false)
    const failed = report.failures.map((failure) => [failure.screen, failure.check, failure.control?.role, failure.control?.name, failure.control?.selector])
    expect(failed).toEqual([
      ["focus-outside-menu", "focus-outside-menu", "dialog", "Title", "body > div"],
      ["tab-leaves-menu", "tab-leaves-menu", "dialog", "Paused", "body > div"],
      ["unnamed-control", "unnamed-control", "button", "", "body > button:nth-of-type(1)"],
      // Reached by its group's arrows, never by Tab.
      ["unnamed-control", "unnamed-control", "button", "", "#tools > button:nth-of-type(2)"],
      ["key-not-pressed", "key-not-pressed", "button", "Restart", "#restart"],
      ["key-not-pressed", "key-not-pressed", "button", "Restart", "#restart"],
      ["focus-dropped", "focus-dropped", "button", "Add (0)", "#add"],
      ["unreachable-control", "unreachable-control", "button", "Brake", "#hud > button"]
    ])
    // Each page fails only its own check.
    for (const check of KeyboardWalk.checks) {
      const others = report.outcomes.filter((outcome) => outcome.screen === check && outcome.check !== check)
      expect(others.filter((outcome) => outcome.status === "failed")).toEqual([])
      expect(statuses(report, check)[check]).toBe("failed")
    }
    expect(report.failures.find((failure) => failure.check === "key-not-pressed")).toMatchObject({
      saw: "Enter with it focused did not press it: a key listener called preventDefault() on its keydown",
      fix: KeyboardWalk.fixes["key-not-pressed"]
    })
    expect(report.failures.find((failure) => failure.check === "tab-leaves-menu")?.saw).toBe("this menu is open and Tab reached button \"Menu\" at body > button outside it")
    expect(report.failures.find((failure) => failure.check === "focus-dropped")?.saw).toBe("Enter pressed it and focus fell to <body>")
    // A control Enter does not press is not pressed for real.
    expect(report.outcomes.find((outcome) => outcome.screen === "key-not-pressed" && outcome.check === "focus-dropped")).toMatchObject({
      status: "not-checked",
      undecided: [{ control: { role: "button", name: "Restart", selector: "#restart" }, reason: "Enter or Space does not press it (key-not-pressed)" }]
    })
  }, 180_000)

  it("reports a page error and a failed route step as failures, and the screen's checks as not checked", async () => {
    const report = await walk([
      { name: "broken", path: "page-error.html" },
      { name: "lost", steps: [{ click: { role: "button", name: "Settings" } }] }
    ])
    expect(report.failures.map((failure) => [failure.screen, failure.check, failure.saw])).toEqual([
      ["broken", "page-error", "the page threw while the screen opened: boot failed"],
      ["lost", "route-step", "steps[0]: no visible button named \"Settings\" to click (names are the ones this report prints)"]
    ])
    expect(report.outcomes.every((outcome) => outcome.status === "not-checked")).toBe(true)
    expect(report.outcomes).toHaveLength(12)
  }, 120_000)

  it("fails a screen on which nothing could be checked", async () => {
    const report = await walk([{ name: "canvas", path: "no-controls.html" }])
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([{
      check: "nothing-checked",
      screen: "canvas",
      saw: "no check could be decided on this screen: no menu is open, and it shows no control",
      fix: KeyboardWalk.fixes["nothing-checked"]
    }])
    expect(report.outcomes.every((outcome) => outcome.status === "not-checked")).toBe(true)
    expect(KeyboardWalk.format(report).split("\n").at(-1)).toMatch(/: 1 failure \(1 from the route or the page, not from a check\); checks 0 failed, 0 passed, 6 not checked on 1 screen$/)
  }, 120_000)

  it("gives the same report when it presses on several pages at once", async () => {
    const screens = [{ name: "play" }, { name: "paused", path: "#paused" }, { name: "dropped", path: "focus-dropped.html" }]
    const alone = await walk(screens)
    const together = await walk(screens, { pages: 3 })
    expect(together).toEqual(alone)
    expect(together.failures.map((failure) => [failure.screen, failure.check])).toEqual([["dropped", "focus-dropped"]])
  }, 180_000)

  it("waits for a screen to stop changing, and for the control a waitFor step names", async () => {
    const report = await walk([
      // Shown 300 ms after the load: the page has not settled until it is there.
      { name: "soon", path: "late-control.html" },
      // Shown after the page went quiet: only a waitFor step reaches it.
      { name: "late", path: "late-control.html?after=2500", steps: [{ waitFor: { role: "button", name: "Options" } }] },
      { name: "missed", path: "late-control.html?after=2500" }
    ], { settle: 1500 })
    expect(report.failures).toEqual([])
    const reached = (screen: string) => report.outcomes.find((outcome) => outcome.screen === screen && outcome.check === "unnamed-control")?.decided
    expect([reached("soon"), reached("late"), reached("missed")]).toEqual([2, 2, 1])
  }, 180_000)

  it("reports a page that stops answering, and does not wait for it", async () => {
    const report = await walk([{ name: "stuck", path: "stuck.html" }, { name: "play" }], { stall: 2000, pages: 2 })
    expect(report.failures).toEqual([{
      check: "page-error",
      screen: "stuck",
      saw: "the page stopped answering for 2 seconds: its main thread is busy, or its renderer hung",
      fix: KeyboardWalk.fixes["page-error"]
    }])
    expect(report.outcomes.filter((outcome) => outcome.screen === "stuck").every((outcome) => outcome.status === "not-checked")).toBe(true)
    // The next screen is walked as usual.
    expect(statuses(report, "play")["focus-dropped"]).toBe("passed")
  }, 120_000)

  it("does not press what the route marks", async () => {
    const report = await walk([{ name: "some", noPress: [{ name: "Menu", role: "button" }] }, { name: "none", noPress: true }])
    expect(report.outcomes.find((outcome) => outcome.screen === "some" && outcome.check === "focus-dropped")).toMatchObject({
      status: "passed",
      decided: 2,
      undecided: [{ control: { role: "button", name: "Menu" }, reason: "the route marks it not to be pressed" }]
    })
    expect(report.outcomes.find((outcome) => outcome.screen === "none" && outcome.check === "focus-dropped")).toMatchObject({
      status: "not-checked",
      undecided: [{ reason: "the route marks this screen not to be pressed (noPress: true)" }]
    })
  }, 120_000)

  it("serves the working directory with Vite, prints the report, and exits with 0 when nothing fails", async () => {
    const result = await run([], fixtures)
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^\[start\]\n {2}not checked focus-outside-menu\n {4}not checked: no menu is open on this screen\n/)
    expect(result.stdout).toMatch(/\n {2}pass unreachable-control \(5 decided\)\n\nkeyboard walk of http:\/\/127\.0\.0\.1:\d+\/: 0 failures; checks 0 failed, 4 passed, 2 not checked on 1 screen\n$/)
  }, 120_000)

  it("prints one line per failure and JSON with --json, and exits with 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ritmo-keyboard-"))
    const route = join(dir, "route.json")
    writeFileSync(route, JSON.stringify({ screens: [{ name: "hud", path: "unreachable-control.html", noPress: true }] }))
    const text = await run(["--route", route], fixtures)
    expect(text.status).toBe(1)
    expect(text.stdout.split("\n")[0]).toBe(`FAIL unreachable-control [hud] button "Brake" at #hud > button: it is visible, and neither Tab nor the arrow keys of its group reach it. Fix: ${KeyboardWalk.fixes["unreachable-control"]}.`)
    const json = await run(["--json", `--route=${route}`], fixtures)
    expect(json.status).toBe(1)
    const report = JSON.parse(json.stdout) as KeyboardWalkModule.Report
    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([{
      check: "unreachable-control",
      screen: "hud",
      control: { role: "button", name: "Brake", selector: "#hud > button" },
      saw: "it is visible, and neither Tab nor the arrow keys of its group reach it",
      fix: KeyboardWalk.fixes["unreachable-control"]
    }])
  }, 120_000)
})
