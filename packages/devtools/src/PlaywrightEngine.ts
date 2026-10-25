/**
 * `Verify.Engine`s for real browsers, in Node: Chromium, WebKit, and
 * Firefox, headless through Playwright. The game's entry is served by a Vite
 * dev server and loaded in each browser beside a small runner, which plays
 * the replay with the entry's `replayTarget` and returns the checksums.
 *
 * `playwright` and `vite` are optional peer dependencies: install them, and
 * the browsers, only where this runs (a CI job, a machine checking a replay):
 *
 * ```sh
 * npm install --save-dev playwright vite
 * npx playwright install chromium webkit firefox
 * ```
 *
 * One that is missing makes each engine fail with `EngineMissing` naming
 * the install command; the others still run.
 *
 * The entry is served by a bare dev server rooted at `root`: imports
 * resolve through `node_modules`, the game's `vite.config` is not read, and
 * it must load in a browser (no Node built-ins).
 *
 * @module PlaywrightEngine
 * @docGroup devtools
 *
 * @example
 * ```ts
 * declare const replayTarget: (playback: Replay.Playback) => Replay.Target<typeof Game.schema, typeof Root>
 * declare const file: Replay.ReplayFile
 * // ---cut---
 * const browsers = PlaywrightEngine.make({ entry: "src/replay-target.ts", browsers: ["chromium", "webkit", "firefox"] })
 * const verified = await Verify.acrossEngines(replayTarget, file, { engines: browsers.engines })
 * await browsers.close()
 * ```
 */
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import * as Result from "@typeonce/ritmo/Result"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"

import type { Runner } from "./internal/verifyRunner.ts"
import type * as Replay from "./Replay.ts"
import type * as Verify from "./Verify.ts"

/** A browser engine Playwright runs. */
export type Browser = "chromium" | "webkit" | "firefox"

/** Every browser engine, in report order. */
export const browsers: ReadonlyArray<Browser> = ["chromium", "webkit", "firefox"]

/** Whether `name` is a browser engine Playwright runs (for parsing a command line). */
export const isBrowser = (name: string): name is Browser => (browsers as ReadonlyArray<string>).includes(name)

/** Which entry to load, and in which browsers. */
export interface Options {
  /** The module exporting `replayTarget`, the `make(playback)` factory `Replay.session` takes. */
  readonly entry: string
  readonly browsers: ReadonlyArray<Browser>
  /** The dev server's root: where `node_modules` is found. Defaults to the working directory. */
  readonly root?: string
}

/** The browser engines, and how to stop them. */
export interface Engines {
  /** One `Verify.Engine` per browser, in `options.browsers` order: pass them to `Verify.acrossEngines`. */
  readonly engines: ReadonlyArray<Verify.Engine>
  /** Closes the browsers and the dev server. Call it when the check is done. */
  readonly close: () => Promise<void>
}

interface Page {
  readonly evaluate: <R, A>(run: (argument: A) => R | Promise<R>, argument: A) => Promise<R>
}

interface Server {
  readonly url: string
  readonly close: () => Promise<void>
}

type Failed = Omit<Verify.EngineMissing, "engine"> | Omit<Verify.EngineFailed, "engine">

const missing = (reason: string, install: string): Failed => ({ _tag: "EngineMissing", reason, install })
const failed = (message: string): Failed => ({ _tag: "EngineFailed", message })
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** A path as a dev server URL path: `/@fs/` and the absolute path, with forward slashes. */
const fsPath = (path: string): string => `/@fs/${path.split(sep).join("/").replace(/^\/+/, "")}`

/** The page side, beside this file: `.ts` in the workspace, `.js` once built. */
const runnerPath = (): string => {
  const self = fileURLToPath(import.meta.url)
  return fileURLToPath(new URL(`./internal/verifyRunner${extname(self)}`, import.meta.url))
}

/**
 * The browser engines for `options.entry`. Nothing starts until an engine
 * is first used: the dev server once, each browser on its own engine's first
 * `trace`.
 */
