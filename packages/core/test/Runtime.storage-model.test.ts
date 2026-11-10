import { describe, expect, it } from "vitest"
import type { QueryEntity } from "@typeonce/ritmo/Query"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"

/**
 * Random runs against a plain `Map` of what the world should hold: writes,
 * failed and throwing systems, structural commands, phases, and rewinds, with
 * reads on other pages in between. After each step every query, the `changed`
 * and `added` readers, and a slot kept past its run must agree with the model.
 *
 * Example tests missed bugs here because they follow one order of operations.
 * A failure names its profile, seed, and step, and replays exactly.
 */

type Value = number | { readonly a: number } | string | symbol | null | undefined

const Cell = Descriptor.Component<Value>()("Model/Cell")
const Left = Descriptor.Component<true>()("Model/Left")
const Right = Descriptor.Component<true>()("Model/Right")
const Root = Schema.defineRoot("Model")
const Game = Schema.bind(Schema.fragment({ components: { Cell, Left, Right } }), Root)
const Flow = Game.StateMachine("Model/Flow", { A: {}, B: {} })

type Id = Entity.EntityId<typeof Game.schema, typeof Root>
type Via = "left" | "right"
type FlowState = "A" | "B"

type Op =
  | { readonly kind: "read"; readonly id: Id }
  | { readonly kind: "set" | "update"; readonly via: Via; readonly id: Id; readonly value: Value }
type Command =
  | { readonly kind: "spawn"; readonly value: Value; readonly left: boolean; readonly right: boolean }
  | { readonly kind: "insert"; readonly id: Id; readonly value: Value }
  | { readonly kind: "remove" | "despawn"; readonly id: Id }
interface Plan {
  readonly ops: ReadonlyArray<Op>
  readonly commands: ReadonlyArray<Command>
  readonly outcome: "ok" | "fail" | "throw"
  /** Each written entity's value before this plan's first write to it. */
  readonly saved: Map<Id, Value>
}

const WriteLeft = Game.Query({ selection: { x: Game.Query.write(Cell) }, with: [Left] })
const WriteRight = Game.Query({ selection: { x: Game.Query.write(Cell) }, with: [Right] })
const ReadLeft = Game.Query({ selection: { x: Game.Query.read(Cell) }, with: [Left] })
const ReadRight = Game.Query({ selection: { x: Game.Query.read(Cell) }, with: [Right] })
const Everyone = Game.Query({ selection: { x: Game.Query.optional(Cell) } })
const Holders = Game.Query({ selection: { x: Game.Query.read(Cell) } })
const Changed = Game.Query({ selection: { x: Game.Query.read(Cell) }, filters: [Game.Query.changed(Cell)] })
const Added = Game.Query({ selection: { x: Game.Query.read(Cell) }, filters: [Game.Query.added(Cell)] })

const access = {
  queries: { writeLeft: WriteLeft, writeRight: WriteRight, readLeft: ReadLeft, readRight: ReadRight, everyone: Everyone, holders: Holders },
  commands: Game.System.commands(Game.System.spawns(Cell, Left, Right), Game.System.inserts(Cell), Game.System.removes(Cell), Game.System.despawns(Cell))
}

const LeftValues = Game.Inspector("Model/LeftValues", { queries: { q: ReadLeft } }, ({ queries }) => {
  const { x } = queries.q.data
  return queries.q.each().map((entity) => [entity.id, x.get(entity)] as const)
})
const RightValues = Game.Inspector("Model/RightValues", { queries: { q: ReadRight } }, ({ queries }) => {
  const { x } = queries.q.data
  return queries.q.each().map((entity) => [entity.id, x.get(entity)] as const)
})
const Optional = Game.Inspector("Model/Optional", { queries: { q: Everyone } }, ({ queries }) => {
  const { x } = queries.q.data
  return queries.q.each().map((entity) => ({ id: entity.id, has: x.has(entity), value: x.get(entity) }))
})

/** The same change test as the runtime's: `NaN` equals itself, `0` equals `-0`. */
const differs = (a: Value, b: Value) => a !== b && (a === a || b === b)

const random = (seed: number) => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, below: (count: number) => Math.floor(next() * count) }
}

interface Profile {
  readonly name: string
  readonly debug: boolean
  /** Decides which array of a page holds what: numbers, other values, or both. */
  readonly first: (rng: ReturnType<typeof random>, objects: ReadonlyArray<Value>, index: number) => Value
  readonly written: (rng: ReturnType<typeof random>, objects: ReadonlyArray<Value>) => Value
  /** Written by the later systems of a phase that will fail: a page may hold what it never held before. */
  readonly doomed: (rng: ReturnType<typeof random>, objects: ReadonlyArray<Value>) => Value
}

