/**
 * Ritmo against other TypeScript ECS libraries on the community benchmark
 * cases (see `cases.ts`). Internal: it answers "how fast is Ritmo next to
 * bitECS, Koota, and Miniplex", and is not a regression gate (`pnpm bench`
 * is).
 *
 *   pnpm bench:compare                      every library, every case
 *   pnpm bench:compare --filter add_remove  cases or libraries whose name contains the text
 *   pnpm bench:compare --json <path>        also write the results, with the machine, date, and versions
 *
 * Each library/case pair runs in a fresh process, so one library's code never
 * shares V8's optimization state with another's. Results are operations per
 * second from the fastest sample; higher is better.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { measure, type MeasureOptions } from "../../../packages/core/bench/harness.ts"
import { caseNames, type CaseName, type Library } from "./cases.ts"

const libraries = ["ritmo", "bitecs", "koota", "miniplex"] as const
type LibraryName = (typeof libraries)[number]

const load = async (name: LibraryName): Promise<Library> =>
  ((await import(`./${name}.ts`)) as Record<LibraryName, Library>)[name]

const options: MeasureOptions = {
  warmupMs: 300,
  budgetMs: 1000,
  minSamples: 30,
  maxSamples: 1000,
  minSampleMs: 5,
  minPreparedSamples: 30
}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const one = flag("--one")
if (one !== undefined) {
  const [library, name] = one.split(":") as [LibraryName, CaseName]
  const setup = (await load(library))[name]
  const sample = measure({ name: one, description: one, setup }, options)
  process.stdout.write(JSON.stringify({ minMs: sample.minMs, medianMs: sample.medianMs }))
  process.exit(0)
}

const filter = flag("--filter")
const script = fileURLToPath(import.meta.url)
const results: Record<string, Record<string, { readonly minMs: number; readonly medianMs: number }>> = {}

for (const name of caseNames) {
  for (const library of libraries) {
    if (filter !== undefined && !name.includes(filter) && !library.includes(filter)) continue
    const output = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", script, "--one", `${library}:${name}`], { encoding: "utf8" })
    ;(results[name] ??= {})[library] = JSON.parse(output)
    process.stderr.write(".")
  }
}
process.stderr.write("\n")

const opsPerSecond = (ms: number) => Math.round(1000 / ms)
const format = (value: number) => value.toLocaleString("en-US")

console.log(`${os.cpus()[0]?.model ?? "unknown cpu"} / node ${process.version} / ${os.platform()}`)
console.log("ops/s (fastest sample); x = how many times slower than the fastest library\n")
const header = ["case", ...libraries]
const rows = Object.entries(results).map(([name, byLibrary]) => {
  const best = Math.min(...Object.values(byLibrary).map((result) => result.minMs))
  return [name, ...libraries.map((library) => {
    const result = byLibrary[library]
    if (result === undefined) return "-"
    const ratio = result.minMs / best
    return `${format(opsPerSecond(result.minMs))}${ratio < 1.05 ? "" : ` (${ratio.toFixed(1)}x)`}`
  })]
})
const widths = header.map((_, column) => Math.max(...[header, ...rows].map((row) => row[column]!.length)))
for (const row of [header, ...rows]) console.log(row.map((cell, column) => cell.padEnd(widths[column]!)).join("  "))

const versionOf = (name: string): string => {
  const manifest = fileURLToPath(new URL(`../node_modules/${name}/package.json`, import.meta.url))
  return (JSON.parse(readFileSync(manifest, "utf8")) as { readonly version: string }).version
}

const json = flag("--json")
if (json !== undefined) {
  const run = {
    date: new Date().toISOString().slice(0, 10),
    machine: `${os.cpus()[0]?.model ?? "unknown cpu"} / node ${process.version} / ${os.platform()}`,
    versions: {
      ritmo: versionOf("@typeonce/ritmo"),
      bitecs: versionOf("bitecs"),
      koota: versionOf("koota"),
      miniplex: versionOf("miniplex")
    },
    results
  }
  writeFileSync(json, `${JSON.stringify(run, null, 2)}\n`)
}
