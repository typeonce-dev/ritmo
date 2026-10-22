import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"

const Hit = Descriptor.Event<number>()("StreamLoss/Hit")
const Game = Schema.bind(Schema.fragment({ events: { Hit } }))
const Running = Game.Condition.check("StreamLoss/Running", {}, () => true)

const Emit = Game.System("StreamLoss/Emit", { events: { hit: Game.System.writeEvent(Hit) } }, ({ events }) => {
  for (let index = 0; index < Runtime.streamCapacity + 10; index++) events.hit.emit(index)
})
const lintsOf = (runtime: { readonly debug: { describe(): { readonly lints: ReadonlyArray<{ readonly code: string; readonly severity: string; readonly message: string }> } } }) =>
  runtime.debug.describe().lints.filter((lint) => lint.code === "stream-loss-unread").map((lint) => `${lint.severity}: ${lint.message}`)

describe("the stream-loss-unread lint", () => {
  it("warns when a reader lost entries and never checks lagged()", () => {
    const Count = Game.System("StreamLoss/Count", { events: { hit: Game.System.readEvent(Hit) } }, ({ events }) => {
      events.hit.all()
    })
    const Checked = Game.System("StreamLoss/Checked", { events: { hit: Game.System.readEvent(Hit) } }, ({ events }) => {
      if (events.hit.lagged()) return
      events.hit.all()
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success
    runtime.tick(Game.Schedule(Count, Checked))
    runtime.tick(Game.Schedule(Emit))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule(Count, Checked))
    expect(lintsOf(runtime)).toEqual([
      "warning: StreamLoss/Count read events StreamLoss/Hit after entries were dropped before it read them (once), and never checks lagged()"
    ])
  })

  it("notes a paused reader that never checks lagged()", () => {
    const Paused = Game.System("StreamLoss/Paused", {
      events: { hit: Game.System.readEvent(Hit) },
      pauseWhen: [Running]
    }, ({ events }) => {
      events.hit.all()
    })
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } }).success
    runtime.tick(Game.Schedule(Paused))
    expect(lintsOf(runtime)).toEqual([
      "info: StreamLoss/Paused reads events StreamLoss/Hit under pauseWhen and never checks lagged(): a long pause drops entries past the stream's capacity"
    ])
  })
})
