import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type * as LayoutWalkModule from "../src/internal/layoutWalk.ts"
import type * as RouteModule from "../src/internal/route.ts"

// The audit is internal to the CLI (the package exports no `internal/*`): load its source to call it with short waits.
const LayoutWalk = await import(new URL("../src/internal/layoutWalk.ts", import.meta.url).href) as typeof LayoutWalkModule
const Route = await import(new URL("../src/internal/route.ts", import.meta.url).href) as typeof RouteModule

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const fixtures = fileURLToPath(new URL("./fixtures/layout/", import.meta.url))

const run = (args: ReadonlyArray<string>, cwd: string) =>
  new Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }>((done) => {
    execFile(process.execPath, [cli, "layout", ...args], { cwd }, (error, stdout, stderr) => {
      done({ status: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout, stderr })
    })
  })

describe("ritmo-devtools layout arguments", () => {
  it("refuses a bad route, URL, or flag with exit code 2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ritmo-layout-"))
    const route = join(dir, "route.json")
    writeFileSync(route, JSON.stringify({ screens: [{ name: "a" }], minTarget: -1 }))
    expect(await run(["--route", route], fixtures)).toMatchObject({ status: 2, stdout: "", stderr: `${route} is not a layout route: route.minTarget must be a whole number of CSS pixels from 1 to 200 (the smallest tap area either side)\n` })
    expect(await run(["--url", "localhost:5173"], fixtures)).toMatchObject({ status: 2, stderr: "--url must be an http(s) URL of the game's page, such as http://localhost:5173/; got localhost:5173\n" })
    expect((await run(["--screenshots"], fixtures)).status).toBe(2)
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
if (skipped !== undefined) console.warn(`layout audit tests skipped: ${skipped}`)

const types: Record<string, string> = { ".html": "text/html" }

/** An iPhone held sideways: the camera's side and the home bar are the device's own. */
const phone: RouteModule.Viewport = { name: "phone", width: 844, height: 390, touch: true, insets: { top: 0, right: 47, bottom: 21, left: 47 } }
const smallPhone: RouteModule.Viewport = { name: "small-phone", width: 667, height: 375, touch: true, insets: { top: 0, right: 0, bottom: 0, left: 0 } }

describe.skipIf(skipped !== undefined)("ritmo-devtools layout", () => {
  let server: Server
  let base = ""
  let browser: Awaited<ReturnType<typeof import("playwright")["chromium"]["launch"]>>

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname
      const file = join(fixtures, path === "/" ? "clean.html" : path)
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

  interface Audit {
    readonly viewports?: ReadonlyArray<RouteModule.Viewport>
    readonly allow?: ReadonlyArray<RouteModule.Allow>
    readonly minTarget?: number
    readonly longerText?: boolean
    readonly steadyFor?: number
    readonly screenshots?: string
  }
  const audit = (fixture: string, options: Audit = {}) =>
    LayoutWalk.walk(browser, {
      url: base,
      route: { ...Route.startRoute, screens: [{ name: fixture, path: `${fixture}.html`, steps: [], noPress: [], allow: options.allow ?? [] }], viewports: options.viewports ?? [phone], minTarget: options.minTarget ?? 44 },
      settle: 100,
      settleLimit: 2000,
      steadyFor: options.steadyFor ?? 300,
      longerText: options.longerText ?? false,
      ...(options.screenshots === undefined ? {} : { screenshots: options.screenshots })
    })
  const found = (report: LayoutWalkModule.Report) =>
    report.findings.map((finding) => ({ check: finding.check, severity: finding.severity, pass: finding.pass, viewport: finding.viewport, text: finding.element?.text ?? "", other: finding.other?.text ?? "" }))

  it("finds nothing on a page laid out right at every default size, the longer text included", async () => {
    // A badge on its card, an invisible touch area under the content, a button under a scrim, a 24 px
    // button extended to 48 by ::after, a UI scaled to half, and a pulsing transform animation.
    const report = await audit("clean", { viewports: Route.defaultViewports, longerText: true })
    expect(found(report)).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.outcomes.filter((outcome) => outcome.status !== "passed")).toEqual([])
    expect(LayoutWalk.format(report)).toMatch(/layout audit of http:\/\/127\.0\.0\.1:\d+\/: 0 errors, 0 warnings on 1 screen at 4 viewports$/)
  }, 120_000)

  it("fails on two things drawn over each other, and names which is on top", async () => {
    const report = await audit("overlap")
    expect(found(report)).toEqual([
      { check: "overlap", severity: "error", pass: "normal", viewport: "phone", text: "Score 1200", other: "Lives 3" },
      { check: "overlap", severity: "error", pass: "normal", viewport: "phone", text: "Play", other: "Over it" }
    ])
    expect(report.findings[1]!.saw).toMatch(/the text is drawn over the/)
    expect(report.ok).toBe(false)
  }, 60_000)

  it("leaves out what the route allows, and counts it", async () => {
    const report = await audit("overlap", { allow: [{ check: "overlap", selector: ".b" }, { check: "overlap", selector: ".label" }] })
    expect(report.findings).toEqual([])
    expect(report.allowed).toBe(2)
    expect(report.ok).toBe(true)
  }, 60_000)

  it("fails on text a box cuts, and only warns when an ellipsis says it is cut", async () => {
    const cut = await audit("cut-text")
    expect(found(cut)).toEqual([{ check: "cut-text", severity: "error", pass: "normal", viewport: "phone", text: "The Gathering Storm", other: "" }])
    const truncated = await audit("truncated-text")
    expect(found(truncated)).toEqual([{ check: "truncated-text", severity: "warning", pass: "normal", viewport: "phone", text: "Training Dummy", other: "" }])
    expect(truncated.ok).toBe(true)
  }, 60_000)

  it("fails on a control past the screen's edge, and on one in the device's own space only where the device keeps it", async () => {
    expect(found(await audit("off-screen"))).toEqual([{ check: "off-screen", severity: "error", pass: "normal", viewport: "phone", text: "Shop", other: "" }])
    // At the left edge: inside the notch on the phone, fine on a phone without one; the button offset by env() is fine on both.
    expect(found(await audit("safe-area", { viewports: [phone, smallPhone] }))).toEqual([{ check: "safe-area", severity: "error", pass: "normal", viewport: "phone", text: "Menu", other: "" }])
  }, 60_000)

  it("fails on a small tap area, and on the route's own minimum", async () => {
    const report = await audit("small-target")
    expect(found(report)).toEqual([{ check: "small-target", severity: "error", pass: "normal", viewport: "phone", text: "Close", other: "" }])
    expect(report.findings[0]!.saw).toBe("a tap reaches it over 20 x 20 px (at least 44 x 44)")
    expect((await audit("small-target", { minTarget: 20 })).ok).toBe(true)
  }, 60_000)

  it("checks the buttons of a Touch layout drawn on the canvas", async () => {
    const report = await audit("touch")
    expect(found(report)).toEqual([
      { check: "overlap", severity: "error", pass: "normal", viewport: "phone", text: "dash", other: "Tip" },
      { check: "small-target", severity: "error", pass: "normal", viewport: "phone", text: "jump", other: "" }
    ])
  }, 60_000)

  it("fails on layout that shifts while nothing is pressed, and on layout that never holds still", async () => {
    expect(found(await audit("layout-shift", { steadyFor: 1500 }))).toEqual([{ check: "layout-shift", severity: "error", pass: "normal", viewport: "phone", text: "coins", other: "" }])
    const drifting = await audit("never-settled")
    expect(found(drifting)).toEqual([{ check: "never-settled", severity: "error", pass: "normal", viewport: "phone", text: "", other: "" }])
    expect(drifting.findings[0]!.saw).toMatch(/#drift/)
    expect(drifting.outcomes.filter((outcome) => outcome.status === "not-checked").map((outcome) => outcome.check)).toEqual(LayoutWalk.checks.filter((check) => check !== "never-settled"))
  }, 60_000)

  it("warns on a control half hidden at a scroll edge", async () => {
    const report = await audit("scroll-edge")
    expect(found(report)).toEqual([{ check: "scroll-edge", severity: "warning", pass: "normal", viewport: "phone", text: "Rank 3", other: "" }])
    expect(report.ok).toBe(true)
  }, 60_000)

  it("warns on what only breaks with every text 40% longer", async () => {
    const report = await audit("longer-text", { longerText: true })
    expect(found(report)).toEqual([{ check: "cut-text", severity: "warning", pass: "longer-text", viewport: "phone", text: "Continue Cont", other: "" }])
    expect(report.ok).toBe(true)
  }, 60_000)

  it("saves a screenshot with each finding numbered, and prints where", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ritmo-layout-shots-"))
    const report = await audit("overlap", { screenshots: dir })
    expect(report.findings.map((finding) => finding.screenshot)).toEqual([
      { file: join(dir, "overlap@phone.png"), number: 1 },
      { file: join(dir, "overlap@phone.png"), number: 2 }
    ])
    expect(existsSync(join(dir, "overlap@phone.png"))).toBe(true)
    expect(LayoutWalk.format(report)).toContain(`(${join(dir, "overlap@phone.png")} #1)`)
  }, 60_000)

  it("exits with 1 on an error and 0 on warnings alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ritmo-layout-cli-"))
    const route = (fixture: string) => {
      const file = join(dir, `${fixture}.json`)
      writeFileSync(file, JSON.stringify({ screens: [{ name: fixture, path: `${fixture}.html` }], viewports: [phone] }))
      return file
    }
    const failing = await run(["--url", base, "--route", route("small-target")], fixtures)
    expect(failing.status).toBe(1)
    expect(failing.stdout).toMatch(/^FAIL small-target \[small-target @ phone\] control "Close" at body > button: a tap reaches it over 20 x 20 px/)
    const warned = await run(["--url", base, "--route", route("truncated-text"), "--json"], fixtures)
    expect(warned.status).toBe(0)
    expect(JSON.parse(warned.stdout)).toMatchObject({ ok: true, findings: [{ check: "truncated-text", severity: "warning" }] })
  }, 120_000)
})