const symbol = Symbol("value")
const mixed: Profile["written"] = (rng, objects) => {
  const roll = rng.next()
  if (roll < 0.45) return rng.below(50)
  if (roll < 0.5) return Number.NaN
  if (roll < 0.53) return -0
  if (roll < 0.85) return objects[rng.below(objects.length)]
  if (roll < 0.9) return undefined
  if (roll < 0.94) return symbol
  if (roll < 0.97) return `s${rng.below(2)}`
  return null
}
const numbers: Profile["written"] = (rng) => rng.below(50)
const onlyObjects: Profile["written"] = (rng, objects) => objects[rng.below(objects.length)]

const profiles: ReadonlyArray<Profile> = [
  { name: "mixed values", debug: false, first: mixed, written: mixed, doomed: mixed },
  // A query picks its slots from its first entity: number slots here, over pages that hold no numbers.
  { name: "numbers only in a failed phase", debug: false, first: (rng, objects, index) => index < 2 ? index : onlyObjects(rng, objects), written: onlyObjects, doomed: mixed },
  { name: "numbers only", debug: false, first: numbers, written: numbers, doomed: numbers },
  { name: "a debug runtime", debug: true, first: mixed, written: mixed, doomed: mixed }
]

const INITIAL = 800
const MAX_ENTITIES = 1100
const SEEDS = 4
const STEPS = 100

