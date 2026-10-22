import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import { describe, it } from "tstyche"

const R01 = Descriptor.Resource<number>()("Architecture/R01")
const R02 = Descriptor.Resource<number>()("Architecture/R02")
const R03 = Descriptor.Resource<number>()("Architecture/R03")
const R04 = Descriptor.Resource<number>()("Architecture/R04")
const R05 = Descriptor.Resource<number>()("Architecture/R05")
const R06 = Descriptor.Resource<number>()("Architecture/R06")
const R07 = Descriptor.Resource<number>()("Architecture/R07")
const R08 = Descriptor.Resource<number>()("Architecture/R08")
const R09 = Descriptor.Resource<number>()("Architecture/R09")
const R10 = Descriptor.Resource<number>()("Architecture/R10")
const R11 = Descriptor.Resource<number>()("Architecture/R11")
const R12 = Descriptor.Resource<number>()("Architecture/R12")
const R13 = Descriptor.Resource<number>()("Architecture/R13")
const R14 = Descriptor.Resource<number>()("Architecture/R14")
const R15 = Descriptor.Resource<number>()("Architecture/R15")
const R16 = Descriptor.Resource<number>()("Architecture/R16")

const Game = Schema.bind(Schema.fragment({
  resources: { R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16 }
}))

const define = <
  const Name extends string,
  D extends (typeof Game.schema.resources)[keyof typeof Game.schema.resources]
>(
  name: Name,
  descriptor: D
) => Game.System(name, {
  resources: { value: Game.System.writeResource(descriptor) }
}, ({ resources }) => {
  resources.value.update((value) => value + 1)
})

const S01 = define("Architecture/S01", R01)
const S02 = define("Architecture/S02", R02)
const S03 = define("Architecture/S03", R03)
const S04 = define("Architecture/S04", R04)
const S05 = define("Architecture/S05", R05)
const S06 = define("Architecture/S06", R06)
const S07 = define("Architecture/S07", R07)
const S08 = define("Architecture/S08", R08)
const S09 = define("Architecture/S09", R09)
const S10 = define("Architecture/S10", R10)
const S11 = define("Architecture/S11", R11)
const S12 = define("Architecture/S12", R12)
const S13 = define("Architecture/S13", R13)
const S14 = define("Architecture/S14", R14)
const S15 = define("Architecture/S15", R15)
const S16 = define("Architecture/S16", R16)

describe("normalized type architecture", () => {
  it("composes a wide schedule without rebuilding requirement object maps", () => {
    const first = Game.Schedule(S01, S02, S03, S04, S05, S06, S07, S08)
    const second = Game.Schedule(S09, S10, S11, S12, S13, S14, S15, S16)
    const schedule = Game.Schedule(first, Game.Schedule.applyDeferred(), second)

    const incomplete = Game.Runtime.make({ services: Runtime.services() }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing resource"
    incomplete.tick(schedule)
    incomplete.tryTick(schedule)

    const complete = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        R01: 0, R02: 0, R03: 0, R04: 0,
        R05: 0, R06: 0, R07: 0, R08: 0,
        R09: 0, R10: 0, R11: 0, R12: 0,
        R13: 0, R14: 0, R15: 0, R16: 0
      }
    }).success
    complete.tick(schedule)
  })
})
