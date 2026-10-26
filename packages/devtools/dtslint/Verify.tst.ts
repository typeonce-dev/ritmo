import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import type * as Snapshot from "@typeonce/ritmo/Snapshot"
import { Desync, Replay, Rendered, Verify } from "@typeonce/ritmo-devtools"
import * as PlaywrightEngine from "@typeonce/ritmo-devtools/PlaywrightEngine"
import { describe, expect, it } from "tstyche"

const Input = Descriptor.Service<Schedule.Source<{ readonly dx: number }>>()("VerifyTypes/Input")
const Game = Schema.bind(Schema.fragment({}))
const Move = Game.System("VerifyTypes/Move", { services: { input: Game.System.service(Input) } }, () => {})
const hostClock = HostClock.test()
const make = (playback: Replay.Playback) => ({
  runtime: Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Input, playback.source(Input))), debug: { hostClock } }).value,
  schedules: { update: Game.Schedule(Move) },
  hostClock
})
declare const file: Replay.ReplayFile
declare const outcome: Verify.Outcome

describe("Verify.acrossEngines", () => {
  it("returns the verified run, or why it is not verified", () => {
    expect(Verify.acrossEngines(make, file)).type.toBe<Promise<Result.Result<Rendered.Rendered<Verify.Verified>, Verify.VerifyError>>>()
    expect(Verify.acrossEngines(make, file, { engines: PlaywrightEngine.make({ entry: "target.ts", browsers: ["webkit"] }).engines }))
      .type.toBe<Promise<Result.Result<Rendered.Rendered<Verify.Verified>, Verify.VerifyError>>>()
  })

  it("narrows every outcome by its tag", () => {
    if (outcome._tag === "Diverged") {
      expect(outcome.tick).type.toBe<number>()
      expect(outcome.against).type.toBe<"node" | "recording">()
      expect(outcome.differences).type.toBe<ReadonlyArray<Desync.Difference>>()
    }
    if (outcome._tag === "EngineMissing") expect(outcome.install).type.toBe<string>()
  })

  it("requires a debug runtime that can be replayed", () => {
    const bare = (playback: Replay.Playback) => ({
      runtime: Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Input, playback.source(Input))) }).value,
      schedules: { update: Game.Schedule(Move) },
      hostClock
    })
    // @ts-expect-error Property 'debug' is missing
    void Verify.acrossEngines(bare, file)
    // @ts-expect-error Property 'hostClock' is missing
    void Verify.acrossEngines((playback: Replay.Playback) => ({ runtime: make(playback).runtime, schedules: make(playback).schedules }), file)
  })

  it("takes engines, not engine names", () => {
    // @ts-expect-error Type 'string' is not assignable to type 'Engine'
    void Verify.acrossEngines(make, file, { engines: ["webkit"] })
  })
})

describe("Verify.trace and Verify.snapshotAt", () => {
  it("return the checksums and the world, or why the replay did not open", () => {
    expect(Verify.trace(make, file)).type.toBe<Result.Result<Verify.Hashes, Replay.ReplayError>>()
    expect(Verify.snapshotAt(make, file, 10)).type.toBe<Result.Result<Snapshot.WorldSnapshot, Replay.ReplayError>>()
    // @ts-expect-error Expected 3 arguments, but got 2
    Verify.snapshotAt(make, file)
  })
})

describe("PlaywrightEngine", () => {
  it("runs chromium, webkit, and firefox", () => {
    expect(PlaywrightEngine.make({ entry: "target.ts", browsers: ["chromium", "webkit", "firefox"] })).type.toBe<PlaywrightEngine.Engines>()
    // @ts-expect-error Type '"opera"' is not assignable to type 'Browser'
    PlaywrightEngine.make({ entry: "target.ts", browsers: ["opera"] })
    const name = "webkit" as string
    if (PlaywrightEngine.isBrowser(name)) expect(name).type.toBe<PlaywrightEngine.Browser>()
  })
})
