/**
 * Benchmark runner and CI regression gate.
 *
 * Two suites run:
 *
 * - runtime: wall-clock timings of every `packages/<name>/bench/<suite>.bench.ts` and
 *   `integration/<name>/bench/<suite>.bench.ts` file
 *   (each exports `cases`). Every score is `minMs / calibrationMs`: the
 *   fastest observed sample of the case divided by the fastest run of plain-JS
 *   calibration work, measured in the runner and briefly in every case's
 *   process (each case runs in a fresh process). Minimums are far less sensitive to other load on the machine
 *   than medians, and the ratio normalizes most machine-speed differences.
 *   Regressions are still allowed a tolerance because wall-clock time is
 *   noisy.
 * - allocations: the mean bytes one run of each runtime case allocates on the
 *   JS heap, garbage included, measured in another fresh process after a
 *   counted warmup (see `measureAllocations` in `harness.ts`). Garbage is what
 *   makes a game's frames stutter, and the mean moves by about 2% from one
 *   process to the next on one Node version, even on a loaded machine, so the
 *   gate is tight: growth past `ALLOCATION_TOLERANCE` and
 *   `ALLOCATION_SLACK_BYTES` fails. Allocation processes run in parallel.
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
 *                                     commit on the same machine; types still compare against
 *                                     the committed baseline
 *   pnpm bench --against <dir>        what CI runs: compare with a checkout of the base commit
 *                                     in <dir> on this machine. Every case gates its allocations;
 *                                     only `critical` cases are timed, in alternating base and
 *                                     head rounds, so load on a shared machine hits both sides.
 *
 * Flags: --filter <text> limits runtime cases, --json <path> writes raw results.
 * --warn-types reports type metric regressions as warnings without failing the run.
 * Type benchmark compilation errors still fail, as do runtime regressions.
 */
import { execFile, execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { calibration, measure, measureAllocations, type AllocationOptions, type AllocationSample, type BenchCase, type BenchSample, type MeasureOptions } from "../packages/core/bench/harness.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const baselinePath = fileURLToPath(new URL("../packages/core/bench/baseline.json", import.meta.url))
const typesProject = fileURLToPath(new URL("../packages/core/bench/types/tsconfig.json", import.meta.url))

const RUNTIME_TOLERANCE = 0.25
const ALLOCATION_TOLERANCE = 0.1
// Absorbs the bytes V8 allocates for itself, so a case that allocates nothing stays at noise.
const ALLOCATION_SLACK_BYTES = 1024
const TYPES_TOLERANCE = 0.05
const RETRIES = 2
const UPDATE_RUNS = 3
// Alternating base and head rounds per critical case under --against; a failing case gets RETRIES more.
const ROUNDS = 2

const measureOptions: MeasureOptions = {
  warmupMs: 150,
  budgetMs: 350,
  minSamples: 15,
  maxSamples: 400,
  minSampleMs: 2,
  minPreparedSamples: 30
}

const allocationOptions: AllocationOptions = {
  warmupRuns: 200,
  runs: 60
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
  /** Absent in results recorded before allocations were measured. */
  readonly bytesPerRun?: number
}

interface Baseline {
  readonly runtime: {
    readonly tolerance: number
    readonly allocationTolerance: number
    readonly allocationSlackBytes: number
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
const againstFlag = flagValue("--against")
const againstDir = againstFlag === undefined ? undefined : path.resolve(againstFlag)
const warnTypes = args.includes("--warn-types")
const mode = args.includes("--check") || comparePath !== undefined || againstDir !== undefined
  ? "check"
  : args.includes("--update") ? "update" : "run"

// Packages bench their own hot paths; integration games bench whole frames.
const suiteFiles = ["../packages/", "../integration/"].flatMap((relative) => {
  const dir = fileURLToPath(new URL(relative, import.meta.url))
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(`${dir}${entry.name}/bench`))
    .flatMap((entry) => readdirSync(`${dir}${entry.name}/bench`)
      .filter((file) => file.endsWith(".bench.ts"))
      .map((file) => `${dir}${entry.name}/bench/${file}`))
}).sort()
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
if (args.includes("--list")) {
  process.stdout.write(JSON.stringify(cases.map((bench) => bench.name)))
  process.exit(0)
}
const caseFlag = flagValue("--case")
if (caseFlag !== undefined) {
  const bench = cases.find((candidate) => candidate.name === caseFlag)
  if (!bench) throw new Error(`Unknown benchmark case "${caseFlag}"`)
  if (args.includes("--allocations")) {
    process.stdout.write(JSON.stringify(measureAllocations(bench, allocationOptions)))
    process.exit(0)
  }
  const sample = measure(bench, measureOptions)
  const result: CaseRun = { sample, calibrationMs: measureCalibration() }
  process.stdout.write(JSON.stringify(result))
  process.exit(0)
}

interface CaseRun {
  readonly sample: BenchSample
  readonly calibrationMs: number
}

/** Runs this script in `dir` (the repository, or a checkout of another commit) with `args`. */
const benchArgs = (dir: string, args: ReadonlyArray<string>, flags: ReadonlyArray<string> = []): Array<string> =>
  [...process.execArgv, ...flags, `${dir}/scripts/bench.ts`, ...args]

const measureCase = (name: string, dir = root): CaseRun => JSON.parse(execFileSync(
  process.execPath,
  benchArgs(dir, ["--case", name]),
  { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
)) as CaseRun

const execFileAsync = promisify(execFile)

// Without V8's background threads, the optimizing compiler makes the same
// decisions in every process. The mean does not depend on load, so these
// processes run side by side, one per core: `sides` lists the cases to count
// in each checkout, and the counts come back in the same order.
const measureAllocationsIn = async (
  sides: ReadonlyArray<{ readonly dir: string; readonly names: ReadonlyArray<string> }>
): Promise<Array<Record<string, number>>> => {
  const counts = sides.map((): Record<string, number> => ({}))
  const queue = sides.flatMap((side, index) => side.names.map((name) => ({ index, dir: side.dir, name })))
  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      const { stdout } = await execFileAsync(
        process.execPath,
        benchArgs(job.dir, ["--case", job.name, "--allocations"], ["--single-threaded"]),
        { cwd: job.dir, encoding: "utf8", maxBuffer: 1024 * 1024 }
      )
      counts[job.index]![job.name] = (JSON.parse(stdout) as AllocationSample).bytesPerRun
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, os.availableParallelism()) }, worker))
  return counts
}

