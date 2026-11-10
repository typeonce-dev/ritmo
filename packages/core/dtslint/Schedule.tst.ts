import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Query from "@typeonce/ritmo/Query"
import * as Schedule from "@typeonce/ritmo/Schedule"
import * as System from "@typeonce/ritmo/System"
import { describe, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Position")
const Time = Descriptor.Resource<number>()("Time")

const Root = Schema.defineRoot("Schedule")
const Game = Schema.bind(Schema.fragment({
  components: {
    Position
  },
  resources: {
    Time
  }
}), Root)
const schema = Game.schema

const MovementSystem = System.System(
  "MovementSystem",
  {
    schema,
    queries: {
      position: Query.Query({
        selection: {
          position: Query.write(Position)
        }
      })
    }
  },
  () => {}
)

const ExplicitNameSystem = System.System(
  "ExplicitNameSystem",
  {
    schema,
    resources: {
      time: System.readResource(Time)
    }
  },
  ({ resources }) => { resources.time.get() }
)

const PlainSystem = System.System(
  "PlainSystem",
  {
    schema
  },
  () => {}
)

const SuffixSystem = System.System(
  "SuffixSystem",
  {
    schema
  },
  () => {}
)

describe("Schedule", () => {
  it("builds executable schedules from explicit authored plans", () => {
    const schedule = Schedule.Schedule(
      MovementSystem,
      Schedule.applyDeferred(),
      ExplicitNameSystem
    )

    schedule.steps
    schedule.systems
    schedule.requirements

    // @ts-expect-error Property 'label' does not exist on type 'AnonymousScheduleBuildFor<SchemaDefinition<{ readonly Position
    schedule.label

    // @ts-expect-error ScheduleEntry
    Schedule.Schedule([
      MovementSystem,
      Schedule.applyDeferred(),
      ExplicitNameSystem
    ])
  })

  it("creates reusable explicit fragments", () => {
    const hostMirror = Schedule.Schedule(
        SuffixSystem
      )

    const schedule = Schedule.Schedule(
      PlainSystem,
      Schedule.applyDeferred(),
      hostMirror
    )

    schedule.steps
    schedule.systems
  })

  it("creates reusable explicit phases", () => {
    const hostMirrorPhase = Schedule.Schedule(
        SuffixSystem
      )

    const schedule = Schedule.Schedule(
      PlainSystem,
      hostMirrorPhase
    )

    schedule.steps
    schedule.systems
  })

  it("composes systems, markers, and fragments into one schedule", () => {
    const hostMirror = Schedule.Schedule(
        SuffixSystem
      )

    const plan = Schedule.Schedule(
        PlainSystem,
        Schedule.applyDeferred(),
        hostMirror
      )

    plan.steps
    plan.systems

    const schedule = Schedule.Schedule(
      PlainSystem,
      Schedule.applyDeferred(),
      hostMirror
    )

    schedule.steps
    schedule.systems
  })
})
