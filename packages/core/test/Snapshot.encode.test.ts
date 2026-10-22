import { describe, expect, it } from "vitest"
import { Decode, Descriptor, Result, Schema, Snapshot } from "@typeonce/ritmo"
import { worldOf } from "./world-of.ts"

// A `Set` is not plain data: `JSON.stringify` turns it into `{}`. Its
// constructor saves it as a sorted list and reads the list back.
const isTags = (raw: unknown): raw is ReadonlyArray<string> => Array.isArray(raw) && raw.every((tag) => typeof tag === "string")
const tags = {
  result: (raw: ReadonlySet<string>) => Result.succeed(raw),
  decode: (raw: unknown) => isTags(raw) ? Result.succeed(new Set(raw) as ReadonlySet<string>) : Result.fail({ _tag: "InvalidTags" as const }),
  encode: (value: ReadonlySet<string>) =>
    [...value].every((tag) => tag.length > 0) ? Result.succeed([...value].sort()) : Result.fail({ _tag: "EmptyTag" as const })
}
const Tags = Descriptor.ConstructedComponent(tags)("Encode/Tags")

// An optional value held as `{ _tag: "Some", value } | { _tag: "None" }` in the
// world and saved as `number | null`, the shape Effect's `Option` takes.
type Maybe = { readonly _tag: "Some"; readonly value: number } | { readonly _tag: "None" }
const maybe = {
  result: (raw: Maybe) => Result.succeed(raw),
  decode: (raw: unknown) =>
    raw === null ? Result.succeed<Maybe>({ _tag: "None" })
    : typeof raw === "number" ? Result.succeed<Maybe>({ _tag: "Some", value: raw })
    : Result.fail({ _tag: "InvalidMaybe" as const }),
  encode: (value: Maybe) => Result.succeed(value._tag === "Some" ? value.value : null)
}
const Best = Descriptor.ConstructedResource(maybe)("Encode/Best")
const Name = Descriptor.ConstructedComponent(Decode.string)("Encode/Name")

const Game = Schema.bind(Schema.fragment({ components: { Tags, Name }, resources: { Best } }))

const makeRuntime = (best: Maybe) => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Best: best } })
  if (made._tag === "Failure") throw new Error("invalid fixture")
  return made.success
}
const spawn = (runtime: ReturnType<typeof makeRuntime>, values: ReadonlySet<string>) => {
  const Spawn = Game.System("Encode/Spawn", { commands: Game.System.commands(Game.System.spawns(Tags, Name)) }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([Tags, values], [Name, "hero"]))
  })
  const ran = runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  if (ran._tag === "Failure") throw new Error("spawn failed")
}
const Read = Game.Inspector("Encode/Read", {
  queries: { tagged: Game.Query({ selection: { tags: Game.Query.read(Tags), name: Game.Query.read(Name) } }) },
  resources: { best: Game.System.readResource(Best) }
}, ({ queries, resources }) => ({
  tags: queries.tagged.each().map((match) => [...match.data.tags.get()]),
  names: queries.tagged.each().map((match) => match.data.name.get()),
  best: resources.best.get()
}))