export const make = (options: Options): Engines => {
  const root = resolve(options.root ?? ".")
  const entry = resolve(root, options.entry)
  let server: Promise<Result.Result<Server, Failed>> | undefined
  const pages = new Map<Browser, Promise<Result.Result<Page, Failed>>>()
  const closers: Array<() => Promise<void>> = []

  const startServer = async (): Promise<Result.Result<Server, Failed>> => {
    let vite: typeof import("vite")
    try {
      vite = await import("vite")
    } catch {
      return Result.failure(missing("vite is not installed", "npm install --save-dev vite"))
    }
    const html = [
      "<!doctype html><meta charset=\"utf-8\"><title>ritmo verify</title>",
      "<script type=\"module\">",
      `import { start } from ${JSON.stringify(fsPath(runnerPath()))}`,
      `globalThis.__ritmoVerify = start(${JSON.stringify(fsPath(entry))})`,
      "</script>"
    ].join("\n")
    try {
      const dev = await vite.createServer({
        root,
        configFile: false,
        logLevel: "silent",
        clearScreen: false,
        appType: "custom",
        server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { strict: false } },
        // Discovery would optimize dependencies mid-run and reload the page.
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [{
          name: "ritmo-verify",
          configureServer: (dev) => {
            dev.middlewares.use("/__ritmo-verify", (_request, response) => {
              response.setHeader("content-type", "text/html")
              response.end(html)
            })
          }
        }]
      })
      await dev.listen()
      const address = dev.httpServer?.address()
      if (address === null || address === undefined || typeof address === "string") {
        await dev.close()
        return Result.failure(failed("the Vite dev server did not report its port"))
      }
      return Result.success({ url: `http://127.0.0.1:${address.port}/__ritmo-verify`, close: () => dev.close() })
    } catch (error) {
      return Result.failure(failed(`the Vite dev server did not start: ${messageOf(error)}`))
    }
  }

  const openPage = async (browser: Browser): Promise<Result.Result<Page, Failed>> => {
    let playwright: typeof import("playwright")
    try {
      playwright = await import("playwright")
    } catch {
      return Result.failure(missing("playwright is not installed", `npm install --save-dev playwright && npx playwright install ${browser}`))
    }
    server ??= startServer()
    const served = await server
    if (!served.ok) return served
    let launched: Awaited<ReturnType<typeof playwright.chromium.launch>>
    try {
      launched = await playwright[browser].launch()
    } catch (error) {
      const message = messageOf(error)
      return Result.failure(/Executable doesn't exist|playwright install/i.test(message)
        ? missing(`the ${browser} browser is not downloaded`, `npx playwright install ${browser}`)
        : failed(`${browser} did not launch: ${message}`))
    }
    closers.push(() => launched.close())
    try {
      const page = await launched.newPage()
      const errors: Array<string> = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto(served.value.url)
      const started = await page.evaluate(async () => {
        const result = await (Reflect.get(globalThis, "__ritmoVerify") as Promise<Result.Result<unknown, string>> | undefined)
        if (result === undefined) return "the runner did not start"
        if (!result.ok) return result.error
        Reflect.set(globalThis, "__ritmoRunner", result.value)
        return undefined
      })
      if (started !== undefined) return Result.failure(failed([started, ...errors].join("\n")))
      return Result.success(page)
    } catch (error) {
      return Result.failure(failed(`the page did not load: ${messageOf(error)}`))
    }
  }

  const engine = (browser: Browser): Verify.Engine => {
    const page = () => {
      let opened = pages.get(browser)
      if (opened === undefined) {
        opened = openPage(browser)
        pages.set(browser, opened)
      }
      return opened
    }
    const call = async <A>(run: (page: Page) => Promise<Result.Result<A, string>>): Promise<Result.Result<A, Verify.EngineError>> => {
      const opened = await page()
      if (!opened.ok) return Result.failure({ ...opened.error, engine: browser })
      try {
        const result = await run(opened.value)
        return result.ok ? result : Result.failure({ _tag: "EngineFailed", engine: browser, message: result.error })
      } catch (error) {
        return Result.failure({ _tag: "EngineFailed", engine: browser, message: messageOf(error) })
      }
    }
    // These functions are sent to the page as source and run there: they reach only the page's globals.
    // What crosses is the replay file in, and plain results out.
    return {
      name: browser,
      trace: (file) => call((opened) => opened.evaluate((input: Replay.ReplayFile) =>
        (Reflect.get(globalThis, "__ritmoRunner") as Runner).trace(input), file)),
      snapshotAt: (file, tick) => call<Snapshot.WorldSnapshot>((opened) => opened.evaluate((input: { readonly file: Replay.ReplayFile; readonly tick: number }) =>
        (Reflect.get(globalThis, "__ritmoRunner") as Runner).snapshotAt(input.file, input.tick), { file, tick }))
    }
  }

  return {
    engines: options.browsers.map(engine),
    close: async () => {
      await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)))
      const started = await server
      server = undefined
      pages.clear()
      if (started?.ok === true) await started.value.close()
    }
  }
}
