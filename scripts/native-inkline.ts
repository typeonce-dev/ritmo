/** Builds an external inkline-town checkout against the current native/core sources. */
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildGame } from "@typeonce/ritmo-native/compiler/build.ts"
import { checkOracle } from "@typeonce/ritmo-native/compiler/oracle.ts"
import { loadConfig } from "@typeonce/ritmo-native/compiler/config.ts"

const repository = resolve(process.argv[2] ?? "../inkline-town")
const integration = join(repository, ".ritmo-native/integration")
const root = fileURLToPath(new URL("..", import.meta.url))
await mkdir(integration, { recursive: true })
await writeFile(join(integration, "native.ts"), `
import { headless } from ${JSON.stringify(join(repository, "src/sim/headless.ts"))}
import { step } from ${JSON.stringify(join(repository, "src/content.ts"))}
import { NativeHost, NativeNodeRegistry } from ${JSON.stringify(join(root, "packages/native/src/index.ts"))}
import { Pointer } from ${JSON.stringify(join(root, "packages/browser/src/index.ts"))}
export default NativeHost.main((host) => {
  const town = headless({ size: "small", term: 45, land: "fair", seed: 7 })
  const pointer = Pointer.track(host.pointer, host.blur)
  const layer = host.gfx.layer("town"), nodes = NativeNodeRegistry.make(layer)
  const hudLayer = host.gfx.layer("hud"), hud = hudLayer.text("INKLINE TOWN | Click: road | Native SDL3 / QuickJS", 0xf2e6c9)
  hud.x=16; hud.y=16; hudLayer.addChild(hud)
  host.gfx.background=0x25382d
  host.snapshots(() => town.runtime.snapshot())
  const loop = host.frames.subscribe(() => {
    const input=pointer.snapshot()
    if (input.primary.pressed) town.edit({ type: "roads", cells: [{ x: Math.floor((input.position.x-24)/18), y: Math.floor((input.position.y-48)/18) }] })
    town.run(step.dt)
    const snapshot=town.snapshot(), alive=new Set<number>()
    for(const entity of snapshot.entities) {
      const c=entity.components, tile=c["Town/Tile"]
      if(!tile) continue
      alive.add(entity.id)
      const node=nodes.ensure(entity.id,()=>layer.rect(tile.size*18-1,tile.size*18-1,0x577047))
      node.x=24+tile.x*18; node.y=48+tile.y*18
      node.tint=c["Town/Water"] ? 0x497e96 : c["Town/Tree"] ? 0x284c31 : c["Town/Rock"] ? 0x858b83 : c["Town/TownHall"] ? 0xe2c178 : c["Town/House"] ? 0xcc805b : c["Town/Building"] ? 0xbdaa83 : c["Town/Road"] ? 0xc3b698 : 0x577047
    }
    for(const [id] of nodes.entries()) if(!alive.has(id)) nodes.remove(id)
  })
  return { stop() { loop.stop(); pointer.dispose(); nodes.clear(); layer.destroy(); hudLayer.destroy() } }
})
`)
const configPath = join(integration, "ritmo-native.config.ts")
await writeFile(configPath, `export default ${JSON.stringify({ entry: "./native.ts", app: { name: "Inkline Town", id: "dev.typeonce.inklinetown", version: "0.1.0" }, window: { width: 1000, height: 800 }, targets: ["linux", "macos", "windows"], requireCompiled: [] })}`)
const config = await loadConfig(configPath)
const target = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
const built = await buildGame(config, target, integration)
await checkOracle(built, undefined, Number(process.argv[3] ?? 600), config.window.width, config.window.height)
