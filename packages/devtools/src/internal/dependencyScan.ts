/**
 * The dependency determinism scan behind `ritmo-devtools scan <entry>` (Node
 * only): every file the simulation entry imports, `node_modules` included,
 * checked with the oxlint rules `ritmo/use-ops-for-math`,
 * `ritmo/use-clock-for-time`, and `ritmo/use-random-for-randomness`.
 *
 * The import closure comes from rolldown: a real bundler resolves exactly
 * what a game's build resolves (package `exports`, `browser` fields, CJS and
 * ESM, TypeScript with type-only imports erased), and its module graph
 * (`this.getModuleIds()`) lists every loaded file, including ones tree-shaking
 * would drop. Rolldown is what Vite 8 builds with, so a game with Vite 8 needs
 * nothing new: it is found as Vite's own dependency when the game does not
 * install it directly. esbuild (through tsx) was the alternative, but Vite 8
 * no longer depends on it, so fewer games would have it.
 *
 * The files are checked by spawning the game's own `oxlint` with
 * `@typeonce/oxlint-plugin-ritmo` (both are in every game's setup) and a
 * generated config that turns on only those three rules. Running the rules
 * themselves, not a scanner that mirrors them, keeps one definition of what is
 * flagged: the scan reports exactly what the lint would report if the
 * dependency were the game's code, and what `oxlint --fix` fixes after the
 * dependency is vendored.
 *
 * Each tool is looked up from the entry's directory first, then from devtools
 * (`oxlint` and `rolldown` are optional peer dependencies).
 *
 * @internal
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as Result from "@typeonce/ritmo/Result"

/** The rules the scan runs: the determinism rules a dependency can break. */
export const rules = ["ritmo/use-ops-for-math", "ritmo/use-clock-for-time", "ritmo/use-random-for-randomness"] as const

export type Rule = (typeof rules)[number]

/** One report of a rule, at a 1-based line and column (UTF-16) in a file relative to the working directory. */
export interface Finding {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly rule: Rule
  /** The flagged source (`Math.sin`, `x ** 3`, `Date.now`), shortened to one line. */
  readonly snippet: string
}

/** Findings of the files that belong to one package (nearest `package.json` with a `name`). */
export interface PackageReport {
  readonly name: string
  readonly files: number
  readonly findings: ReadonlyArray<Finding>
}

/** The scan result; `packages` starts with the entry's own package, then the rest by name. */
export interface Report {
  readonly entry: string
  readonly files: number
  readonly packages: ReadonlyArray<PackageReport>
}

export type ScanError =
  | { readonly _tag: "EntryUnreadable"; readonly message: string }
  | { readonly _tag: "ToolMissing"; readonly tool: string; readonly install: string }
  | { readonly _tag: "ResolveFailed"; readonly message: string }
  | { readonly _tag: "LintFailed"; readonly message: string }

const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/
const chunkSize = 400
const unnamed = "(no package)"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

/** The real directory of the installed package `name`, looked up through `node_modules` from `from` upward. */
const findPackage = (name: string, from: string): string | undefined => {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
    if (dirname(directory) === directory) return undefined
  }
}

