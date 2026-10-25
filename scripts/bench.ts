/**
 * Benchmark runner and CI regression gate.
 *
 * Two suites run:
 *
 * - runtime: wall-clock timings of every `packages/<name>/bench/<suite>.bench.ts` file
 *   (each exports `cases`). Every score is `minMs / calibrationMs`: the
 *   fastest observed sample of the case divided by the fastest run of plain-JS
 *   calibration work, measured in the runner and briefly in every case's
 *   process (each case runs in a fresh process). Minimums are far less sensitive to other load on the machine
 *   than medians, and the ratio normalizes most machine-speed differences.
 *   Regressions are still allowed a tolerance because wall-clock time is
 *   noisy.
 * - types: checker metrics (types, instantiations) for the generated
 *   `packages/core/bench/types/stress.ts` program. These are deterministic for
 *   a given TypeScript version, so the tolerance is small.
 *
 * Usage:
 *
 *   pnpm bench                        run and print results
 *   pnpm bench:check                  compare against packages/core/bench/baseline.json, exit 1 on regression
 *   pnpm bench:update                 rewrite the baseline from the current results
 *   pnpm bench --compare <file.json>  compare runtime results against a `--json` run of another
 *                                     commit on the same machine (what CI does); types still
 *                                     compare against the committed baseline
 *
 * Flags: --filter <text> limits runtime cases, --json <path> writes raw results.
 * --warn-types reports type metric regressions as warnings without failing the run.
 * Type benchmark compilation errors still fail, as do runtime regressions.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import { calibration, measure, type BenchCase, type BenchSample, type MeasureOptions } from "../packages/core/bench/harness.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const baselinePath = fileURLToPath(new URL("../packages/core/bench/baseline.json", import.meta.url))
const typesProject = fileURLToPath(new URL("../packages/core/bench/types/tsconfig.json", import.meta.url))

const RUNTIME_TOLERANCE = 0.25
const TYPES_TOLERANCE = 0.05
const RETRIES = 2
const UPDATE_RUNS = 3

const measureOptions: MeasureOptions = {
  warmupMs: 150,
  budgetMs: 350,
  minSamples: 15,
  maxSamples: 400,
  minSampleMs: 2,
  minPreparedSamples: 30
}

// Each case process also measures calibration briefly; the fastest across all
// processes is far steadier than one long measurement.
const calibrationOptions: MeasureOptions = {
  ...measureOptions,
  warmupMs: 50,
  budgetMs: 100
}

interface RuntimeResult {
  readonly minMs: number
  readonly medianMs: number
  readonly score: number
}

interface Baseline {
  readonly runtime: {
    readonly tolerance: number
    readonly calibrationMs: number
    readonly environment: string
    readonly cases: Record<string, RuntimeResult>
  }
  readonly types: {
    readonly tolerance: number
    readonly typescript: string
    readonly metrics: Record<string, number>
  }
}

interface RunResults {
  readonly environment: string
  readonly calibrationMs: number
  readonly runtime: Record<string, RuntimeResult>
  readonly types: Record<string, number>
}

const args = process.argv.slice(2)
const flagValue = (flag: string): string | undefined => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const filter = flagValue("--filter")
const jsonPath = flagValue("--json")
const comparePath = flagValue("--compare")
const warnTypes = args.includes("--warn-types")
const mode = args.includes("--check") || comparePath !== undefined
  ? "check"
  : args.includes("--update") ? "update" : "run"

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url))
const suiteFiles = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(`${packagesDir}${entry.name}/bench`))
  .flatMap((entry) => readdirSync(`${packagesDir}${entry.name}/bench`)
    .filter((file) => file.endsWith(".bench.ts"))
    .map((file) => `${packagesDir}${entry.name}/bench/${file}`))
  .sort()
const cases: Array<BenchCase> = []
for (const file of suiteFiles) {
  const suite = await import(pathToFileURL(file).href) as { readonly cases: ReadonlyArray<BenchCase> }
  for (const bench of suite.cases) {
    if (cases.some((existing) => existing.name === bench.name)) {
      throw new Error(`Duplicate benchmark case "${bench.name}" in ${file}`)
    }
    cases.push(bench)
  }
}

const measureCalibration = (): number => measure(calibration, calibrationOptions).minMs

// Each case runs in a fresh process: cases share runtime code, and what earlier
// cases leave in V8's optimization state otherwise shifts later timings by
// tens of percent from one run to the next.
const caseFlag = flagValue("--case")
if (caseFlag !== undefined) {
  const bench = cases.find((candidate) => candidate.name === caseFlag)
  if (!bench) throw new Error(`Unknown benchmark case "${caseFlag}"`)
  const sample = measure(bench, measureOptions)
  const result: CaseRun = { sample, calibrationMs: measureCalibration() }
  process.stdout.write(JSON.stringify(result))
  process.exit(0)
}

interface CaseRun {
  readonly sample: BenchSample
  readonly calibrationMs: number
}

const measureCase = (name: string): CaseRun => JSON.parse(execFileSync(
  process.execPath,
  [...process.execArgv, fileURLToPath(import.meta.url), "--case", name],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
)) as CaseRun

const runRuntime = (): { calibrationMs: number; results: Record<string, RuntimeResult & BenchSample> } => {
  let calibrationMs = measureCalibration()
  const samples: Array<BenchSample> = []
  for (const bench of cases) {
    if (filter && !bench.name.includes(filter)) continue
    const run = measureCase(bench.name)
    samples.push(run.sample)
    calibrationMs = Math.min(calibrationMs, run.calibrationMs)
  }
  const results: Record<string, RuntimeResult & BenchSample> = {}
  for (const sample of samples) {
    results[sample.name] = { ...sample, score: sample.minMs / calibrationMs }
  }
  return { calibrationMs, results }
}

const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url))

const typescriptVersion = (): string =>
  execFileSync(tsc, ["--version"], { cwd: root, encoding: "utf8" }).trim()

const runTypes = (): Record<string, number> => {
  let output: string
  try {
    output = execFileSync(
      tsc,
      ["-p", typesProject, "--extendedDiagnostics", "--pretty", "false"],
      { cwd: root, encoding: "utf8" }
    )
  } catch (error) {
    const failed = error as { stdout?: string }
    throw new Error(`Type benchmark program failed to compile:\n${failed.stdout ?? String(error)}`)
  }
  const metric = (label: string): number => {
    const match = new RegExp(`^${label}:\\s+(\\d+)`, "m").exec(output)
    if (!match) throw new Error(`Missing "${label}" in tsc --extendedDiagnostics output`)
    return Number(match[1])
  }
  return {
    types: metric("Types"),
    instantiations: metric("Instantiations")
  }
}

const formatMs = (value: number): string => value >= 10 ? value.toFixed(1) : value.toFixed(3)
const formatDelta = (current: number, base: number): string => {
  const delta = (current / base - 1) * 100
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`
}

const readBaseline = (): Baseline | undefined =>
  existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline : undefined

const environment = `${os.cpus()[0]?.model ?? "unknown cpu"} / node ${process.version} / ${process.platform}`

const main = (): void => {
  const baseline = readBaseline()
  const reference = comparePath === undefined
    ? baseline?.runtime.cases
    : existsSync(comparePath)
      ? (JSON.parse(readFileSync(comparePath, "utf8")) as RunResults).runtime
      : undefined
  if (comparePath !== undefined && reference === undefined) {
    console.log(`No results at ${comparePath}; runtime cases are reported but not gated.\n`)
  }
  const referenceLabel = comparePath === undefined ? "baseline" : "compare"
  const tolerance = baseline?.runtime.tolerance ?? RUNTIME_TOLERANCE
  console.log(`Runtime suite (${environment})`)
  let runtime = runRuntime()
  if (mode === "update") {
    // Record the best of several full runs so one noisy run cannot skew the baseline.
    for (let run = 1; run < UPDATE_RUNS; run++) {
      const next = runRuntime()
      const results = { ...runtime.results }
      for (const [name, result] of Object.entries(next.results)) {
        if (result.score < results[name]!.score) results[name] = result
      }
      runtime = { calibrationMs: Math.min(runtime.calibrationMs, next.calibrationMs), results }
    }
  }
  const failures: Array<string> = []

  const rows: Array<Array<string>> = [["case", "min ms", "median ms", "score", referenceLabel, "delta"]]
  for (const [name, result] of Object.entries(runtime.results)) {
    let current = result
    const base = reference?.[name]
    const limit = base ? base.score * (1 + tolerance) : Infinity
    if (mode === "check" && base && current.score > limit) {
      // Wall-clock noise: re-measure a failing case before reporting it.
      for (let attempt = 0; attempt < RETRIES && current.score > limit; attempt++) {
        const { sample } = measureCase(name)
        const retried = { ...sample, score: sample.minMs / runtime.calibrationMs }
        if (retried.score < current.score) current = retried
      }
      if (current.score > limit) {
        failures.push(`runtime ${name}: score ${current.score.toFixed(3)} exceeds ${referenceLabel} ${base.score.toFixed(3)} by ${formatDelta(current.score, base.score)}`)
      }
    }
    rows.push([
      name,
      formatMs(current.minMs),
      formatMs(current.medianMs),
      current.score.toFixed(3),
      base ? base.score.toFixed(3) : "-",
      base ? formatDelta(current.score, base.score) : "-"
    ])
  }
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)))
  for (const row of rows) {
    console.log(row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join("  "))
  }
  console.log(`calibration: ${formatMs(runtime.calibrationMs)} ms`)

  const tsVersion = typescriptVersion()
  const types = runTypes()
  console.log(`\nType suite (${tsVersion})`)
  for (const [name, value] of Object.entries(types)) {
    const base = baseline?.types.metrics[name]
    console.log(`${name.padEnd(16)} ${String(value).padStart(10)}  baseline ${base ?? "-"}  ${base ? formatDelta(value, base) : ""}`)
    if (mode === "check" && base !== undefined && baseline?.types.typescript === tsVersion) {
      if (value > base * (1 + baseline.types.tolerance)) {
        const message = `types ${name}: ${value} exceeds baseline ${base} by ${formatDelta(value, base)}`
        if (warnTypes) console.warn(`::warning::${message}`)
        else failures.push(message)
      }
    }
  }
  if (mode === "check" && baseline && baseline.types.typescript !== tsVersion) {
    console.log(`Type baseline was recorded with ${baseline.types.typescript}; skipping type comparison. Run pnpm bench:update.`)
  }

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify({ environment, calibrationMs: runtime.calibrationMs, runtime: runtime.results, types }, null, 2)}\n`)
  }

  if (mode === "update") {
    if (filter) throw new Error("--update cannot be combined with --filter")
    const next: Baseline = {
      runtime: {
        tolerance: RUNTIME_TOLERANCE,
        calibrationMs: Number(runtime.calibrationMs.toFixed(4)),
        environment,
        cases: Object.fromEntries(Object.entries(runtime.results).map(([name, result]) => [name, {
          minMs: Number(result.minMs.toFixed(4)),
          medianMs: Number(result.medianMs.toFixed(4)),
          score: Number(result.score.toFixed(4))
        }]))
      },
      types: {
        tolerance: TYPES_TOLERANCE,
        typescript: tsVersion,
        metrics: types
      }
    }
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`\nBaseline written to ${baselinePath}`)
  }

  if (mode === "check") {
    if (!baseline) {
      console.error("\nNo baseline found. Run pnpm bench:update first.")
      process.exit(1)
    }
    // A case that no longer runs fails only while the committed baseline still lists it:
    // removing a case from baseline.json is how a change declares the removal on purpose.
    const missing = Object.keys(reference ?? {}).filter((name) => !(name in runtime.results) && !filter && name in (baseline?.runtime.cases ?? {}))
    for (const name of missing) failures.push(`runtime ${name}: case exists in the ${referenceLabel} but no longer runs`)
    if (failures.length > 0) {
      console.error(`\nPerformance regressions:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`)
      process.exit(1)
    }
    console.log("\nNo blocking performance regressions.")
  }
}

main()