/** A case measured by this run: allocations are always present, unlike in older recorded results. */
type CaseResult = RuntimeResult & BenchSample & { readonly bytesPerRun: number }

const selected = cases.filter((bench) => !filter || bench.name.includes(filter))

// `allocations` reuses counts measured by an earlier run; they do not change between runs.
const runRuntime = async (allocations?: Record<string, CaseResult>): Promise<{ calibrationMs: number; results: Record<string, CaseResult> }> => {
  const bytes = allocations
    ? Object.fromEntries(Object.entries(allocations).map(([name, result]) => [name, result.bytesPerRun]))
    : (await measureAllocationsIn([{ dir: root, names: selected.map((bench) => bench.name) }]))[0]!
  let calibrationMs = measureCalibration()
  const samples: Array<BenchSample & { readonly bytesPerRun: number }> = []
  for (const bench of selected) {
    const run = measureCase(bench.name)
    samples.push({ ...run.sample, bytesPerRun: bytes[bench.name]! })
    calibrationMs = Math.min(calibrationMs, run.calibrationMs)
  }
  const results: Record<string, CaseResult> = {}
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
const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes)} B`
// Allocation counts near zero make percentages meaningless; show the byte difference too.
const formatBytesDelta = (current: number, base: number): string =>
  base === 0 ? (current === 0 ? "0" : `+${formatBytes(current)}`) : formatDelta(current, base)
const formatDelta = (current: number, base: number): string => {
  const delta = (current / base - 1) * 100
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`
}

const readBaseline = (): Baseline | undefined =>
  existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline : undefined

const environment = `${os.cpus()[0]?.model ?? "unknown cpu"} / node ${process.version} / ${process.platform}`

const printTable = (rows: ReadonlyArray<ReadonlyArray<string>>): void => {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)))
  for (const row of rows) {
    console.log(row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join("  "))
  }
}

// Shows the CI comparison on the run's page, where a pull request links to it.
const writeSummary = (rows: ReadonlyArray<ReadonlyArray<string>>, failures: ReadonlyArray<string>): void => {
  const summary = process.env["GITHUB_STEP_SUMMARY"]
  if (!summary) return
  const line = (row: ReadonlyArray<string>): string => `| ${row.join(" | ")} |`
  appendFileSync(summary, [
    "## Performance against the base commit",
    "",
    failures.length > 0 ? failures.map((failure) => `- :x: ${failure}`).join("\n") : "No regressions.",
    "",
    "Every case gates its allocations; only critical cases (`*`) are timed.",
    "",
    line(rows[0]!),
    line(rows[0]!.map((_, column) => column === 0 ? "---" : "---:")),
    ...rows.slice(1).map(line),
    ""
  ].join("\n"))
}

