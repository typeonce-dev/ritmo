/** Generates 100 deterministic numeric programs x 100 edge/random entities (10k cases). */
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildGame } from "@typeonce/ritmo-native/compiler/build.ts"
import { loadConfig } from "@typeonce/ritmo-native/compiler/config.ts"
import { checkOracle } from "@typeonce/ritmo-native/compiler/oracle.ts"
const root = fileURLToPath(new URL("..", import.meta.url)), out = join(root, ".ritmo-native/fuzz")
await mkdir(out, { recursive: true })
let seed = 0x12345678
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
const expr = (depth: number): string => {
  if (!depth || random() < 0.25) return ["v.x", "v.y", "v.z", "0", "0.5", "-0.5", "1e-300", "1e300"][Math.floor(random() * 8)]!
  const left = expr(depth - 1), right = expr(depth - 1)
  switch (Math.floor(random() * 12)) {
    case 0: return `(${left} + ${right})`; case 1: return `(${left} - ${right})`; case 2: return `(${left} * ${right})`
    case 3: return `(${left} / ${right})`; case 4: return `(${left} % ${right})`; case 5: return `Math.round(${left})`
    case 6: return `Math.min(${left}, ${right})`; case 7: return `Math.max(${left}, ${right})`; case 8: return `Math.sqrt(Math.abs(${left}))`
    case 9: return `Math.sign(${left})`; case 10: return `Math.floor(${left})`; default: return `(${left} < 0 ? ${left} : ${right})`
  }
}
const names: string[] = [], declarations: string[] = []
for (let index = 0; index < 100; index++) {
  names.push(`S${index}`)
  declarations.push(`const S${index} = Game.System("Fuzz/${index}", { queries: { q: Q } }, ({ queries }) => { for (const { data } of queries.q.each()) { const v = data.input.get(); data.output.set({ value: ${expr(3)} }); } })`)
}
const entry = join(out, "native.ts")
await writeFile(entry, `
import { Descriptor, Schema } from ${JSON.stringify(join(root, "packages/core/src/index.ts"))}
import { NativeHost } from ${JSON.stringify(join(root, "packages/native/src/index.ts"))}
const Input=Descriptor.Component<{x:number;y:number;z:number}>()("Fuzz/Input"), Output=Descriptor.Component<{value:number}>()("Fuzz/Output")
const Game=Schema.bind(Schema.fragment({components:{Input,Output}}))
const Q=Game.Query({selection:{input:Game.Query.read(Input),output:Game.Query.write(Output)}})
const Setup=Game.System("Fuzz/Setup",{commands:Game.System.commands(Game.System.spawns(Input,Output))},({commands})=>{
  const edges=[NaN,Infinity,-Infinity,0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,0.49999999999999994,-0.5,4503599627370495.5]
  let seed=42; const draw=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296*200-100}
  for(let i=0;i<100;i++) commands.spawn(Game.Command.spawn([Input,{x:i<edges.length?edges[i]!:draw(),y:i<edges.length?edges[(i+3)%edges.length]!:draw(),z:draw()}],[Output,{value:0}]))
})
${declarations.join("\n")}
const schedules=[${names.map((n) => `Game.Schedule(${n})`).join(",")}]
const Inspect=Game.Inspector("Fuzz/View",{queries:{q:Q}},({queries})=>queries.q.each().map((m)=>({id:m.entity.id,value:m.data.output.get().value})))
export default NativeHost.main((host)=>{
  const runtime=Game.Runtime.make({services:Game.Runtime.services()}).value
  runtime.tick(Game.Schedule(Setup,Game.Schedule.applyDeferred()))
  host.snapshots(()=>runtime.inspect(Inspect));let frame=0
  return host.frames.subscribe(()=>{const result=runtime.tick(schedules[frame++ % schedules.length]!);if(!result.ok)host.fail("fuzz failed")})
})
`)
const config = join(out, "ritmo-native.config.ts")
await writeFile(config, `export default ${JSON.stringify({ entry, app: { name: "Fuzz", id: "dev.typeonce.fuzz", version: "0.1.0" }, window: { width: 16, height: 16 }, targets: ["linux", "macos", "windows"], requireCompiled: Array.from({ length: 100 }, (_, i) => `Fuzz/${i}`) })}`)
const loaded = await loadConfig(config), target = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
const built = await buildGame(loaded, target, out)
await checkOracle(built, undefined, 100, 16, 16)
console.log("10,000 generated numeric cases passed")