const exportTarget = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return exportTarget(value[0])
  if (!isRecord(value)) return undefined
  for (const [condition, target] of Object.entries(value)) {
    if (condition === "import" || condition === "node" || condition === "default") {
      const found = exportTarget(target)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** The file the package's main entry imports (`exports["."]` with `import`/`node`/`default`, then `module`, `main`). */
const packageEntry = (directory: string): string => {
  const manifest = readJson(join(directory, "package.json"))
  const record = isRecord(manifest) ? manifest : {}
  const exports = record["exports"]
  const main = isRecord(exports) && "." in exports ? exports["."] : exports
  const target = exportTarget(main)
    ?? (typeof record["module"] === "string" ? record["module"] : undefined)
    ?? (typeof record["main"] === "string" ? record["main"] : "index.js")
  return join(directory, target)
}

const devtoolsDirectory = dirname(fileURLToPath(import.meta.url))

const locate = (name: string, from: string): string | undefined =>
  findPackage(name, from) ?? findPackage(name, devtoolsDirectory)

interface Bundle {
  readonly generate: (options: object) => Promise<unknown>
  readonly close: () => Promise<void>
}
type Rolldown = (options: object) => Promise<Bundle>

/** Rolldown, installed directly or as Vite 8's dependency. */
const loadRolldown = async (from: string): Promise<Rolldown | undefined> => {
  const vite = locate("vite", from)
  const directory = locate("rolldown", from) ?? (vite === undefined ? undefined : findPackage("rolldown", vite))
  if (directory === undefined) return undefined
  const loaded: unknown = await import(pathToFileURL(packageEntry(directory)).href)
  const rolldown = isRecord(loaded) ? loaded["rolldown"] : undefined
  // The module is untyped here (an optional peer); only its shape was checked.
  return typeof rolldown === "function" ? rolldown as Rolldown : undefined
}

/** Every source file the entry imports, itself included, as real absolute paths. */
const closure = async (rolldown: Rolldown, entry: string): Promise<ReadonlyArray<string>> => {
  let ids: ReadonlyArray<string> = []
  const bundle = await rolldown({
    input: entry,
    cwd: dirname(entry),
    // The build that ships to players; Node builtins stay external.
    platform: "browser",
    treeshake: false,
    logLevel: "silent",
    plugins: [{
      name: "ritmo-devtools-scan",
      buildEnd(this: { getModuleIds: () => Iterable<string> }) {
        ids = [...this.getModuleIds()]
      }
    }]
  })
  try {
    await bundle.generate({})
  } finally {
    await bundle.close()
  }
  return [...new Set(ids.filter((id) => isAbsolute(id) && sourceFile.test(id) && existsSync(id)).map((id) => realpathSync(id)))].sort()
}

interface Diagnostic {
  readonly file: string
  readonly rule: Rule
  readonly offset: number
  readonly length: number
}

const parseDiagnostics = (stdout: string): ReadonlyArray<Diagnostic> | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["diagnostics"])) return undefined
  const out: Array<Diagnostic> = []
  for (const diagnostic of parsed["diagnostics"]) {
    if (!isRecord(diagnostic) || typeof diagnostic["code"] !== "string" || typeof diagnostic["filename"] !== "string") continue
    const rule = diagnostic["code"].replace(/^ritmo\((.*)\)$/, "ritmo/$1")
    const label = Array.isArray(diagnostic["labels"]) ? diagnostic["labels"][0] : undefined
    const span = isRecord(label) && isRecord(label["span"]) ? label["span"] : undefined
    if (!(rules as ReadonlyArray<string>).includes(rule) || span === undefined) continue
    if (typeof span["offset"] !== "number" || typeof span["length"] !== "number") continue
    out.push({ file: diagnostic["filename"], rule: rule as Rule, offset: span["offset"], length: span["length"] })
  }
  return out
}

const lint = (oxlint: string, plugin: string, files: ReadonlyArray<string>): Result.Result<ReadonlyArray<Diagnostic>, ScanError> => {
  const directory = mkdtempSync(join(tmpdir(), "ritmo-scan-"))
  try {
    const config = join(directory, "oxlintrc.json")
    writeFileSync(config, JSON.stringify({
      jsPlugins: [plugin],
      categories: { correctness: "off" },
      rules: Object.fromEntries(rules.map((rule) => [rule, "error"])),
      ignorePatterns: []
    }))
    const diagnostics: Array<Diagnostic> = []
    for (let start = 0; start < files.length; start += chunkSize) {
      const run = spawnSync(
        process.execPath,
        [oxlint, "-c", config, "--format", "json", "--no-ignore", "--disable-nested-config", ...files.slice(start, start + chunkSize)],
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 }
      )
      const parsed = parseDiagnostics(run.stdout ?? "")
      if (parsed === undefined) {
        return Result.failure({ _tag: "LintFailed", message: (run.stderr || run.stdout || run.error?.message || "no output").trim() })
      }
      diagnostics.push(...parsed)
    }
    return Result.success(diagnostics)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const shorten = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

/** Line, column (UTF-16), and snippet of each byte span (oxlint reports UTF-8 offsets), walking the file once. */
const locateSpans = (path: string, cwd: string, found: ReadonlyArray<Diagnostic>): ReadonlyArray<Finding> => {
  const bytes = readFileSync(path)
  const file = relative(cwd, path)
  const sorted = [...found].sort((a, b) => a.offset - b.offset)
  const out: Array<Finding> = []
  let cursor = 0
  let line = 1
  let column = 1
  for (const diagnostic of sorted) {
    const end = Math.min(diagnostic.offset, bytes.length)
    let lineStart = cursor
    for (let index = cursor; index < end; index++) {
      if (bytes[index] === 0x0a) {
        line++
        column = 1
        lineStart = index + 1
      }
    }
    column += bytes.subarray(lineStart, end).toString("utf8").length
    cursor = end
    out.push({
      file,
      line,
      column,
      rule: diagnostic.rule,
      snippet: shorten(bytes.subarray(diagnostic.offset, diagnostic.offset + diagnostic.length).toString("utf8"))
    })
  }
  return out
}

/** The `name` of the nearest `package.json` above `file` that has one. */
const packageOf = (cache: Map<string, string | undefined>, file: string): string | undefined => {
  const visited: Array<string> = []
  let name: string | undefined
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    if (cache.has(directory)) {
      name = cache.get(directory)
      break
    }
    visited.push(directory)
    const manifest = readJson(join(directory, "package.json"))
    if (isRecord(manifest) && typeof manifest["name"] === "string" && manifest["name"] !== "") {
      name = manifest["name"]
      break
    }
    if (dirname(directory) === directory) break
  }
  for (const directory of visited) cache.set(directory, name)
  return name
}