describe("snapshot encoding", () => {
  it("saves encoded values that survive JSON and restore to the same world", () => {
    const source = makeRuntime({ _tag: "Some", value: 7 })
    spawn(source, new Set(["b", "a"]))
    const saved = worldOf(source.snapshot())
    expect(saved.resources).toEqual({ "Encode/Best": 7 })
    expect(saved.entities[0]?.components).toEqual({ "Encode/Tags": ["a", "b"], "Encode/Name": "hero" })

    const target = makeRuntime({ _tag: "None" })
    expect(target.restore(JSON.parse(JSON.stringify(saved)))._tag).toBe("Success")
    expect(target.inspect(Read)).toEqual({ tags: [["a", "b"]], names: ["hero"], best: { _tag: "Some", value: 7 } })
  })

  it("saves a None as null and reads it back", () => {
    const source = makeRuntime({ _tag: "None" })
    const saved = worldOf(source.snapshot())
    expect(saved.resources).toEqual({ "Encode/Best": null })
    const target = makeRuntime({ _tag: "Some", value: 1 })
    expect(target.restore(JSON.parse(JSON.stringify(saved)))._tag).toBe("Success")
    expect(target.inspect(Read).best).toEqual({ _tag: "None" })
  })

  it("fails the snapshot, naming the entity, when an encoder rejects a value", () => {
    const source = makeRuntime({ _tag: "None" })
    spawn(source, new Set([""]))
    expect(source.snapshot()).toEqual(Result.fail({ _tag: "UnencodableComponent", entityId: 1, name: "Encode/Tags", error: { _tag: "EmptyTag" } }))
  })

  it("fails the snapshot when a resource's encoder rejects its value", () => {
    const Strict = Descriptor.ConstructedResource({
      result: (raw: number) => Result.succeed(raw),
      decode: (raw: unknown) => typeof raw === "number" ? Result.succeed(raw) : Result.fail("not a number"),
      encode: (value: number) => value >= 0 ? Result.succeed(value) : Result.fail("negative")
    })("Encode/Strict")
    const Strictly = Schema.bind(Schema.fragment({ resources: { Strict } }))
    const made = Strictly.Runtime.make({ services: Strictly.Runtime.services(), resources: { Strict: -1 } })
    if (made._tag === "Failure") throw new Error("invalid fixture")
    expect(made.success.snapshot()).toEqual(Result.fail({ _tag: "UnencodableResource", name: "Encode/Strict", error: "negative" }))
  })

  it("hands migrations the encoded form", () => {
    let seen: unknown
    const saves = Snapshot.migrations(Snapshot.migration(1, (save) => {
      seen = save.entities[0]?.components["Encode/Tags"]
      return save
    }))
    const source = makeRuntime({ _tag: "None" })
    spawn(source, new Set(["x"]))
    const old = { ...worldOf(source.snapshot()), gameVersion: 0 }
    const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Best: { _tag: "None" } }, saves })
    if (made._tag === "Failure") throw new Error("invalid fixture")
    expect(made.success.restore(JSON.parse(JSON.stringify(old)))._tag).toBe("Success")
    expect(seen).toEqual(["x"])
  })

  it("keeps values without an encoder as they are", () => {
    const Plain = Descriptor.ConstructedResource(Decode.struct({ level: Decode.integer }))("Encode/Plain")
    const Plainly = Schema.bind(Schema.fragment({ resources: { Plain } }))
    const value = { level: 3 }
    const made = Plainly.Runtime.make({ services: Plainly.Runtime.services(), resources: { Plain: value } })
    if (made._tag === "Failure") throw new Error("invalid fixture")
    expect(worldOf(made.success.snapshot()).resources["Encode/Plain"]).toBe(made.success.resourceValues.Plain)
  })
})

describe("Decode codecs carry encoders", () => {
  const Inner: Decode.Codec<ReadonlySet<string>> = {
    result: (raw) => Result.succeed(raw),
    decode: (raw) => isTags(raw) ? Result.succeed(new Set(raw)) : Result.fail({ _tag: "DecodeError", path: "$", expected: "tags", actual: raw }),
    encode: (value) => value.size > 0 ? Result.succeed([...value]) : Result.fail({ _tag: "DecodeError", path: "$", expected: "a tag", actual: [] })
  }

  it("encodes only the struct fields whose codec has an encoder", () => {
    const codec = Decode.struct({ tags: Inner, level: Decode.integer })
    expect(codec.encode?.({ tags: new Set(["a"]), level: 2 })).toEqual(Result.succeed({ tags: ["a"], level: 2 }))
    expect(Decode.struct({ level: Decode.integer }).encode).toBeUndefined()
  })

  it("encodes array items and nullable values, and names the failing path", () => {
    const list = Decode.array(Inner)
    expect(list.encode?.([new Set(["a"]), new Set(["b"])])).toEqual(Result.succeed([["a"], ["b"]]))
    expect(list.encode?.([new Set(["a"]), new Set()])).toEqual(Result.fail({ _tag: "DecodeError", path: "$[1]", expected: "a tag", actual: [] }))
    const optional = Decode.nullable(Decode.struct({ tags: Inner }))
    expect(optional.encode?.(null)).toEqual(Result.succeed(null))
    expect(optional.encode?.({ tags: new Set() })).toEqual(Result.fail({ _tag: "DecodeError", path: "$.tags", expected: "a tag", actual: [] }))
    expect(Decode.array(Decode.number).encode).toBeUndefined()
  })
})
