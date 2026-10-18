/** Same-machine Node JIT / QuickJS interpreted / native kernel frame comparison. */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { performance } from "node:perf_hooks"
import { spawnSync } from "node:child_process"
import os from "node:os"
import { buildGame, bundleGame } from "@typeonce/ritmo-native/compiler/build.ts"
import { loadConfig } from "@typeonce/ritmo-native/compiler/config.ts"
import { nodeOracle } from "@typeonce/ritmo-native/compiler/oracle.ts"
const root = fileURLToPath(new URL("..", import.meta.url)), directory = join(root, ".ritmo-native/bench")
await mkdir(directory, { recursive: true })
const fixture = await readFile(join(root, "packages/native/test/fixtures/movement.ts"), "utf8")
const decode = (line: string): number => { const hex = (JSON.parse(line) as { ms: { $f64: string } }).ms.$f64; const bytes = Uint8Array.from(hex.match(/../g)!, (x) => parseInt(x, 16)); return new DataView(bytes.buffer).getFloat64(0, false) }
const minimum = (lines: string[]) => Math.min(...lines.slice(5).map(decode))
const rows: string[] = []
for (const count of [1000, 5000, 10000]) {
  const entry = join(directory, "native.ts")
  await writeFile(entry, fixture.replace("i < 5000", `i < ${count}`).replace('host.snapshots(() => runtime.snapshot())', 'let elapsed = 0; host.snapshots(() => ({ ms: elapsed }))').replace('return host.frames.subscribe(() => { const ticked = runtime.tick(update); if (!ticked.ok) host.fail("movement failed") })', 'return host.frames.subscribe(() => { const start = host.clock.now(); for(let sample=0;sample<20;sample++) { const ticked = runtime.tick(update); if(!ticked.ok) host.fail("movement failed") }; elapsed=(host.clock.now()-start)/20 })'))
  const configPath = join(directory, "ritmo-native.config.ts")
  await writeFile(configPath, `export default ${JSON.stringify({ entry, app: { name: "Benchmark", id: "dev.typeonce.bench", version: "0.1.0" }, window: { width: 16, height: 16 }, targets: ["linux", "macos", "windows"], requireCompiled: ["Stress/Move"] })}`)
  const config = await loadConfig(configPath), target = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
  const built = await buildGame(config, target, directory)
  const reference = await bundleGame({ ...config, requireCompiled: [] }, join(directory, "reference/generated"), false)
  const jit = minimum(await nodeOracle(reference, [], 20, 16, 16, () => performance.now()))
  const nativeTime = async (compiled: boolean): Promise<number> => {
    const snapshots = join(directory, compiled ? "compiled.jsonl" : "interpreted.jsonl")
    const result = spawnSync(built.binary, ["--headless", "--frames", "20", "--snapshots", snapshots, ...(!compiled ? ["--bundle", reference] : [])], { cwd: built.directory, encoding: "utf8", env: { ...process.env, RITMO_NATIVE_KERNELS: compiled ? "on" : "off", RITMO_NATIVE_STATS: "1" } })
    if (result.status !== 0) throw new Error(`Native benchmark failed: ${result.stderr}`)
    if (compiled && !/Native kernel invocations: [1-9]/.test(result.stdout)) throw new Error("Benchmark did not execute native kernels")
    return minimum((await readFile(snapshots, "utf8")).trim().split("\n"))
  }
  const interpreted = await nativeTime(false), compiled = await nativeTime(true)
  rows.push(`| ${count} | ${jit.toFixed(4)} | ${interpreted.toFixed(4)} | ${compiled.toFixed(4)} |`)
  console.log(rows.at(-1))
  if (count === 5000 && compiled > jit) throw new Error(`5k native frame ${compiled}ms exceeds Node JIT ${jit}ms; investigate before closing the phase`)
}
await writeFile(join(root, "packages/native/bench/results.md"), `# Native movement benchmark\n\n${new Date().toISOString()} — ${os.cpus()[0]?.model}, ${process.platform}, Node ${process.version}.\n\nMinimum of 15 timed batches after 5 warm-up batches; 20 simulation ticks per batch. Setup, rendering and snapshots are excluded. Node and interpreted QuickJS use the original object-storage bundle; the native run must execute C kernels. This measures numeric movement, not the entire top-down game.\n\n| Entities | Node JIT ms/frame | QuickJS interpreted ms/frame | Native C ms/frame |\n| --- | ---: | ---: | ---: |\n${rows.join("\n")}\n\nReproduce: \`node --import tsx scripts/native-bench.ts\`. Results compare only on this machine.\n`)
