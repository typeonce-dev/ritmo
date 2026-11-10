import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Streams from "@typeonce/ritmo/internal/streams"
import { makeWorld } from "@typeonce/ritmo/internal/world"

/**
 * What a held checkpoint keeps of the message and despawn logs after they
 * drop it. A rewind brings back only what the log held when a checkpoint was
 * taken, so one checkpoint held for long (a level retry, an undo) keeps no
 * more than that, however much is published after it.
 */

const Pos = Descriptor.Component<number>()("Graves/Pos")
const Game = Schema.bind(Schema.fragment({ components: { Pos } }))
const Hit = Symbol("Graves/Hit")

describe("a held checkpoint keeps of the message log", () => {
  /** A log with no reader that drops every batch but the newest: one batch per tick. */
  const publish = (streams: Streams.Streams<number>, from: number, to: number): void => {
    for (let tick = from; tick < to; tick++) {
      streams.append(Hit, tick, [tick])
      streams.trim(tick - 1)
    }
  }

  it("only the batches published before it", () => {
    const streams = Streams.make<number>(1024)
    publish(streams, 1, 4)
    const mark = streams.mark()
    publish(streams, 4, 2_000)
    expect(streams.kept(Hit)).toBe(1)
    streams.rewind(mark, 3)
    expect(streams.since(Hit, 0)).toEqual([3])
    expect(streams.kept(Hit)).toBe(0)
  })

  it("the batches published up to the newest one, for the oldest one", () => {
    const streams = Streams.make<number>(1024)
    publish(streams, 1, 4)
    const older = streams.mark()
    publish(streams, 4, 10)
    streams.mark()
    publish(streams, 10, 2_000)
    // Ticks 3 and 9, in the log when the older and the newer were taken.
    expect(streams.kept(Hit)).toBe(2)
    // With the newer one released, tick 9 is past the newest held.
    streams.release([older])
    expect(streams.kept(Hit)).toBe(1)
    streams.rewind(older, 3)
    expect(streams.since(Hit, 0)).toEqual([3])
  })

  it("brings back every batch a rewind to the newer one needs, after an older one", () => {
    const streams = Streams.make<number>(1024)
    publish(streams, 1, 4)
    streams.mark()
    publish(streams, 4, 10)
    const newer = streams.mark()
    publish(streams, 10, 2_000)
    streams.rewind(newer, 9)
    expect(streams.since(Hit, 0)).toEqual([9])
  })
})

describe("a held checkpoint keeps of the despawn log", () => {
  it("only the records made before it", () => {
    const world = makeWorld(Game.schema, 1024)
    /** One frame with no reader: despawns one entity, and drops all but the newest record. */
    const despawnOne = (): number => {
      world.advanceTick()
      const id = world.allocateEntity()
      world.spawnEntity(id, [])
      world.destroyEntity(id)
      world.advanceFrame()
      return id
    }
    despawnOne()
    despawnOne()
    const before = despawnOne()
    const mark = world.takeMark()
    for (let frame = 0; frame < 2_000; frame++) despawnOne()
    expect(world.keptLifecycleEntries()).toBe(1)
    world.rewindToMark(mark)
    expect(world.despawnedSince(0)).toEqual([before])
    expect(world.keptLifecycleEntries()).toBe(0)
  })
})
