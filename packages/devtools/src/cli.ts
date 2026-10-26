#!/usr/bin/env node
/**
 * `ritmo-devtools`: devtools from the command line.
 *
 *   ritmo-devtools lint <entry>
 *   ritmo-devtools verify <entry> <replay> [--engines node,chromium,webkit,firefox] [--json]
 *   ritmo-devtools scan <entry> [--json]
 *
 * `lint` imports `<entry>` (a module exporting `lintTarget`, see the `Lint` module),
 * prints every lint of its schedules with its fix, and exits with 1 when one
 * is a warning. Info-level lints are printed and do not fail.
 *
 * It also checks simulation coverage: every module that importing `<entry>`
 * loads (inside the directory of `.oxlintrc.json` in the working directory,
 * outside `node_modules`) must have `ritmo/keep-simulation-headless` on in that
 * config, so the oxlint simulation rules check it. Each one that does not is
 * printed as `uncovered-simulation-module` and exits with 1. Only modules
 * loaded by importing the entry are checked: modules imported inside
 * `lintTarget` (such as render schedules passed to `describe`) or loaded later
 * are host code and are not. Type-only imports never load and are not checked.
 * A missing or unreadable config, one with `extends`, or one that never turns
 * the rule on prints why the check was skipped and does not fail.
 *
 * Last, it notes each Ritmo skill (`ritmo`, `ritmo-prototype`) the project
 * does not link from the installed package (`.agents/skills/<skill>` or
 * `.claude/skills/<skill>`, see `SETUP.md`), or holds a copy of it that goes
 * stale on upgrade. The note never fails the lint.
 *
 * `verify` imports `<entry>` (a module exporting `replayTarget`, the
 * `make(playback)` factory `Replay.session` takes), plays the replay file in
 * Node and in each listed browser engine, and prints the first tick whose
 * checksum differs from Node's, with every value that differs there (see the
 * `Verify` module). Node always runs, as the reference; `--engines node` (the
 * default) needs no other dependency. Browser engines need `playwright` and
 * `vite` (see the `PlaywrightEngine` module); one that is not installed is
 * printed with its install command and fails the check. `--json` prints the
 * result as JSON instead of text.
 *
 * `scan` resolves every file `<entry>` (the simulation entry) imports,
 * `node_modules` included, and runs the oxlint rules `ritmo/use-ops-for-math`,
 * `ritmo/use-clock-for-time`, and `ritmo/use-random-for-randomness` over them,
 * so a dependency that calls `Math.sin`, `Date.now`, or `Math.random` shows
 * before a desync does. Findings are printed per package with what to do next;
 * `--json` prints them as JSON instead. It is a hint, not a verdict: it exits
 * with 0 with or without findings. It needs `rolldown` (Vite 8 includes it)
 * and the game's `oxlint` with `@typeonce/oxlint-plugin-ritmo`; a missing one
 * is printed with its install command and exits with 2.
 *
 * Exit codes: 0 ok (and every `scan` that ran), 1 lint warning, uncovered
 * module, or an engine that differs or did not run, 2 usage error (for `scan`
 * also an unreadable entry, an import that does not resolve, or a missing tool).
 * Requires Node 22.15 or later for `module.registerHooks`; on older Node it
 * prints that coverage was not checked.
 *
 * @module cli
 * @docGroup devtools
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import * as DependencyScan from "./internal/dependencyScan.ts"
import * as SimulationCoverage from "./internal/simulationCoverage.ts"
import * as SkillLink from "./internal/skillLink.ts"
import * as Lint from "./Lint.ts"
import * as Replay from "./Replay.ts"
import * as Verify from "./Verify.ts"

const usage = [
  "usage: ritmo-devtools lint <entry>",
  "       ritmo-devtools verify <entry> <replay> [--engines node,chromium,webkit,firefox] [--json]",
  "       ritmo-devtools scan <entry> [--json]",
  "  lint:   <entry> exports lintTarget: () => { runtime, schedules, describe?, hostEvents? } (see the Lint module)",
  "  verify: <entry> exports replayTarget: (playback) => { runtime, schedules, hostClock } (see the Verify module)",
  "  scan:   <entry> is the simulation's entry module; every file it imports, node_modules included, is checked for Math, clock, and randomness calls"
].join("\n")

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** Checks at runtime what the type of `lintTarget`'s result promises, so a wrong entry fails with a message. */
const isTarget = (value: unknown): value is Lint.Target<any, any> =>
  isRecord(value)
  && isRecord(value["runtime"])
  && isRecord(value["runtime"]["debug"])
  && typeof value["runtime"]["debug"]["describe"] === "function"
  && isRecord(value["schedules"])
  && (value["describe"] === undefined || isRecord(value["describe"]))
  && (value["hostEvents"] === undefined || Array.isArray(value["hostEvents"]))

const main = async (args: ReadonlyArray<string>): Promise<number> => {
  const [command, ...rest] = args
  if (command === "lint" && rest.length === 1) return lint(rest[0]!)
  if (command === "verify") return verify(rest)
  if (command === "scan") return scan(rest)
  console.error(usage)
  return 2
}

