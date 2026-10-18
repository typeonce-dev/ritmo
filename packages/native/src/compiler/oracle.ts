import { createReadStream, createWriteStream, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { once } from "node:events"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { runInNewContext } from "node:vm"
import type { Bridge, Options } from "../internal/host.ts"
import { run } from "./build.ts"

export const firstDifference = (a: unknown, b: unknown, path = "world"): string | undefined => {
  if (Object.is(a, b)) return undefined
  if (typeof a !== typeof b || !a || !b || typeof a !== "object") return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  for (const key of keys) { const difference = firstDifference(left[key], right[key], `${path}.${key}`); if (difference) return difference }
  return undefined
}
type Control = { frame(delta: number): void; snapshot(): string; stop(): void }
const referenceControl = async (bundle: string, input: unknown, width: number, height: number, now: () => number, assets = join(dirname(bundle), "../assets")): Promise<Control> => {
  const context: { __ritmoGame?: { start(bridge: Bridge, options: Options): Promise<Control> } } = {}
  runInNewContext(await readFile(bundle, "utf8"), context, { filename: bundle })
  let id = 0
  return context.__ritmoGame!.start({ call(op, ...args) {
    if (op === "now") return now()
    if (op === "width") return width
    if (op === "height") return height
    if (op.startsWith("safe")) return 0
    if (op === "node") return id++
    if (op === "texture") {
      const bytes = readFileSync(join(assets, String(args[0])))
      if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`Oracle texture must be a PNG: ${String(args[0])}`)
      return { id: id++, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }
    if (op === "fail") throw new Error(`Node oracle: ${String(args[0])}`)
    return undefined
  } }, { headless: true, input, width, height })
}
export const nodeOracle = async (bundle: string, input: unknown, frames: number, width: number, height: number, now: () => number = () => 0, assets?: string): Promise<string[]> => {
  const control = await referenceControl(bundle, input, width, height, now, assets)
  try { return Array.from({ length: frames }, () => { control.frame(1000 / 60); return control.snapshot() }) }
  finally { control.stop() }
}
/** Streams snapshots so large stress worlds do not require an entire run in memory. */
export const checkOracle = async (built: { binary: string; bundle: string; referenceBundle?: string; directory: string }, inputPath: string | undefined, frames: number, width: number, height: number) => {
  const input = inputPath ? JSON.parse(await readFile(inputPath, "utf8")) as unknown : []
  for (const mode of ["on", "off"]) {
    const snapshots = join(built.directory, mode === "on" ? "native.jsonl" : "native-interpreted.jsonl")
    const log = run(built.binary, ["--headless", "--frames", String(frames), "--snapshots", snapshots, ...(inputPath ? ["--input", inputPath] : [])], built.directory, { ...process.env, RITMO_NATIVE_KERNELS: mode })
    if (log.trim()) console.log(log.trim())
    const reference = await referenceControl(built.referenceBundle ?? built.bundle, input, width, height, () => 0)
    const lines = createInterface({ input: createReadStream(snapshots), crlfDelay: Infinity })
    const nodeOutput = createWriteStream(join(built.directory, mode === "on" ? "node.jsonl" : "node-interpreted.jsonl"))
    let frame = 0
    try {
      for await (const line of lines) {
        if (frame >= frames) throw new Error(`Oracle: native produced more than ${frames} frames`)
        reference.frame(1000 / 60)
        const expected = reference.snapshot()
        if (expected === "null") throw new Error("Oracle: register host.snapshots(() => runtime.snapshot()) or a debug world dump in native.ts")
        if (line !== expected) {
          const difference = firstDifference(JSON.parse(expected), JSON.parse(line))
          if (difference) throw new Error(`Oracle mismatch at frame ${frame} (kernels ${mode}): ${difference}`)
        }
        if (!nodeOutput.write(expected + "\n")) await once(nodeOutput, "drain")
        frame++
      }
      if (frame !== frames) throw new Error(`Oracle: native produced ${frame} frames; expected ${frames}`)
      nodeOutput.end(); await once(nodeOutput, "finish")
    } finally { reference.stop(); lines.close(); nodeOutput.destroy() }
  }
  console.log(`Oracle passed: ${frames} frames with kernels on and off match Node (all non-NaN IEEE-754 bits; NaNs normalized).`)
}