const simulate = (profile: Profile, seed: number, steps: number) => {
  const rng = random(seed)
  const objects: ReadonlyArray<Value> = [{ a: 1 }, { a: 2 }, { a: 3 }]

  // The model. An entity lacking `Cell` is alive with no entry in `values`.
  let sides = new Map<Id, { readonly left: boolean; readonly right: boolean }>()
  let values = new Map<Id, Value>()
  let pendingChanged = new Set<Id>()
  let pendingAdded = new Set<Id>()
  let flow = "A" as FlowState

  const problems: Array<string> = []
  const compare = (where: string, got: Value, want: Value) => {
    if (!Object.is(got, want)) problems.push(`${where}: got ${String(got)}, want ${String(want)}`)
  }

  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(),
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "A" })),
    ...(profile.debug ? { debug: { hostClock: HostClock.test() } } : {})
  }).value

  const applyPlan = (plan: Plan) => {
    if (plan.outcome !== "ok") {
      for (const [id, value] of plan.saved) values.set(id, value)
      return
    }
    for (const [id, value] of plan.saved) if (differs(value, values.get(id))) pendingChanged.add(id)
  }

  const worker = (name: string, nextPlan: () => Plan, after: (plan: Plan) => void) =>
    Game.System(name, access, ({ commands, queries }) => {
      const plan = nextPlan()
      const left = queries.writeLeft.data
      const right = queries.writeRight.data
      const readLeft = queries.readLeft.data
      const readRight = queries.readRight.data
      const verify = <E>(
        label: string,
        id: Id,
        member: boolean,
        found: { readonly ok: true; readonly value: E } | { readonly ok: false },
        read: (entity: E) => Value
      ) => {
        if (found.ok !== member) problems.push(`${label} get(${id}): ok ${found.ok}, want ${member}`)
        else if (found.ok) compare(`${label} read of ${id}`, read(found.value), values.get(id))
      }
      for (const op of plan.ops) {
        if (op.kind === "read") {
          const side = sides.get(op.id)
          const hasLeft = values.has(op.id) && side?.left === true
          const hasRight = values.has(op.id) && side?.right === true
          verify("write left", op.id, hasLeft, queries.writeLeft.get(op.id), (entity) => left.x.get(entity))
          verify("write right", op.id, hasRight, queries.writeRight.get(op.id), (entity) => right.x.get(entity))
          verify("read left", op.id, hasLeft, queries.readLeft.get(op.id), (entity) => readLeft.x.get(entity))
          verify("read right", op.id, hasRight, queries.readRight.get(op.id), (entity) => readRight.x.get(entity))
          continue
        }
        const save = () => {
          if (!plan.saved.has(op.id)) plan.saved.set(op.id, values.get(op.id))
          values.set(op.id, op.value)
        }
        if (op.via === "left") {
          const found = queries.writeLeft.get(op.id)
          if (!found.ok) continue
          save()
          if (op.kind === "set") left.x.set(found.value, op.value)
          else left.x.update(found.value, () => op.value)
        } else {
          const found = queries.writeRight.get(op.id)
          if (!found.ok) continue
          save()
          if (op.kind === "set") right.x.set(found.value, op.value)
          else right.x.update(found.value, () => op.value)
        }
      }
      for (const command of plan.commands) {
        if (command.kind === "spawn") {
          const id = command.left && command.right
            ? commands.spawn(Game.Command.spawn([Cell, command.value], [Left, true], [Right, true]))
            : command.left
              ? commands.spawn(Game.Command.spawn([Cell, command.value], [Left, true]))
              : commands.spawn(Game.Command.spawn([Cell, command.value], [Right, true]))
          sides.set(id, { left: command.left, right: command.right })
          values.set(id, command.value)
          pendingChanged.add(id)
          pendingAdded.add(id)
          continue
        }
        if (command.kind === "despawn") {
          const found = queries.holders.get(command.id)
          if (found.ok) commands.despawn(found.value)
          else problems.push(`despawn's target ${command.id} is missing`)
          continue
        }
        const found = queries.everyone.get(command.id)
        if (!found.ok) problems.push(`a command's target ${command.id} is missing`)
        else if (command.kind === "insert") commands.insert(found.value, [Cell, command.value])
        else commands.remove(found.value, Cell)
      }
      after(plan)
      if (plan.outcome === "fail") return Result.failure("Model/Rejected" as const)
      if (plan.outcome === "throw") throw new Error("Model/Defect")
      return undefined
    })

  let plan: Plan = { ops: [], commands: [], outcome: "ok", saved: new Map() }
  const Run = worker("Model/Run", () => plan, () => {})

  // Each system of a phase takes its own plan, and the model follows it as it runs.
  let phasePlans: Array<Plan> = []
  const phaseWorker = (name: string) => worker(name, () => phasePlans.shift()!, applyPlan)
  const phase = [phaseWorker("Model/Phase1"), phaseWorker("Model/Phase2"), phaseWorker("Model/Phase3")] as const
  const transitions = Game.Schedule.transitions(Game.Schedule.onExit(Flow, "A", phase), Game.Schedule.onExit(Flow, "B", phase))
  const Toggle = Game.System("Model/Toggle", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
    nextMachines.flow.set({ _tag: flow === "A" ? "B" : "A" })
  })

  let seenChanged: ReadonlyArray<Id> = []
  let seenAdded: ReadonlyArray<Id> = []
  const Reader = Game.System("Model/Reader", { queries: { changed: Changed, added: Added } }, ({ queries }) => {
    seenChanged = queries.changed.each().map((entity) => entity.id)
    seenAdded = queries.added.each().map((entity) => entity.id)
  })
  const readers = Game.Schedule(Reader)

  // Slots from a run where the query was empty: valid when `data` is read again, stale after that run.
  type LeftEntity = QueryEntity<typeof Game.schema, typeof WriteLeft>
  let keptGet: ((entity: LeftEntity) => Value) | undefined
  let keptSet: ((entity: LeftEntity, value: Value) => void) | undefined
  let keptEntity: LeftEntity | undefined
  const Keep = Game.System("Model/Keep", { queries: { left: WriteLeft } }, ({ queries }) => {
    const { x } = queries.left.data
    keptGet = (entity) => x.get(entity)
    keptSet = (entity, value) => x.set(entity, value)
  })
  const UseKept = Game.System("Model/UseKept", { queries: { left: WriteLeft } }, ({ queries }) => {
    void queries.left.data
    keptEntity = queries.left.each()[0]
    if (keptEntity === undefined) return
    const current = values.get(keptEntity.id)
    compare("slot kept from an empty run", keptGet!(keptEntity), current)
    keptSet!(keptEntity, current)
  })

  const check = (where: string) => {
    const before = problems.length
    const compareRows = (label: string, got: ReadonlyArray<readonly [Id, Value]>, member: (id: Id) => boolean) => {
      const want = [...values].filter(([id]) => member(id))
      if (got.length !== want.length) problems.push(`${label}: ${got.length} entities, want ${want.length}`)
      else for (const [id, value] of got) compare(`${label} of ${id}`, value, values.get(id))
      for (const [id] of got) if (!member(id)) problems.push(`${label}: holds ${id}, which should not match`)
    }
    compareRows("left", runtime.inspect(LeftValues), (id) => values.has(id) && sides.get(id)?.left === true)
    compareRows("right", runtime.inspect(RightValues), (id) => values.has(id) && sides.get(id)?.right === true)
    const optional = runtime.inspect(Optional)
    if (optional.length !== sides.size) problems.push(`optional: ${optional.length} entities, want ${sides.size}`)
    for (const row of optional) {
      if (row.has !== values.has(row.id)) problems.push(`optional has(${row.id}): ${row.has}`)
      compare(`optional get of ${row.id}`, row.value, values.get(row.id))
    }

    runtime.tick(readers)
    const ids = (from: Iterable<Id>) => [...from].filter((id) => values.has(id)).sort((a, b) => a - b).join()
    if (ids(seenChanged) !== ids(pendingChanged)) problems.push(`changed: got ${ids(seenChanged)}, want ${ids(pendingChanged)}`)
    if (ids(seenAdded) !== ids(pendingAdded)) problems.push(`added: got ${ids(seenAdded)}, want ${ids(pendingAdded)}`)
    pendingChanged = new Set()
    pendingAdded = new Set()

    runtime.tick(Game.Schedule(UseKept))
    const entity = keptEntity
    if (entity !== undefined) {
      expectStale("get", () => keptGet!(entity))
      expectStale("set", () => keptSet!(entity, values.get(entity.id)))
    }
    if (problems.length > before) throw new Error(`${where}\n${problems.slice(before, before + 8).join("\n")}`)
  }
  const expectStale = (label: string, use: () => void) => {
    try {
      use()
      problems.push(`a kept slot's ${label} worked after its run`)
    } catch (error) {
      if (!/was used after the run/.test(String(error))) throw error
    }
  }

  const someId = () => {
    const ids = [...sides.keys()]
    return ids[rng.below(ids.length)]
  }
  const onPage = (id: Id) => [...sides.keys()].filter((other) => other >> 8 === id >> 8)

  const writesPlan = (outcome: Plan["outcome"], written = profile.written): Plan => {
    const ops: Array<Op> = []
    const write = (id: Id): Op => {
      const roll = rng.next()
      return {
        kind: roll < 0.9 ? "set" : "update",
        via: sides.get(id)?.left === true && (rng.next() < 0.5 || sides.get(id)?.right !== true) ? "left" : "right",
        id,
        value: rng.next() < 0.1 ? values.get(id) : written(rng, objects)
      }
    }
    const anchor = someId()
    if (anchor === undefined) return { ops, commands: [], outcome, saved: new Map() }
    const page = onPage(anchor)
    const count = 1 + rng.below(rng.next() < 0.1 ? 300 : 12)
    for (let index = 0; index < count; index++) {
      const id = rng.next() < 0.6 ? page[rng.below(page.length)]! : someId()!
      ops.push(rng.next() < 0.25 || !values.has(id) ? { kind: "read", id } : write(id))
    }
    return { ops, commands: [], outcome, saved: new Map() }
  }

  const structuralPlan = (): Plan => {
    const commands: Array<Command> = []
    // Commands run after the system: despawn proves `Cell` by what the entity holds now.
    const holding = new Set(values.keys())
    const anchor = someId()
    const page = anchor === undefined ? [] : onPage(anchor)
    const emptying = rng.next() < 0.25
    const targets = emptying ? page : Array.from({ length: 1 + rng.below(rng.next() < 0.1 ? 260 : 6) }, () => page[rng.below(page.length)]!).filter((id) => id !== undefined)
    for (const id of targets) {
      if (!sides.has(id)) continue
      const roll = rng.next()
      if (emptying || roll < 0.4) {
        if (values.has(id)) {
          commands.push({ kind: "remove", id })
          values.delete(id)
          pendingChanged.delete(id)
          pendingAdded.delete(id)
        }
      } else if (roll < 0.8) {
        const value = profile.written(rng, objects)
        commands.push({ kind: "insert", id, value })
        if (!values.has(id)) pendingAdded.add(id)
        values.set(id, value)
        pendingChanged.add(id)
      } else if (roll < 0.9) {
        if (!holding.has(id)) continue
        commands.push({ kind: "despawn", id })
        sides.delete(id)
        values.delete(id)
        pendingChanged.delete(id)
        pendingAdded.delete(id)
      } else if (sides.size < MAX_ENTITIES) {
        commands.push({ kind: "spawn", value: profile.written(rng, objects), left: rng.next() < 0.9, right: true })
      }
    }
    return { ops: [], commands, outcome: "ok", saved: new Map() }
  }

  // Every query is empty in the first run.
  runtime.tick(Game.Schedule(Keep))
  plan = {
    ops: [],
    commands: Array.from({ length: INITIAL }, (_, index): Command => ({
      kind: "spawn",
      value: profile.first(rng, objects, index),
      left: index % 8 !== 0,
      right: index % 8 !== 1
    })),
    outcome: "ok",
    saved: new Map()
  }
  runtime.tick(Game.Schedule(Run, Game.Schedule.applyDeferred()))
  check(`${profile.name}, seed ${seed}, setup`)

  const marks: Array<{
    readonly checkpoint: ReturnType<typeof runtime.checkpoint>
    readonly sides: typeof sides
    readonly values: typeof values
    readonly flow: FlowState
  }> = []

  for (let step = 0; step < steps; step++) {
    const where = `${profile.name}, seed ${seed}, step ${step}`
    const roll = rng.next()
    if (roll < 0.35) {
      plan = writesPlan("ok")
      runtime.tick(Game.Schedule(Run))
      applyPlan(plan)
    } else if (roll < 0.5) {
      plan = writesPlan("fail")
      expect(runtime.tick(Game.Schedule(Run)).ok, where).toBe(false)
      applyPlan(plan)
    } else if (roll < 0.55) {
      plan = writesPlan("throw")
      expect(() => runtime.tick(Game.Schedule(Run)), where).toThrow("Model/Defect")
      applyPlan(plan)
    } else if (roll < 0.7) {
      const fails = rng.next() < 0.7
      const valuesBefore = new Map(values)
      const changedBefore = new Set(pendingChanged)
      // A page's first commit in the phase saves it: only a later system's number finds it saved with no numbers.
      const later = fails ? profile.doomed : profile.written
      phasePlans = [writesPlan("ok"), writesPlan("ok", later), writesPlan(fails ? "fail" : "ok", later)]
      const result = runtime.tick(Game.Schedule(Toggle, Game.Schedule.applyStateTransitions(transitions)))
      expect(result.ok, where).toBe(!fails)
      if (fails) {
        // A failed phase undoes its systems' writes; its transition stays queued, and runs in the next one.
        values = valuesBefore
        pendingChanged = changedBefore
        check(`${where}, after the phase failed`)
        phasePlans = [writesPlan("ok"), writesPlan("ok"), writesPlan("ok")]
        expect(runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(transitions))).ok, where).toBe(true)
      }
      flow = flow === "A" ? "B" : "A"
    } else if (roll < 0.85) {
      plan = structuralPlan()
      runtime.tick(Game.Schedule(Run, Game.Schedule.applyDeferred()))
    } else if (roll < 0.93) {
      marks.push({ checkpoint: runtime.checkpoint(readers), sides: new Map(sides), values: new Map(values), flow })
      if (marks.length > 8) marks.shift()
    } else if (marks.length > 0) {
      const at = rng.below(marks.length)
      const mark = marks[at]!
      expect(runtime.rewind(mark.checkpoint).ok, where).toBe(true)
      marks.length = at + 1
      sides = new Map(mark.sides)
      values = new Map(mark.values)
      flow = mark.flow
      pendingChanged = new Set()
      pendingAdded = new Set()
    }
    check(where)
  }
}

