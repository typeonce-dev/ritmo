import { spawnSync } from "node:child_process"
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { analyze } from "./analyze.ts"
import { emitC, kernelTransform } from "./emit.ts"
import { bundle } from "./bundle.ts"
import type { Config, Target } from "./config.ts"

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
export const run = (command: string, args: string[], cwd?: string, env: NodeJS.ProcessEnv = process.env): string => {
  const result = spawnSync(command, args, { ...(cwd ? { cwd } : {}), env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw new Error(`${command}: ${result.error.message}. Install the tool, then run ritmo-native doctor.`)
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
const find = async (candidates: string[]): Promise<string> => {
  for (const path of candidates) try { await access(path); return path } catch {}
  throw new Error(`Native build did not produce ${candidates.join(" or ")}; inspect the CMake output`)
}
export const bundleGame = async (config: Config, out: string, compile = true): Promise<string> => {
  await mkdir(out, { recursive: true })
  const entry = join(out, "entry.ts")
  await writeFile(entry, `import entry from ${JSON.stringify(config.entry)}\nimport { start as boot } from ${JSON.stringify(join(packageRoot, "src/internal/host.ts"))}\nexport const start = (bridge, options) => boot(entry, bridge, options)\n`)
  const analysis = analyze(config.entry)
  const report = { compiled: analysis.kernels.map(({ id, name, file, line, hash }) => ({ id, name, file, line, hash })), interpreted: analysis.interpreted }
  await writeFile(resolve(out, "../..", "report.json"), JSON.stringify(report, null, 2) + "\n")
  for (const k of analysis.kernels) console.log(`Compiled ${k.name}`)
  for (const d of analysis.interpreted) console.log(`Interpreted ${d.name}: ${d.reason} (${d.file}:${d.line})`)
  for (const name of config.requireCompiled) if (!analysis.kernels.some((k) => k.name === name)) {
    const diagnostic = analysis.interpreted.find((d) => d.name === name)
    throw new Error(`requireCompiled ${name}: ${diagnostic?.reason ?? "system not found in the entry graph"}. See packages/native/README.md#compiled-subset`)
  }
  await writeFile(join(out, "kernels.c"), emitC(analysis))
  const output = join(out, "game.js"); await bundle(entry, output, compile ? [kernelTransform(analysis)] : []); return output
}
export const buildGame = async (config: Config, target: Target, root: string): Promise<{ binary: string; bundle: string; referenceBundle: string; directory: string }> => {
  const host = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
  if (target !== host) throw new Error(`target ${target}: build on ${target === "ios" ? "macOS with Xcode" : target === "android" ? "an Android SDK/NDK host" : target}; run ritmo-native doctor for the required toolchain`)
  const directory = resolve(root, ".ritmo-native", target), generated = join(directory, "generated"), build = join(directory, "build")
  const output = await bundleGame(config, generated)
  const referenceBundle = join(generated, "reference.js"); await bundle(join(generated, "entry.ts"), referenceBundle)
  const bytecode = join(generated, "bundle.c")
  try { await access(bytecode) } catch { await writeFile(bytecode, "#include <stdint.h>\nconst uint8_t rn_bundle[]={0};\nconst uint32_t rn_bundle_size=0;\n") }
  const cmake = process.env.CMAKE ?? "cmake"
  const options = ["-S", packageRoot, "-B", build, "-DCMAKE_BUILD_TYPE=Release", `-DRN_BUNDLE=${bytecode}`, `-DRN_KERNELS=${join(generated, "kernels.c")}`, `-DRN_APP_NAME=${config.app.name}`, `-DRN_WIDTH=${config.window.width}`, `-DRN_HEIGHT=${config.window.height}`]
  // Reset the cached CMake option when leaving a sanitizer run.
  options.push(`-DRN_SANITIZE=${process.env.RITMO_NATIVE_SANITIZE === "1" ? "ON" : "OFF"}`)
  if (process.env.RITMO_NATIVE_HEADLESS === "1") options.push("-DRN_HEADLESS_DRIVERS=ON")
  if (process.env.FETCHCONTENT_SOURCE_DIR_SDL3) options.push(`-DFETCHCONTENT_SOURCE_DIR_SDL3=${process.env.FETCHCONTENT_SOURCE_DIR_SDL3}`)
  console.log(`Configuring ${target} host…`); run(cmake, options)
  run(cmake, ["--build", build, "--config", "Release", "--target", "qjsc", "-j", "4"])
  const suffix = process.platform === "win32" ? ".exe" : ""
  const qjsc = await find([join(build, "vendor/quickjs", `qjsc${suffix}`), join(build, "vendor/quickjs/Release", `qjsc${suffix}`)])
  run(qjsc, ["-C", "-N", "rn_bundle", "-o", bytecode, output])
  console.log("Building native executable…"); run(cmake, ["--build", build, "--config", "Release", "--target", "ritmo_app", "-j", "4"])
  const built = await find([join(build, `ritmo_app${suffix}`), join(build, "Release", `ritmo_app${suffix}`), join(build, "ritmo_app.app/Contents/MacOS/ritmo_app")])
  const binary = join(directory, `game${suffix}`); await cp(built, binary)
  if (config.assets) await cp(config.assets, join(directory, "assets"), { recursive: true })
  console.log(`Built ${binary}`)
  return { binary, bundle: output, referenceBundle, directory }
}