/** Scans the import closure of `entry`; paths in the report are relative to `cwd`. */
export const run = async (entry: string, cwd: string): Promise<Result.Result<Report, ScanError>> => {
  const absolute = resolve(cwd, entry)
  try {
    if (!statSync(absolute).isFile()) return Result.failure({ _tag: "EntryUnreadable", message: `${entry} is not a file` })
    readFileSync(absolute)
  } catch (error) {
    return Result.failure({ _tag: "EntryUnreadable", message: `${entry} could not be read: ${error instanceof Error ? error.message : String(error)}` })
  }
  const from = dirname(realpathSync(absolute))
  const rolldown = await loadRolldown(from)
  if (rolldown === undefined) {
    return Result.failure({ _tag: "ToolMissing", tool: "rolldown (or vite 8, which includes it)", install: "npm install --save-dev rolldown" })
  }
  const oxlint = locate("oxlint", from)
  const plugin = locate("@typeonce/oxlint-plugin-ritmo", from)
  if (oxlint === undefined || plugin === undefined) {
    return Result.failure({ _tag: "ToolMissing", tool: "oxlint with @typeonce/oxlint-plugin-ritmo", install: "npm install --save-dev oxlint @typeonce/oxlint-plugin-ritmo" })
  }
  const manifest = readJson(join(oxlint, "package.json"))
  const bin = isRecord(manifest) ? manifest["bin"] : undefined
  const oxlintBin = join(oxlint, typeof bin === "string" ? bin : isRecord(bin) && typeof bin["oxlint"] === "string" ? bin["oxlint"] : "bin/oxlint")

  let files: ReadonlyArray<string>
  try {
    files = await closure(rolldown, realpathSync(absolute))
  } catch (error) {
    return Result.failure({ _tag: "ResolveFailed", message: error instanceof Error ? error.message : String(error) })
  }
  const diagnostics = lint(oxlintBin, packageEntry(plugin), files)
  if (!diagnostics.ok) return diagnostics

  const base = realpathSync(cwd)
  const byFile = new Map<string, Array<Diagnostic>>()
  for (const diagnostic of diagnostics.value) {
    const path = realpathSync(diagnostic.file)
    byFile.set(path, [...(byFile.get(path) ?? []), diagnostic])
  }
  const cache = new Map<string, string | undefined>()
  const own = packageOf(cache, realpathSync(absolute)) ?? unnamed
  const groups = new Map<string, { files: number; findings: Array<Finding> }>([[own, { files: 0, findings: [] }]])
  for (const file of files) {
    const name = packageOf(cache, file) ?? unnamed
    const group = groups.get(name) ?? { files: 0, findings: [] }
    group.files++
    group.findings.push(...locateSpans(file, base, byFile.get(file) ?? []))
    groups.set(name, group)
  }
  const packages = [...groups]
    .sort(([a], [b]) => a === own ? -1 : b === own ? 1 : a.localeCompare(b))
    .map(([name, group]) => ({ name, files: group.files, findings: group.findings }))
  return Result.success({ entry: relative(base, realpathSync(absolute)), files: files.length, packages })
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`

/** The text report: findings grouped by package, a summary line, and what to do next. */
export const format = (report: Report): string => {
  const flagged = report.packages.filter((entry) => entry.findings.length > 0)
  const total = flagged.reduce((sum, entry) => sum + entry.findings.length, 0)
  const lines: Array<string> = []
  for (const entry of flagged) {
    lines.push(`${entry.name} (${plural(entry.findings.length, "finding")})`)
    for (const finding of entry.findings) {
      lines.push(`  ${finding.file}:${finding.line}:${finding.column}  ${finding.rule}  ${finding.snippet}`)
    }
    lines.push("")
  }
  lines.push(`scanned ${plural(report.files, "file")} in ${plural(report.packages.length, "package")} imported by ${report.entry}: ${plural(total, "finding")} in ${plural(flagged.length, "package")}`)
  lines.push(total > 0
    ? "These are hints: code the simulation never calls is fine. For a dependency the simulation calls, vendor it into your source and run `oxlint --fix` with these rules on, or replace it; then confirm with Verify.acrossEngines (`ritmo-devtools verify`) or Netcode.syncTest."
    : "No dependency uses the Math functions, clock, or randomness these rules flag; confirm the whole run with Verify.acrossEngines (`ritmo-devtools verify`) or Netcode.syncTest.")
  return lines.join("\n")
}