interface Limits {
  readonly tolerance: number
  readonly allocationTolerance: number
  readonly allocationSlack: number
}

/**
 * CI: every case's allocations and every critical case's time against the base
 * commit checked out in `dir`, measured on this machine. Base and head take
 * turns, so load from other jobs on the machine lands on both sides.
 */
const runAgainst = async (dir: string, limits: Limits, baseline: Baseline | undefined, failures: Array<string>): Promise<void> => {
  let baseNames: ReadonlySet<string> = new Set()
  try {
    baseNames = new Set(JSON.parse(execFileSync(
      process.execPath,
      benchArgs(dir, ["--list"]),
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    )) as Array<string>)
  } catch {
    console.log("::warning::The base commit could not list its benchmark cases; nothing is compared with it.")
  }
  const names = selected.map((bench) => bench.name)
  const shared = names.filter((name) => baseNames.has(name))

  const [headBytes, baseBytes] = await measureAllocationsIn([{ dir: root, names }, { dir, names: shared }]) as [Record<string, number>, Record<string, number>]
  const overLimit = (name: string): boolean =>
    headBytes[name]! > baseBytes[name]! * (1 + limits.allocationTolerance) + limits.allocationSlack
  // A count over the limit is measured again on both sides; the means of both decide.
  const over = shared.filter(overLimit)
  if (over.length > 0) {
    const [head, base] = await measureAllocationsIn([{ dir: root, names: over }, { dir, names: over }]) as [Record<string, number>, Record<string, number>]
    for (const name of over) {
      headBytes[name] = Math.round((headBytes[name]! + head[name]!) / 2)
      baseBytes[name] = Math.round((baseBytes[name]! + base[name]!) / 2)
    }
  }
  for (const name of shared.filter(overLimit)) {
    failures.push(`allocations ${name}: ${formatBytes(headBytes[name]!)} per run exceeds base ${formatBytes(baseBytes[name]!)} by ${formatBytesDelta(headBytes[name]!, baseBytes[name]!)}`)
  }

  const times: Record<string, { head: number; base: number }> = {}
  for (const bench of selected.filter((candidate) => candidate.critical === true)) {
    const best = { head: Infinity, base: Infinity }
    let round = 0
    const play = (rounds: number): void => {
      for (const end = round + rounds; round < end; round++) {
        for (const side of round % 2 === 0 ? ["base", "head"] as const : ["head", "base"] as const) {
          if (side === "base" && !baseNames.has(bench.name)) continue
          best[side] = Math.min(best[side], measureCase(bench.name, side === "head" ? root : dir).sample.minMs)
        }
      }
    }
    const slower = (): boolean => best.head > best.base * (1 + limits.tolerance)
    play(ROUNDS)
    if (slower()) play(RETRIES)
    if (slower()) failures.push(`runtime ${bench.name}: ${formatMs(best.head)} ms exceeds base ${formatMs(best.base)} ms by ${formatDelta(best.head, best.base)}`)
    times[bench.name] = best
  }

  // A case that no longer runs fails only while the committed baseline still lists it:
  // removing a case from baseline.json is how a change declares the removal on purpose.
  if (!filter) {
    for (const name of baseNames) {
      if (!names.includes(name) && name in (baseline?.runtime.cases ?? {})) failures.push(`runtime ${name}: case exists in the base but no longer runs`)
    }
  }

  const rows: Array<Array<string>> = [["case", "min ms", "base", "delta", "alloc/run", "base", "delta"]]
  for (const bench of selected) {
    const time = times[bench.name]
    const timed = time !== undefined && time.base !== Infinity
    const bytes = baseBytes[bench.name]
    rows.push([
      bench.critical === true ? `${bench.name} *` : bench.name,
      time === undefined ? "-" : formatMs(time.head),
      timed ? formatMs(time.base) : "-",
      timed ? formatDelta(time.head, time.base) : "-",
      formatBytes(headBytes[bench.name]!),
      bytes === undefined ? "-" : formatBytes(bytes),
      bytes === undefined ? "-" : formatBytesDelta(headBytes[bench.name]!, bytes)
    ])
  }
  printTable(rows)
  console.log("* critical: timed against the base; other cases gate only their allocations.")
  writeSummary(rows, failures)
}

