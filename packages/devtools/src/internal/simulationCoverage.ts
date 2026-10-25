/**
 * Simulation coverage for the `ritmo-devtools lint` CLI (Node only): which
 * modules the simulation loads that the oxlint simulation rules
 * (`ritmo/keep-simulation-headless` and its neighbours) do not cover.
 *
 * @internal
 */
import { readFileSync, realpathSync } from "node:fs"
import * as Module from "node:module"
import { dirname, isAbsolute, join, matchesGlob, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const configName = ".oxlintrc.json"
const rule = "ritmo/keep-simulation-headless"

/** Starts recording every `file:` module Node loads from now on. `undefined` when this Node has no `module.registerHooks` (before 22.15). */
export const recordLoads = (): (() => ReadonlyArray<string>) | undefined => {
  if (typeof Module.registerHooks !== "function") return undefined
  const urls = new Set<string>()
  Module.registerHooks({
    load: (url, context, nextLoad) => {
      if (url.startsWith("file:")) urls.add(url)
      return nextLoad(url, context)
    }
  })
  return () => [...urls]
}

export type Coverage =
  | { readonly checked: false; readonly reason: string }
  | { readonly checked: true; readonly uncovered: ReadonlyArray<string> }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Removes `//` and `/* *\/` comments outside strings, then trailing commas before `}` or `]`. */
const stripJsonc = (text: string): string => {
  let out = ""
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    if (char === "\"") {
      let end = index + 1
      while (end < text.length && text[end] !== "\"") end += text[end] === "\\" ? 2 : 1
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index++
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index++
    }
  }
  return out.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (match, string: string | undefined, close: string | undefined) =>
    string !== undefined ? match : close!)
}

/** `true` on, `false` off, `undefined` when the value does not set the rule. */
const severity = (value: unknown): boolean | undefined => {
  const level = Array.isArray(value) ? value[0] : value
  if (level === "error" || level === "warn" || level === 1 || level === 2) return true
  if (level === "off" || level === 0) return false
  return undefined
}

const globs = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((glob): glob is string => typeof glob === "string") : []

const matches = (file: string, patterns: ReadonlyArray<string>): boolean =>
  patterns.some((pattern) => matchesGlob(file, pattern))

/**
 * Reads `.oxlintrc.json` in `cwd` and returns the loaded modules inside its
 * directory (outside `node_modules`, not the entry) where `ritmo/keep-simulation-headless`
 * is not on, as posix paths relative to the config, sorted.
 */
export const check = (cwd: string, entry: string, loaded: ReadonlyArray<string>): Coverage => {
  const configPath = join(cwd, configName)
  let text: string
  try {
    text = readFileSync(configPath, "utf8")
  } catch {
    return { checked: false, reason: `no ${configName} in ${cwd}` }
  }
  let config: unknown
  try {
    config = JSON.parse(stripJsonc(text))
  } catch {
    return { checked: false, reason: `${configName} is not valid JSON with comments` }
  }
  if (!isRecord(config)) return { checked: false, reason: `${configName} is not an object` }
  if (config["extends"] !== undefined) return { checked: false, reason: `${configName} uses "extends", which this check does not follow` }
  const topLevel = isRecord(config["rules"]) ? severity(config["rules"][rule]) : undefined
  const overrides = (Array.isArray(config["overrides"]) ? config["overrides"] : []).filter(isRecord).map((override) => ({
    files: globs(override["files"]),
    setting: isRecord(override["rules"]) ? severity(override["rules"][rule]) : undefined
  }))
  if (topLevel !== true && !overrides.some((override) => override.setting === true)) {
    return { checked: false, reason: `no rules in ${configName} turn on ${rule}` }
  }
  const ignored = globs(config["ignorePatterns"])
  const root = realpathSync(dirname(configPath))
  const entryPath = realpathSync(entry)
  const uncovered = new Set<string>()
  for (const url of loaded) {
    let file: string
    try {
      file = realpathSync(fileURLToPath(url))
    } catch {
      continue
    }
    const path = relative(root, file)
    if (file === entryPath || path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) continue
    const posix = path.split(sep).join("/")
    if (posix.split("/").includes("node_modules")) continue
    let on = topLevel === true
    for (const override of overrides) {
      if (override.setting !== undefined && matches(posix, override.files)) on = override.setting
    }
    if (!on || matches(posix, ignored)) uncovered.add(posix)
  }
  return { checked: true, uncovered: [...uncovered].sort() }
}

/** The CLI text for a coverage result: a "not checked" line, or one block per uncovered module. */
export const format = (coverage: Coverage): string =>
  !coverage.checked
    ? `simulation coverage not checked: ${coverage.reason}`
    : coverage.uncovered.map((file) =>
      `uncovered-simulation-module  ${file}\n`
      + `  The simulation loads this file, but the simulation rules in ${configName} do not cover it.\n`
      + `  Add it to the simulation override's "files", or stop importing values from it.\n`
      + `  A host module (render, input glue) imported at the top of the lint entry is loaded too: import it inside lintTarget instead.`
    ).join("\n")