const lint = async (entry: string): Promise<number> => {
  const loads = SimulationCoverage.recordLoads()
  const loaded: unknown = await import(pathToFileURL(resolve(entry)).href)
  // Snapshot before lintTarget runs: modules it imports (render schedules to describe) are host code.
  const simulationModules = loads?.()
  const make = isRecord(loaded) ? loaded["lintTarget"] : undefined
  if (typeof make !== "function") {
    console.error(`${entry} must export lintTarget: a function returning { runtime, schedules, describe? } (see the Lint module)`)
    return 2
  }
  const target: unknown = await make()
  if (!isTarget(target)) {
    console.error(`lintTarget in ${entry} must return { runtime, schedules, describe? } with a runtime made with debug: { hostClock }`)
    return 2
  }
  const report = Lint.run(target)
  console.log(report.text)
  const status = (() => {
    if (simulationModules === undefined) {
      console.log("simulation coverage not checked: needs Node 22.15 or later (module.registerHooks)")
      return report.data.ok ? 0 : 1
    }
    const coverage = SimulationCoverage.check(process.cwd(), resolve(entry), simulationModules)
    const text = SimulationCoverage.format(coverage)
    if (text !== "") console.log(text)
    return report.data.ok && (!coverage.checked || coverage.uncovered.length === 0) ? 0 : 1
  })()
  // A note only: it never changes the exit code.
  const skill = SkillLink.format(SkillLink.check(process.cwd()))
  if (skill !== "") console.log(skill)
  return status
}

const engineNames = ["node", "chromium", "webkit", "firefox"] as const

const verify = async (args: ReadonlyArray<string>): Promise<number> => {
  const positional: Array<string> = []
  let engines: ReadonlyArray<string> = ["node"]
  let json = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === "--json") json = true
    else if (arg === "--engines") engines = (args[++index] ?? "").split(",").filter((name) => name !== "")
    else if (arg.startsWith("--engines=")) engines = arg.slice("--engines=".length).split(",").filter((name) => name !== "")
    else positional.push(arg)
  }
  const [entry, replay] = positional
  if (entry === undefined || replay === undefined || positional.length !== 2) {
    console.error(usage)
    return 2
  }
  const unknown = engines.filter((name) => !(engineNames as ReadonlyArray<string>).includes(name))
  if (engines.length === 0 || unknown.length > 0) {
    console.error(`--engines takes a comma-separated list of ${engineNames.join(", ")}${unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""}`)
    return 2
  }
  let data: unknown
  try {
    data = JSON.parse(readFileSync(resolve(replay), "utf8"))
  } catch (error) {
    console.error(`${replay} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const file = Replay.parse(data)
  if (!file.ok) {
    console.error(`${replay} is not a replay file: ${file.error._tag === "InvalidReplay" ? file.error.message : file.error._tag}`)
    return 2
  }
  const loaded: unknown = await import(pathToFileURL(resolve(entry)).href)
  const make = isRecord(loaded) ? loaded["replayTarget"] : undefined
  if (typeof make !== "function") {
    console.error(`${entry} must export replayTarget: (playback) => { runtime, schedules, hostClock } (see the Verify module)`)
    return 2
  }
  // The browser adapter, and with it playwright and vite, loads only when a browser is listed.
  const browsers = engines.filter((name) => name !== "node")
  const PlaywrightEngine = browsers.length > 0 ? await import("./PlaywrightEngine.ts") : undefined
  const playwright = PlaywrightEngine?.make({ entry, browsers: browsers.filter(PlaywrightEngine.isBrowser) })
  let result: Awaited<ReturnType<typeof Verify.acrossEngines>>
  try {
    // The entry's type is checked where it is written; here only its shape is known.
    result = await Verify.acrossEngines(make as (playback: Replay.Playback) => Replay.Target<any, any>, file.value, { engines: playwright?.engines ?? [] })
  } catch (error) {
    console.error(`replayTarget in ${entry} threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    return 2
  } finally {
    await playwright?.close()
  }
  console.log(json ? JSON.stringify(result.ok ? { ok: true, ...result.value.data } : { ok: false, ...withoutText(result.error) }, null, 2) : result.ok ? result.value.text : result.error.text)
  return result.ok ? 0 : 1
}

const scan = async (args: ReadonlyArray<string>): Promise<number> => {
  const json = args.includes("--json")
  const positional = args.filter((arg) => arg !== "--json")
  if (positional.length !== 1 || positional[0]!.startsWith("-")) {
    console.error(usage)
    return 2
  }
  const result = await DependencyScan.run(positional[0]!, process.cwd())
  if (!result.ok) {
    const error = result.error
    console.error(error._tag === "ToolMissing"
      ? `scan needs ${error.tool}, which is not installed: ${error.install}`
      : error._tag === "ResolveFailed"
      ? `the imports of ${positional[0]} could not be resolved: ${error.message}`
      : error._tag === "LintFailed"
      ? `oxlint did not run: ${error.message}`
      : error.message)
    return 2
  }
  console.log(json ? JSON.stringify(result.value, null, 2) : DependencyScan.format(result.value))
  return 0
}

const withoutText = ({ text: _text, ...error }: Verify.VerifyError) => error

process.exitCode = await main(process.argv.slice(2))
