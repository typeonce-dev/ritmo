import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout } from "node:timers/promises"
import { run } from "./build.ts"
import { firstDifference, nodeOracle } from "./oracle.ts"
import type { Config } from "./config.ts"

export const mobileOracle = async (config: Config, target: "android" | "ios", project: string, root: string, frames: number, inputPath?: string): Promise<void> => {
  const input = inputPath ? JSON.parse(await readFile(inputPath, "utf8")) as unknown : []
  const bundle = join(root, ".ritmo-native", target, "generated/reference.js")
  const expected = await nodeOracle(bundle, input, frames, config.window.width, config.window.height, () => 0, config.assets)
  let actual: string
  if (target === "android") {
    run("adb", ["get-state"])
    run("adb", ["install", "-r", join(project, "app/build/outputs/apk/debug/app-debug.apk")])
    run("adb", ["shell", "am", "force-stop", config.app.id])
    run("adb", ["shell", "run-as", config.app.id, "rm", "-f", "files/native.jsonl"])
    if (inputPath) {
      const copied = spawnSync("adb", ["shell", "run-as", config.app.id, "tee", "files/input.json"], { encoding: "utf8", input: JSON.stringify(input) })
      if (copied.status !== 0) throw new Error(`Copy Android timeline: ${copied.stderr}`)
    }
    run("adb", ["shell", "am", "start", "-n", `${config.app.id}/${config.app.id}.GameActivity`, "--ez", "headless", "true", "--ei", "frames", String(frames), ...(inputPath ? ["--ez", "input", "true"] : [])])
    actual = ""
    for (let attempt = 0; attempt < 120; attempt++) {
      const output = spawnSync("adb", ["exec-out", "run-as", config.app.id, "cat", "files/native.jsonl"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
      if (output.status === 0 && output.stdout.trim().split("\n").length === frames) { actual = output.stdout; break }
      if (attempt > 0 && attempt % 30 === 0) console.log(`Waiting for Android headless frames (${attempt}s)…`)
      await setTimeout(1000)
    }
    if (!actual) throw new Error("Android headless app did not finish in 120s; inspect adb logcat for the native diagnostic")
  } else {
    const app = join(project, "build/ritmo/Debug-iphonesimulator/ritmo_app.app")
    run("xcrun", ["simctl", "install", "booted", app])
    const data = run("xcrun", ["simctl", "get_app_container", "booted", config.app.id, "data"]).trim()
    const timeline = join(data, "input.json"), snapshots = join(data, "native.jsonl")
    if (inputPath) await writeFile(timeline, JSON.stringify(input))
    run("xcrun", ["simctl", "launch", "--terminate-running-process", "booted", config.app.id, "--headless", "--frames", String(frames), "--snapshots", snapshots, ...(inputPath ? ["--input", timeline] : [])])
    actual = ""
    for (let attempt = 0; attempt < 120; attempt++) {
      const output = await readFile(snapshots, "utf8").catch(() => "")
      if (output.trim().split("\n").length === frames) { actual = output; break }
      if (attempt > 0 && attempt % 30 === 0) console.log(`Waiting for iOS headless frames (${attempt}s)…`)
      await setTimeout(1000)
    }
    run("xcrun", ["simctl", "terminate", "booted", config.app.id])
    if (!actual) throw new Error("iOS headless app did not finish in 120s; inspect the simulator logs")
  }
  const lines = actual.trim().split("\n")
  if (lines.length !== expected.length) throw new Error(`${target}: received ${lines.length} snapshots, expected ${expected.length}`)
  for (let frame = 0; frame < lines.length; frame++) {
    if (expected[frame] === "null") throw new Error("Register host.snapshots in the native entry before checking mobile")
    const difference = firstDifference(JSON.parse(expected[frame]!), JSON.parse(lines[frame]!))
    if (difference) throw new Error(`${target} oracle mismatch at frame ${frame}: ${difference}`)
  }
  console.log(`${target} oracle passed: ${frames} frames match Node exactly (NaNs normalized).`)
}
