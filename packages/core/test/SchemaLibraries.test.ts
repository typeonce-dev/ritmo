/**
 * The schema libraries games bring, as they ship: a plain schema of each
 * saves and loads as it is, and Zod's and Effect's transforming schemas save
 * through the helpers in the skill's playbooks (`playbooks/zod.md`,
 * `playbooks/effect.md`), copied in `libraries.ts` as games write them.
 */
import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import { type } from "arktype"
import { Schema as S } from "effect"
import * as v from "valibot"
import { z } from "zod"
import { effectCodec, zodCodec } from "./libraries.ts"
import { worldOf } from "./saved.ts"

const ZodPlain = Descriptor.ConstructedResource(z.object({ x: z.number(), name: z.string() }))("Libraries/Zod")
const ValibotPlain = Descriptor.ConstructedResource(v.object({ x: v.number(), name: v.string() }))("Libraries/Valibot")
const ArkTypePlain = Descriptor.ConstructedResource(type({ x: "number", name: "string" }))("Libraries/ArkType")
const EffectPlain = Descriptor.ConstructedResource(effectCodec(S.Struct({ x: S.Finite, name: S.String })))("Libraries/Effect")
const ZodDate = Descriptor.ConstructedResource(zodCodec(z.codec(z.iso.datetime(), z.date(), {
  decode: (text) => new Date(text),
  encode: (date) => date.toISOString()
})))("Libraries/ZodDate")
const EffectMap = Descriptor.ConstructedResource(effectCodec(S.ReadonlyMap(S.String, S.Int)))("Libraries/EffectMap")

const Game = Schema.bind(Schema.fragment({
  resources: { ZodPlain, ValibotPlain, ArkTypePlain, EffectPlain, ZodDate, EffectMap }
}))
// A state's data from Zod as it is, beside a state without data.
const Mode = Game.StateMachine("Libraries/Mode", { Idle: {}, Racing: z.object({ lap: z.number().int() }) })

/** Each resource's saved form, as a snapshot holds it. */
interface Saved {
  readonly "Libraries/Zod": Descriptor.Descriptor.Raw<typeof ZodPlain>
  readonly "Libraries/Valibot": Descriptor.Descriptor.Raw<typeof ValibotPlain>
  readonly "Libraries/ArkType": Descriptor.Descriptor.Raw<typeof ArkTypePlain>
  readonly "Libraries/Effect": Descriptor.Descriptor.Raw<typeof EffectPlain>
  readonly "Libraries/ZodDate": Descriptor.Descriptor.Raw<typeof ZodDate>
  readonly "Libraries/EffectMap": Descriptor.Descriptor.Raw<typeof EffectMap>
}

const saved: Saved = {
  "Libraries/Zod": { x: 1, name: "zod" },
  "Libraries/Valibot": { x: 2, name: "valibot" },
  "Libraries/ArkType": { x: 3, name: "arktype" },
  "Libraries/Effect": { x: 4, name: "effect" },
  "Libraries/ZodDate": "2026-10-25T08:00:00.000Z",
  "Libraries/EffectMap": [["coin", 3]]
}

const make = (raw: Saved, lap: number) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: {
      ZodPlain: raw["Libraries/Zod"],
      ValibotPlain: raw["Libraries/Valibot"],
      ArkTypePlain: raw["Libraries/ArkType"],
      EffectPlain: raw["Libraries/Effect"],
      ZodDate: raw["Libraries/ZodDate"],
      EffectMap: raw["Libraries/EffectMap"]
    },
    machines: Game.Runtime.machines(Game.Runtime.machine(Mode, { _tag: "Racing", lap }))
  })
  if (!made.ok) throw new Error(`invalid fixture: ${JSON.stringify(made.error)}`)
  return made.value
}

const Read = Game.Inspector("Libraries/Read", {
  resources: {
    zod: Game.System.readResource(ZodPlain),
    valibot: Game.System.readResource(ValibotPlain),
    arktype: Game.System.readResource(ArkTypePlain),
    effect: Game.System.readResource(EffectPlain),
    date: Game.System.readResource(ZodDate),
    map: Game.System.readResource(EffectMap)
  },
  machines: { mode: Game.System.machine(Mode) }
}, ({ resources, machines }) => ({
  zod: resources.zod.get(),
  valibot: resources.valibot.get(),
  arktype: resources.arktype.get(),
  effect: resources.effect.get(),
  date: resources.date.get(),
  map: resources.map.get(),
  mode: machines.mode.get()
}))

describe("schema libraries", () => {
  it("decodes each library's schema, and saves and loads every value through JSON", () => {
    const runtime = make(saved, 2)
    const values = runtime.inspect(Read)
    expect(values.date).toEqual(new Date("2026-10-25T08:00:00.000Z"))
    expect(values.map).toEqual(new Map([["coin", 3]]))

    const world = worldOf(runtime.snapshot())
    expect(world.resources).toEqual(saved)

    const other = make({
      ...saved,
      "Libraries/Zod": { x: 9, name: "other" },
      "Libraries/ZodDate": "2000-01-01T00:00:00.000Z",
      "Libraries/EffectMap": []
    }, 7)
    expect(other.restore(JSON.parse(JSON.stringify(world)))).toEqual({ ok: true, value: undefined })
    expect(other.inspect(Read)).toEqual(values)
    expect(other.inspect(Read).mode).toEqual({ _tag: "Racing", lap: 2 })
  })

  it("rejects raw values with each library's own issues", () => {
    for (const [name, raw] of [
      ["Libraries/Zod", { x: "one", name: "zod" }],
      ["Libraries/Valibot", { x: 2 }],
      ["Libraries/ArkType", { x: 3, name: 3 }],
      ["Libraries/Effect", { x: Number.NaN, name: "effect" }],
      ["Libraries/ZodDate", "yesterday"]
    ] as const) {
      const world = worldOf(make(saved, 1).snapshot())
      const restored = make(saved, 1).restore(JSON.parse(JSON.stringify({ ...world, resources: { ...world.resources, [name]: raw } })))
      expect(restored.ok, name).toBe(false)
      expect(JSON.stringify(restored), name).toContain(name)
    }
  })
})
