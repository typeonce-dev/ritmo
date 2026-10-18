/**
 * Verifies the published shape of every package, the way a user installs it.
 *
 * 1. Builds the packages from a clean `dist`.
 * 2. Packs each one with `pnpm pack`, which applies `publishConfig` and turns
 *    `workspace:` ranges into real versions.
 * 3. Installs the tarballs into a fresh consumer project outside the
 *    workspace (internal dependencies are overridden to the tarballs, since
 *    the new version is not on npm yet).
 * 4. Type-checks a consumer file with `skipLibCheck: false` under
 *    `moduleResolution: nodenext` with TypeScript 7 and 6, runs it with
 *    plain Node, and checks that `internal/*` paths are not exported.
 *
 *   pnpm pack:check
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const packages = ["core", "math", "browser", "render", "pixi", "devtools", "native"] as const

const run = (command: string, args: ReadonlyArray<string>, cwd: string): string =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })

const step = (message: string) => console.log(`\n> ${message}`)

step("build")
run("pnpm", ["build"], root)

const work = mkdtempSync(path.join(os.tmpdir(), "ritmo-pack-"))
const tarballs = path.join(work, "tarballs")
mkdirSync(tarballs)

step("pack")
const tarballByName = new Map<string, string>()
for (const directory of packages) {
  const packageRoot = path.join(root, "packages", directory)
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { readonly name: string }
  const before = new Set(readdirSync(tarballs))
  run("pnpm", ["pack", "--pack-destination", tarballs], packageRoot)
  const created = readdirSync(tarballs).find((file) => !before.has(file))
  if (created === undefined) throw new Error(`pnpm pack produced no tarball for ${manifest.name}`)
  tarballByName.set(manifest.name, path.join(tarballs, created))
  const listing = run("tar", ["-tzf", path.join(tarballs, created)], work).split("\n")
  for (const required of ["package/LICENSE", "package/README.md", "package/dist/index.js", "package/dist/index.d.ts", "package/src/index.ts"]) {
    if (!listing.includes(required)) throw new Error(`${manifest.name} tarball is missing ${required}`)
  }
  if (listing.some((file) => file.includes("/test/") || file.includes("tsbuildinfo"))) {
    throw new Error(`${manifest.name} tarball contains test or build-info files`)
  }
  if (directory === "native") for (const required of ["package/CMakeLists.txt", "package/runtime/rn_engine_qjs.c", "package/vendor/quickjs/quickjs.c", "package/vendor/quickjs/LICENSE", "package/vendor/stb_image.h", "package/dist/cli.js"]) {
    if (!listing.includes(required)) throw new Error(`Native package is missing ${required}`)
  }
  if (directory === "pixi" && listing.some((file) => /\/(NodeRegistry|RenderSync)\.(ts|js|d\.ts)$/.test(file))) {
    throw new Error("Pixi tarball contains removed compatibility modules")
  }
  const packed = JSON.parse(run("tar", ["-xzOf", path.join(tarballs, created), "package/package.json"], work)) as {
    readonly exports: Record<string, unknown>
    readonly dependencies?: Record<string, string>
  }
  if (JSON.stringify(packed.exports).includes("./src/")) throw new Error(`${manifest.name} publishes source exports`)
  for (const [dependency, range] of Object.entries(packed.dependencies ?? {})) {
    if (range.startsWith("workspace:")) throw new Error(`${manifest.name} publishes ${dependency}@${range}`)
  }
  console.log(`${manifest.name}: ${created}`)
}

step("install into a consumer project")
const consumer = path.join(work, "consumer")
mkdirSync(consumer)
const fileSpec = (name: string) => `file:${tarballByName.get(name)!}`
writeFileSync(path.join(consumer, "package.json"), JSON.stringify({
  name: "ritmo-consumer",
  private: true,
  type: "module",
  dependencies: Object.fromEntries([...tarballByName.keys()].map((name) => [name, fileSpec(name)])),
  overrides: Object.fromEntries([...tarballByName.keys()].map((name) => [name, fileSpec(name)]))
}, null, 2))
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], consumer)

writeFileSync(path.join(consumer, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    skipLibCheck: false,
    types: []
  },
  include: ["main.ts"]
}, null, 2))

const program = `
import { Clock, Descriptor, FixedLoop, HostClock, Schema } from "@typeonce/ritmo"
import * as Result from "@typeonce/ritmo/Result"
import * as Vector2 from "@typeonce/ritmo-math/Vector2"
import { Collide2, FlowField, Random, Scalar, SpatialGrid } from "@typeonce/ritmo-math"
import { BrowserHostClock, BrowserTickSource, Keyboard } from "@typeonce/ritmo-browser"
import * as Browser from "@typeonce/ritmo-browser"
import { NodeRegistry } from "@typeonce/ritmo-render"
import { PixiNodeRegistry } from "@typeonce/ritmo-pixi"
import * as Pixi from "@typeonce/ritmo-pixi"
import { NativeHostClock, NativeTickSource, NativeNodeRegistry } from "@typeonce/ritmo-native"
import { Determinism, Session } from "@typeonce/ritmo-devtools"

if (NativeHostClock.make({ clock: { now: () => 9 } }).now() !== 9) throw new Error("NativeHostClock misbehaves when packed")
const step = Clock.hz(60)
const Time = Clock.resource("Consumer/Time", step)
const Sim = Schema.bind(Schema.fragment({ resources: { Time } }))
const AdvanceTime = Clock.system(Sim, { name: "Consumer/AdvanceTime", resource: Time })
const repeated = Determinism.check(({ hostClock }) => {
  const made = Sim.Runtime.make({ services: Sim.Runtime.services(), resources: { Time: Clock.start(step) }, debug: { hostClock } })
  if (!made.ok) throw new Error("initial clock must be valid")
  return { runtime: made.value, schedules: { update: Sim.Schedule(AdvanceTime) } }
}, { schedule: "update", frames: Clock.steps(Clock.duration(step, 0.5)), hostClock: HostClock.test() })
if (!repeated.ok) throw new Error(JSON.stringify(repeated))

const Position = Descriptor.ConstructedComponent(Vector2)("Consumer/Position")
const Game = Schema.bind(Schema.fragment({ components: { Position } }))
const Spawn = Game.System("Consumer/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
  const draft = Game.Command.spawn(Game.Command.entryRaw(Position, { x: 1, y: 2 }))
  if (draft.ok) commands.spawn(draft.value)
})
const hostClock = HostClock.test()
const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).value
const session = Session.make(runtime, { hostClock, schedules: { setup: Game.Schedule(Spawn, Game.Schedule.applyDeferred()) } })
const ran = session.run("setup")
const keyboard = Keyboard.scripted({ jump: [" "] }, [{ frame: 0, press: ["jump"] }])
const registry = NodeRegistry.make<string>({ attach: () => {}, detach: () => {} })
const sprites = PixiNodeRegistry.make<{ destroy(): void }>({ addChild: () => {}, removeChild: () => {} })
const cell = Scalar.Positive.result(8)
const grid = cell.ok ? SpatialGrid.make(cell.value) : undefined
grid?.insert(0, 1, 1, 1)
const field = cell.ok ? FlowField.make(cell.value) : undefined
field?.setWalls([{ minX: 0, minY: 0, maxX: 16, maxY: 4 }], 1)
const moved = Collide2.moveCircle({ x: 0, y: 10 }, { x: 0, y: -20 }, 2, [{ minX: -8, minY: 0, maxX: 8, maxY: 4 }])
if (BrowserHostClock.make({ performance: { now: () => 7 } }).now() !== 7) throw new Error("BrowserHostClock misbehaves when packed")
const frames: Array<(timestamp: number) => void> = []
let loopUpdates = 0
const loop = FixedLoop.start({
  source: BrowserTickSource.make({ requestAnimationFrame: (callback) => frames.push(callback), cancelAnimationFrame: () => {} }),
  step: Clock.hz(100),
  maxFrameSeconds: 0.1,
  maxStepsPerFrame: 5,
  update: () => { loopUpdates += 1; return Result.success(undefined) },
  render: () => {},
  onFailure: () => {}
})
frames.shift()?.(0)
frames.shift()?.(20)
if (!loop.ok || loopUpdates !== 2) throw new Error("FixedLoop with BrowserTickSource misbehaves when packed")
loop.value.stop()
if ("FixedLoop" in Browser) throw new Error("Browser publishes the moved FixedLoop")
if (!moved.blocked || Random.make(42).next() !== 0.6011037519201636) throw new Error("math helpers misbehave when packed")
if ("NodeRegistry" in Pixi || "RenderSync" in Pixi) throw new Error("Pixi publishes removed compatibility exports")
console.log(JSON.stringify({
  ok: ran.data.ok && Result.isSuccess(Result.success(1)),
  entities: session.dump().data.entityCount,
  jump: keyboard.snapshot().jump.pressed,
  nodes: registry.size + sprites.size
}))
`
writeFileSync(path.join(consumer, "main.ts"), program)

step("type-check the consumer with TypeScript 7 (skipLibCheck: false)")
run(path.join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json", "--pretty", "false"], consumer)

step("type-check the consumer with TypeScript 6 (skipLibCheck: false)")
run("node", [path.join(root, "node_modules", "typescript6", "lib", "tsc.js"), "-p", "tsconfig.json", "--pretty", "false"], consumer)

step("run the consumer with Node")
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json", "--noEmit", "false", "--outDir", "out"], { cwd: consumer, stdio: "inherit" })
const output = run("node", ["out/main.js"], consumer).trim()
const expected = JSON.stringify({ ok: true, entities: 1, jump: true, nodes: 0 })
if (output !== expected) throw new Error(`consumer printed ${output}, expected ${expected}`)
console.log(output)

step("run the published devtools CLI")
writeFileSync(path.join(consumer, "lint.mjs"), `import { HostClock, Schema } from "@typeonce/ritmo"; const Game = Schema.bind(Schema.fragment({})); export const lintTarget = () => ({ runtime: Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).value, schedules: { update: Game.Schedule() } });\n`)
const lintOutput = run(path.join(consumer, "node_modules", ".bin", "ritmo-devtools"), ["lint", "lint.mjs"], consumer)
if (!lintOutput.includes("0 warnings")) throw new Error(`published lint CLI failed: ${lintOutput}`)

step("run the published native CLI")
writeFileSync(path.join(consumer, "native.mjs"), `export default () => {}\n`)
writeFileSync(path.join(consumer, "ritmo-native.config.ts"), `export default { entry: "./native.mjs", app: { name: "Consumer", id: "dev.test.consumer", version: "0.1.0" }, targets: ["linux", "macos", "windows"] }\n`)
const nativeHelp = run(path.join(consumer, "node_modules", ".bin", "ritmo-native"), ["--help"], consumer)
if (!nativeHelp.includes("ritmo-native doctor")) throw new Error(`published native CLI failed: ${nativeHelp}`)

step("internal modules are not exported")
writeFileSync(path.join(consumer, "internal.mjs"), `import("@typeonce/ritmo/internal/world").then(() => process.exit(1), (error) => { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") process.exit(2) })\n`)
run("node", ["internal.mjs"], consumer)

if (process.env.PACK_CHECK_KEEP) console.log(`kept ${work}`)
else rmSync(work, { recursive: true, force: true })
console.log("\npack check passed")
