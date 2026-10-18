import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"
import { analyze } from "@typeonce/ritmo-native/compiler/analyze.ts"
import { emitC } from "@typeonce/ritmo-native/compiler/emit.ts"

it("finds numeric ECS systems and deterministically emits C11 kernels", () => {
  const a = analyze(resolve("packages/native/test/fixtures/movement.ts"))
  expect(a.kernels.map((k) => k.name)).toEqual(["Stress/Move"])
  expect(a.kernels[0]?.layouts).toEqual({ "Stress/Position": ["x", "y"], "Stress/Velocity": ["x", "y"] })
  expect(a.interpreted.find((d) => d.name === "Stress/Setup")?.reason).toContain("commands")
  expect(emitC(a)).toContain("rn_journal_write")
  expect(emitC(a)).toBe(emitC(analyze(resolve("packages/native/test/fixtures/movement.ts"))))
})

it("rejects mutable captured values instead of freezing their initial value into C", async () => {
  const dir = await mkdtemp(resolve(".ritmo-native/compiler-test-"))
  try {
    const file = join(dir, "mutable.ts")
    await writeFile(file, `import { Descriptor, Schema } from "@typeonce/ritmo";
const P=Descriptor.Component<{x:number}>()("Mutable/P"); const Game=Schema.bind(Schema.fragment({components:{P}}));
const Q=Game.Query({selection:{p:Game.Query.write(P)}}); let speed=1;
export const S=Game.System("Mutable",{queries:{q:Q}},({queries})=>{for(const {data} of queries.q.each()){const p=data.p.get();data.p.set({x:p.x+speed});}}); speed=2;`)
    const result = analyze(file)
    expect(result.kernels).toHaveLength(0)
    expect(result.interpreted[0]?.reason).toContain("module-level const")
  } finally { await rm(dir, { recursive: true, force: true }) }
})