describe("component storage against a model", () => {
  it.each(profiles)("agrees with the model through random runs: $name", (profile) => {
    for (let seed = 1; seed <= SEEDS; seed++) simulate(profile, seed, STEPS)
  }, 60_000)

  // Once a query filters on `changed`, commits log each change and skip this path, so the model cannot reach it.
  it("stamps changes when a commit writes whole words, with no change log yet", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).value
    const Spawn = Game.System("Model/SpawnNumbers", { commands: Game.System.commands(Game.System.spawns(Cell, Left)) }, ({ commands }) => {
      for (let index = 0; index < 300; index++) commands.spawn(Game.Command.spawn([Cell, index], [Left, true]))
    })
    const Write = Game.System("Model/WriteAll", { queries: { all: WriteLeft } }, ({ queries }) => {
      const { x } = queries.all.data
      for (const entity of queries.all.each()) {
        const current = x.get(entity)
        if (entity.id % 10 === 0 && typeof current === "number") x.set(entity, current + 1)
        else x.set(entity, entity.id % 10 === 1 ? Number.NaN : current)
      }
    })
    let reading = false
    let seen: ReadonlyArray<number> = []
    const Reader = Game.System("Model/LateReader", { queries: { changed: Changed } }, ({ queries }) => {
      if (reading) seen = queries.changed.each().map((entity) => entity.id)
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Write))
    runtime.tick(Game.Schedule(Reader))
    // Only the multiples of 10 differ now: a slot that stays `NaN` did not change, nor did one written its own value.
    runtime.tick(Game.Schedule(Write))
    reading = true
    runtime.tick(Game.Schedule(Reader))
    expect(seen).toEqual(Array.from({ length: 30 }, (_, index) => (index + 1) * 10))
  })
})
