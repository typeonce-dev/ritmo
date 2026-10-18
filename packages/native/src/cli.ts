#!/usr/bin/env node
import { createRequire } from "node:module"
import { spawn, spawnSync } from "node:child_process"
import { watch } from "node:fs"
import { access, mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { loadConfig, targets, type Target } from "./compiler/config.ts"
import { buildGame, bundleGame, run } from "./compiler/build.ts"
import { mobileOracle } from "./compiler/mobile-oracle.ts"
import { mobileProject } from "./compiler/mobile.ts"
import { checkOracle } from "./compiler/oracle.ts"

const args = process.argv.slice(2)
const value = (flag: string) => { const i = args.indexOf(flag); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`${flag}: supply a value`); return args[i + 1] }
const help = "ritmo-native doctor | build | dev | check [--config ritmo-native.config.ts] [--target desktop|linux|macos|windows|android|ios] [--frames 600] [--input timeline.json]"
const main = async () => {
  const command = args[0]
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!
    if (["--help", "--generate-only"].includes(flag)) continue
    if (["--config", "--target", "--frames", "--input"].includes(flag)) { value(flag); index++; continue }
    throw new Error(`Unknown argument ${flag}. ${help}`)
  }
  if (!command || args.includes("--help")) { console.log(help); return }
  if (!["doctor", "build", "dev", "check"].includes(command)) throw new Error(`Unknown command ${command}. ${help}`)
  const configPath = resolve(value("--config") ?? "ritmo-native.config.ts")
  const config = await loadConfig(configPath), root = dirname(configPath)
  const current = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
  const selected = value("--target") ?? current
  const target = selected === "desktop" ? current : selected
  if (!targets.includes(target as Target)) throw new Error(`--target: choose desktop or ${targets.join(", ")}`)
  if (!config.targets.includes(target as Target)) throw new Error(`targets: add ${target} to ${configPath} before building it`)
  if (command === "doctor") {
    const tools: Array<readonly [string, string, readonly string[]]> = [["Node", process.execPath, ["--version"]], ["pnpm", "pnpm", ["--version"]], ["CMake", process.env.CMAKE ?? "cmake", ["--version"]], ["C compiler", process.env.CC ?? (process.platform === "win32" ? "cl" : "cc"), ["--version"]]]
    const configuredTargets = value("--target") ? [target] : config.targets
    if (configuredTargets.includes("android")) tools.push(["Java", "java", ["-version"]])
    if (configuredTargets.some((t) => t === "ios" || t === "macos") && process.platform === "darwin") tools.push(["Xcode", "xcode-select", ["-p"]])
    let missing = false
    for (const [label, executable, flags] of tools) {
      const result = spawnSync(executable, [...flags], { encoding: "utf8" })
      const ok = !result.error && (result.status === 0 || executable === "cl")
      console.log(`${ok ? "OK" : "MISSING"} ${label}: ${ok ? (result.stdout || result.stderr).split("\n")[0] : `install ${executable} and put it on PATH`}`); missing ||= !ok
    }
    if (configuredTargets.includes("android")) {
      const sdk = process.env.ANDROID_HOME
      for (const [label, path, fix] of [["Android SDK", "platforms/android-35/android.jar", "sdkmanager 'platforms;android-35'"], ["Android NDK", "ndk/27.2.12479018/build/cmake/android.toolchain.cmake", "sdkmanager 'ndk;27.2.12479018'"]] as const) {
        const ok = sdk ? await access(resolve(sdk, path)).then(() => true, () => false) : false
        console.log(`${ok ? "OK" : "MISSING"} ${label}: ${ok ? "installed" : `set ANDROID_HOME and run ${fix}`}`); missing ||= !ok
      }
    }
    if (configuredTargets.some((t) => t === "ios" || t === "macos") && process.platform !== "darwin") { console.log("MISSING Xcode: build Apple targets on a Mac with Xcode installed"); missing = true }
    if (missing) process.exitCode = 1
    return
  }
  // A native build must retain the game's compile-time guarantees.
  const tsc = createRequire(import.meta.url).resolve("typescript6/lib/tsc.js")
  try { await access(resolve(root, "tsconfig.json")); console.log("Typechecking game…"); run(process.execPath, [tsc, "-p", resolve(root, "tsconfig.json"), "--noEmit", "--composite", "false", "--incremental", "false", "--pretty", "false"], root) }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error }
  if (target === "android" || target === "ios") {
    if (command === "dev") throw new Error("dev uses the desktop shell; choose --target desktop, then build mobile for device checks")
    const generateOnly = args.includes("--generate-only")
    if (command === "check" && generateOnly) throw new Error("check needs a running emulator/simulator; remove --generate-only")
    const project = await mobileProject(config, target, root, generateOnly)
    if (command === "check") {
      const frames = Number(value("--frames") ?? 600), input = value("--input")
      if (!Number.isSafeInteger(frames) || frames < 1) throw new Error("--frames: supply a positive integer")
      await mobileOracle(config, target, project, root, frames, input ? resolve(input) : undefined)
    }
    return
  }
  const built = await buildGame(config, target as Target, root)
  if (command === "check") {
    const frames = Number(value("--frames") ?? 600)
    if (!Number.isSafeInteger(frames) || frames < 1) throw new Error("--frames: supply a positive integer")
    const input = value("--input")
    await checkOracle(built, input ? resolve(input) : undefined, frames, config.window.width, config.window.height)
  } else if (command === "dev") {
    let child = spawn(built.binary, ["--bundle", built.bundle], { cwd: built.directory, stdio: "inherit", env: { ...process.env, RITMO_NATIVE_KERNELS: "off" } })
    let rebuilding = false
    const watcher = watch(root, { recursive: true }, async (_event, filename) => {
      if (!filename || filename.startsWith(".ritmo-native") || filename.includes("node_modules") || !/\.[jt]s$/.test(filename) || rebuilding) return
      rebuilding = true
      try {
        await bundleGame(config, dirname(built.bundle)); child.kill()
        child = spawn(built.binary, ["--bundle", built.bundle], { cwd: built.directory, stdio: "inherit", env: { ...process.env, RITMO_NATIVE_KERNELS: "off" } })
        console.log(`Reloaded ${filename}`)
      } catch (error) { console.error(String(error)) } finally { rebuilding = false }
    })
    const stop = () => { watcher.close(); child.kill() }
    process.once("SIGINT", stop); process.once("SIGTERM", stop)
    console.log("Watching game sources; Ctrl+C stops the native host.")
  }
}
main().catch((error: unknown) => { console.error(`ritmo-native: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