const main = async (): Promise<void> => {
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
  const allocationTolerance = baseline?.runtime.allocationTolerance ?? ALLOCATION_TOLERANCE
  const allocationSlack = baseline?.runtime.allocationSlackBytes ?? ALLOCATION_SLACK_BYTES
  const failures: Array<string> = []
  console.log(`Runtime suite (${environment})`)
  if (againstDir !== undefined) {
    await runAgainst(againstDir, { tolerance, allocationTolerance, allocationSlack }, baseline, failures)
    // The type suite runs below.
  }
  let runtime = againstDir === undefined ? await runRuntime() : { calibrationMs: 0, results: {} }
  if (mode === "update") {
    // Record the best of several full runs so one noisy run cannot skew the baseline.
    for (let run = 1; run < UPDATE_RUNS; run++) {
      const next = await runRuntime(runtime.results)
      const results = { ...runtime.results }
      for (const [name, result] of Object.entries(next.results)) {
        if (result.score < results[name]!.score) results[name] = result
      }
      runtime = { calibrationMs: Math.min(runtime.calibrationMs, next.calibrationMs), results }
    }
  }

  const rows: Array<Array<string>> = [["case", "min ms", "median ms", "score", referenceLabel, "delta", "alloc/run", referenceLabel, "delta"]]
  for (const [name, result] of Object.entries(runtime.results)) {
    let current = result
    const base = reference?.[name]
    const limit = base ? base.score * (1 + tolerance) : Infinity
    if (mode === "check" && base && current.score > limit) {
      // Wall-clock noise: re-measure a failing case before reporting it.
      for (let attempt = 0; attempt < RETRIES && current.score > limit; attempt++) {
        const { sample } = measureCase(name)
        const retried = { ...sample, score: sample.minMs / runtime.calibrationMs, bytesPerRun: current.bytesPerRun }
        if (retried.score < current.score) current = retried
      }
      if (current.score > limit) {
        failures.push(`runtime ${name}: score ${current.score.toFixed(3)} exceeds ${referenceLabel} ${base.score.toFixed(3)} by ${formatDelta(current.score, base.score)}`)
      }
    }
    const baseBytes = base?.bytesPerRun
    if (mode === "check" && baseBytes !== undefined) {
      if (current.bytesPerRun > baseBytes * (1 + allocationTolerance) + allocationSlack) {
        failures.push(`allocations ${name}: ${formatBytes(current.bytesPerRun)} per run exceeds ${referenceLabel} ${formatBytes(baseBytes)} by ${formatBytesDelta(current.bytesPerRun, baseBytes)}`)
      }
    }
    rows.push([
      name,
      formatMs(current.minMs),
      formatMs(current.medianMs),
      current.score.toFixed(3),
      base ? base.score.toFixed(3) : "-",
      base ? formatDelta(current.score, base.score) : "-",
      formatBytes(current.bytesPerRun),
      baseBytes === undefined ? "-" : formatBytes(baseBytes),
      baseBytes === undefined ? "-" : formatBytesDelta(current.bytesPerRun, baseBytes)
    ])
  }
  if (againstDir === undefined) {
    printTable(rows)
    console.log(`calibration: ${formatMs(runtime.calibrationMs)} ms`)
  }

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

  if (jsonPath && againstDir === undefined) {
    writeFileSync(jsonPath, `${JSON.stringify({ environment, calibrationMs: runtime.calibrationMs, runtime: runtime.results, types }, null, 2)}\n`)
  }

  if (mode === "update") {
    if (filter) throw new Error("--update cannot be combined with --filter")
    const next: Baseline = {
      runtime: {
        tolerance: RUNTIME_TOLERANCE,
        allocationTolerance: ALLOCATION_TOLERANCE,
        allocationSlackBytes: ALLOCATION_SLACK_BYTES,
        calibrationMs: Number(runtime.calibrationMs.toFixed(4)),
        environment,
        cases: Object.fromEntries(Object.entries(runtime.results).map(([name, result]) => [name, {
          minMs: Number(result.minMs.toFixed(4)),
          medianMs: Number(result.medianMs.toFixed(4)),
          score: Number(result.score.toFixed(4)),
          bytesPerRun: result.bytesPerRun
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
    const missing = Object.keys(againstDir === undefined ? reference ?? {} : {}).filter((name) => !(name in runtime.results) && !filter && name in (baseline?.runtime.cases ?? {}))
    for (const name of missing) failures.push(`runtime ${name}: case exists in the ${referenceLabel} but no longer runs`)
    if (failures.length > 0) {
      console.error(`\nPerformance regressions:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`)
      process.exit(1)
    }
    console.log("\nNo blocking performance regressions.")
  }
}

await main()
