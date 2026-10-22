import { Descriptor, Result, Entity, Schema } from "@typeonce/ritmo"
import * as Public from "@typeonce/ritmo"
import type { EntityId } from "@typeonce/ritmo/Entity"
import * as QueryTypes from "@typeonce/ritmo/Query"
import * as Relation from "@typeonce/ritmo/Relation"
import type * as SchemaTypes from "@typeonce/ritmo/Schema"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Position")
const Time = Descriptor.Resource<number>()("Time")
const Phase = Descriptor.Resource<"Running" | "Paused">()("Phase")
const TickEvent = Descriptor.Event<{ dt: number }>()("TickEvent")
const Velocity = Descriptor.Component<{ dx: number; dy: number }>()("Velocity")
const { relation: ChildOf } = Descriptor.Hierarchy("ChildOf", "Children")
const { relation: Targeting } = Descriptor.Relation("Targeting", "TargetedBy")

describe("Schema", () => {
  it("does not export top-level runtime authoring namespaces from the public barrel", () => {
    // @ts-expect-error Property 'System' does not exist on type
    Public.System
    // @ts-expect-error Property 'Schedule' does not exist on type
    Public.Schedule
    // @ts-expect-error Property 'Runtime' does not exist on type
    Public.Runtime
    // @ts-expect-error Property 'Query' does not exist on type
    Public.Query
    // @ts-expect-error Property 'Command' does not exist on type
    Public.Command
    // @ts-expect-error Property 'StateMachine' does not exist on type
    Public.StateMachine
  })

  it("preserves exact fragment registries", () => {
    const fragment = Schema.fragment({
      components: {
        Position
      },
      resources: {
        DeltaTime: Time,
        CurrentPhase: Phase
      },
      events: {
        Tick: TickEvent
      }
    })

    expect(fragment).type.toBe<Schema.SchemaDefinition<
      { readonly Position: typeof Position },
      { readonly DeltaTime: typeof Time; readonly CurrentPhase: typeof Phase },
      { readonly Tick: typeof TickEvent }
    >>()
  })

  it("bind merges fragment registries into one final schema", () => {
    const left = Schema.fragment({
      components: {
        Position
      },
      resources: {
        DeltaTime: Time
      }
    })

    const right = Schema.fragment({
      events: {
        Tick: TickEvent
      },
      resources: {
        CurrentPhase: Phase
      }
    })

    const Game = Schema.bind(left, right)
    const schema = Game.schema

    expect(schema).type.toBe<Schema.SchemaDefinition<
      { readonly Position: typeof Position },
      { readonly DeltaTime: typeof Time } & { readonly CurrentPhase: typeof Phase },
      { readonly Tick: typeof TickEvent }
    >>()
  })

  it("rejects a descriptor in the registry of another kind, naming where it belongs", () => {
    const Hit = Descriptor.Event<number>()("Schema/RegistryHit")
    Schema.fragment({
      components: {
        Position,
        // @ts-expect-error Time is a resource, not a component: move it to resources: { ... }
        Time
      }
    })
    Schema.fragment({
      resources: {
        Time,
        // @ts-expect-error Position is a component, not a resource: move it to components: { ... }
        Position
      }
    })
    Schema.fragment({
      // @ts-expect-error Hit is an event, not a component: move it to events: { ... }
      components: { Hit },
      events: {
        // @ts-expect-error Phase is a resource, not an event: move it to resources: { ... }
        Phase
      }
    })
    expect(Schema.fragment({ components: { Position }, resources: { Time }, events: { Hit } })).type.not.toRaiseError()
  })

  it("rejects duplicate schema keys", () => {
    const left = Schema.fragment({
      resources: {
        DeltaTime: Time
      }
    })

    const right = Schema.fragment({
      resources: {
        DeltaTime: Descriptor.Resource<number>()("OtherTime")
      }
    })

    // @ts-expect-error __schemaConflicts__: "resources key \"DeltaTime\""
    Schema.bind(left, right)
  })

  it("bind closes the schema over systems, schedules, and runtimes", () => {
    const schema = Schema.fragment({
      components: {
        Position
      },
      resources: {
        DeltaTime: Time,
        CurrentPhase: Phase
      }
    })
    const Game = Schema.bind(schema)

    const MoveSystem = Game.System(
      "Move",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.write(Position)
            }
          })
        },
        resources: {
          time: Game.System.readResource(Time)
        }
      },
      ({ queries, resources }) =>
        {
          resources.time.get()
          for (const match of queries.moving.each()) {
            match.data.position.get()
          }
        }
    )

    const update = Game.Schedule(MoveSystem)

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: {
        DeltaTime: 1 / 60,
        CurrentPhase: "Running"
      }
    }).success

    expect(update).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
    runtime.tick(update)
  })

  it("supports explicit optional component access without widening entity proofs", () => {
    const schema = Schema.fragment({
      components: {
        Position,
        Velocity
      }
    })
    const Game = Schema.bind(schema)

    const ObserveSystem = Game.System(
      "ObserveOptional",
      {
        queries: {
          moving: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.optional(Velocity)
            }
          })
        }
      },
      ({ queries }) =>
        {
          for (const match of queries.moving.each()) {
            expect(match.data.velocity).type.toBe<QueryTypes.OptionalReadCell<{ dx: number; dy: number }>>()
            expect(match.entity.proof).type.toBe<{
              readonly position: QueryTypes.ReadonlyValue<{ x: number; y: number }>
            }>()

            // @ts-expect-error Property 'get' does not exist on type 'AbsentOptionalReadCell'.
            match.data.velocity.get()

            if (match.data.velocity.present) {
              expect(match.data.velocity.get()).type.toBe<QueryTypes.ReadonlyValue<{ dx: number; dy: number }>>()
            }
          }
        }
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services()
    }).success

    expect(Game.Schedule(ObserveSystem)).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
  })

  it("supports a zero-or-one singleton read without widening successful matches", () => {
    const schema = Schema.fragment({
      components: {
        Position,
        Velocity
      }
    })
    const Game = Schema.bind(schema)
    const MovingQuery = Game.Query({
      selection: {
        position: Game.Query.write(Position),
        velocity: Game.Query.read(Velocity)
      }
    })

    const ObserveSystem = Game.System(
      "ObserveSingleOptional",
      {
        queries: {
          moving: MovingQuery
        }
      },
      ({ queries }) =>
        {
          const result = queries.moving.singleOptional()
          expect(result).type.toBe<Result.Result<
            QueryTypes.QueryMatch<typeof schema, typeof MovingQuery> | undefined,
            QueryTypes.Query.MultipleEntitiesError
          >>()

          if (result._tag === "Failure" || !result.success) {
            return
          }

          expect(result.success.entity.proof).type.toBe<{
            readonly position: QueryTypes.ReadonlyValue<{ x: number; y: number }>
            readonly velocity: QueryTypes.ReadonlyValue<{ dx: number; dy: number }>
          }>()
          result.success.data.position.set({ x: 0, y: 0 })
          expect(result.success.data.velocity.get()).type.toBe<QueryTypes.ReadonlyValue<{ dx: number; dy: number }>>()
        }
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services()
    }).success

    expect(Game.Schedule(ObserveSystem)).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
  })

  it("rejects non-component descriptors in query selection and structural filters", () => {
    const schema = Schema.fragment({
      components: {
        Position
      },
      resources: {
        DeltaTime: Time
      }
    })
    const Game = Schema.bind(schema)

    // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
    Game.Query.read(Time)
    // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
    Game.Query.optional(Time)
    Game.Query({
      selection: {
        position: Game.Query.read(Position)
      },
      with: [
        // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
        Time
      ]
    })
    Game.Query({
      selection: {
        position: Game.Query.read(Position)
      },
      without: [
        // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
        Time
      ]
    })
  })

  it("supports explicit lifecycle query filters and lifecycle readers", () => {
    const schema = Schema.fragment({
      components: {
        Position,
        Velocity
      },
      resources: {
        DeltaTime: Time
      }
    })
    const Game = Schema.bind(schema)

    const ObserveLifecycleSystem = Game.System(
      "ObserveLifecycle",
      {
        queries: {
          moved: Game.Query({
            selection: {
              position: Game.Query.read(Position),
              velocity: Game.Query.optional(Velocity)
            },
            filters: [Game.Query.changed(Position)] as const
          })
        },
        removed: {
          positions: Game.System.readRemoved(Position)
        },
        despawned: {
          entities: Game.System.readDespawned()
        }
      },
      ({ queries, removed, despawned }) =>
        {
          for (const match of queries.moved.each()) {
            expect(match.data.velocity).type.toBe<QueryTypes.OptionalReadCell<{ dx: number; dy: number }>>()
          }

          expect(removed.positions.all()).type.toBe<ReadonlyArray<EntityId<typeof schema, typeof schema>>>()
          expect(despawned.entities.all()).type.toBe<ReadonlyArray<EntityId<typeof schema, typeof schema>>>()
          expect(removed.positions.lagged()).type.toBe<boolean>()
          expect(despawned.entities.lagged()).type.toBe<boolean>()
        }
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services()
    }).success

    const schedule = Game.Schedule(ObserveLifecycleSystem)

    expect(schedule).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
  })

  it("rejects non-component descriptors in lifecycle query APIs", () => {
    const schema = Schema.fragment({
      components: {
        Position
      },
      resources: {
        DeltaTime: Time
      }
    })
    const Game = Schema.bind(schema)

    // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
    Game.Query.added(Time)
    // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
    Game.Query.changed(Time)
    // @ts-expect-error Type '"resource"' is not assignable to type '"component"'.
    Game.System.readRemoved(Time)
  })

  it("rejects cross-schema systems and schedules on the bound path", () => {
    const GameA = Schema.bind(Schema.fragment({
      components: {
        Position
      },
      resources: {
        DeltaTime: Time
      }
    }))
    const schemaA = GameA.schema

    const GameB = Schema.bind(Schema.fragment({
      components: {
        Velocity
      }
    }))
    const schemaB = GameB.schema

    const SystemA = GameA.System(
      "A",
      {
        queries: {
          moving: GameA.Query({
            selection: {
              position: GameA.Query.read(Position)
            }
          })
        }
      },
      () => {}
    )

    const SystemB = GameB.System(
      "B",
      {
        queries: {
          moving: GameB.Query({
            selection: {
              velocity: GameB.Query.read(Velocity)
            }
          })
        }
      },
      () => {}
    )

    type GameBSystem = Parameters<typeof GameB.Schedule>[number]
    // @ts-expect-error Type 'BoundSystem<SchemaDefinition<{ readonly Position: Descriptor<"component", "Position", { x: number; y
    const _invalidSystem: GameBSystem = SystemA

    const runtimeA = GameA.Runtime.make({
      services: GameA.Runtime.services(),
      resources: {
        DeltaTime: 1 / 60
      }
    }).success

    const scheduleB = GameB.Schedule(SystemB)

    // @ts-expect-error Property 'Position' is missing in type '{ readonly Velocity: Descriptor.Descriptor<"component", "Velocity", {
    runtimeA.tick(scheduleB)

    const scheduleA = GameA.Schedule(SystemA)
    type GameAScheduleEntry = Parameters<typeof GameA.Schedule>[number]

    scheduleA

    // @ts-expect-error Type 'BoundSystem<SchemaDefinition<{ readonly Velocity: Descriptor<"component", "Velocity", { dx: number; dy
    const _invalidSystemForA: GameAScheduleEntry = SystemB
  })

  it("supports explicit relation query access and hierarchy-only lookup helpers", () => {
    const schema = Schema.fragment({
      components: {
        Position
      },
      relations: {
        ChildOf,
        Targeting
      }
    })
    const Game = Schema.bind(schema)
    const entityId = Entity.makeEntityId<typeof schema, typeof Game.schema>(1)

    const query = Game.Query({
      selection: {
        parent: Game.Query.readRelation(ChildOf),
        children: Game.Query.optionalRelated(ChildOf),
        target: Game.Query.optionalRelation(Targeting)
      },
      withRelations: [ChildOf]
    })

    expect(query).type.toBeAssignableTo<QueryTypes.QuerySpec<{
      readonly parent: Relation.RelationReadAccess<typeof ChildOf, typeof schema, typeof Game.schema>
      readonly children: Relation.OptionalRelatedReadAccess<typeof ChildOf, typeof schema, typeof Game.schema>
      readonly target: Relation.OptionalRelationReadAccess<typeof Targeting, typeof schema, typeof Game.schema>
    }, readonly [], readonly [], readonly [], readonly [typeof ChildOf], readonly [], readonly [], readonly [], typeof Game.schema>>()

    const ObserveSystem = Game.System(
      "ObserveRelations",
      {
        queries: { nodes: query },
        relationFailures: {
          targeting: Game.System.readRelationFailures(Targeting),
          childOf: Game.System.readRelationFailures(ChildOf)
        },
        commands: Game.System.commands(Game.System.relates(Targeting, ChildOf))
      },
      ({ queries, lookup, commands, relationFailures }) =>
        {
          lookup.parent(entityId, ChildOf)
          lookup.ancestors(entityId, ChildOf)
          queries.nodes.children(entityId, ChildOf)
          queries.nodes.descendants(entityId, ChildOf, { order: "depth" })
          lookup.related(entityId, Targeting)
          relationFailures.targeting.all()
          commands.relate(entityId, Targeting, entityId)
          commands.unrelate(entityId, Targeting)
          commands.reorderChildren(entityId, ChildOf, [entityId])

          expect(relationFailures.targeting.all()).type.toBeAssignableTo<ReadonlyArray<Relation.Relation.MutationFailure<
            typeof Targeting,
            typeof schema,
            typeof Game.schema
          >>>()
          expect(relationFailures.childOf.all()).type.toBeAssignableTo<ReadonlyArray<Relation.Relation.MutationFailure<
            typeof ChildOf,
            typeof schema,
            typeof Game.schema
          >>>()
          expect(queries.nodes.children(entityId, ChildOf)).type.toBeAssignableTo<Result.Result<
            ReadonlyArray<QueryTypes.QueryMatch<typeof schema, typeof query>>,
            Relation.Relation.MissingEntityError
          >>()
          expect(queries.nodes.descendants(entityId, ChildOf, { order: "breadth" })).type.toBeAssignableTo<Result.Result<
            ReadonlyArray<QueryTypes.QueryMatch<typeof schema, typeof query>>,
            Relation.Relation.MissingEntityError
          >>()

          // @ts-expect-error Type '"Targeting"' is not assignable to type '"ChildOf"'.
          commands.reorderChildren(entityId, Targeting, [entityId])
          // @ts-expect-error Type 'RelatedDefinition<"Children", "ChildOf", "hierarchy", PairBrand<"ChildOf", "Children", "hierarchy">>'
          commands.reorderChildren(entityId, ChildOf.related, [entityId])
          // @ts-expect-error Type 'Descriptor<"component", "Position", { x: number; y: number; }>' is missing the following properties
          Game.Query.readRelation(Position)
          // @ts-expect-error Type 'Descriptor<"component", "Position", { x: number; y: number; }>' is missing the following properties
          Game.Query.readRelated(Position)
          // @ts-expect-error Type '"Targeting"' is not assignable to type '"ChildOf"'.
          lookup.parent(entityId, Targeting)
          // @ts-expect-error Type '"Targeting"' is not assignable to type '"ChildOf"'.
          queries.nodes.children(entityId, Targeting)
          // @ts-expect-error Type '"Targeting"' is not assignable to type '"ChildOf"'.
          queries.nodes.descendants(entityId, Targeting)
          // @ts-expect-error Type 'Descriptor<"component", "Position", { x: number; y: number; }>' is missing the following properties
          Game.System.readRelationFailures(Position)
        }
    )
  })

  it("rejects undeclared query result fields across every query-handle surface", () => {
    const Root = Schema.defineRoot("ExactQueryRoot")
    const Tagged = Descriptor.Component<{ readonly kind: "tagged" }>()("Tagged")

    const Game = Schema.bind(Schema.fragment({
      components: {
        Position,
        Velocity,
        Tagged
      },
      relations: {
        ChildOf
      }
    }), Root)
    const schema = Game.schema
    const entityId = Entity.makeEntityId<typeof schema, typeof Root>(1)

    const CameraTargetQuery = Game.Query({
      selection: {
        position: Game.Query.read(Position),
        tagged: Game.Query.read(Tagged)
      }
    })

    const ObserveSystem = Game.System(
      "ObserveExactQueryMatches",
      {
        queries: {
          player: CameraTargetQuery
        }
      },
      ({ queries }) =>
        {
          for (const match of queries.player.each()) {
            match.data.position.get()
            // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
            match.data.velocity.get()
          }

          const single = queries.player.single()
          if (single._tag === "Success") {
            single.success.data.position.get()
            // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
            single.success.data.velocity.get()
          }

          const singleOptional = queries.player.singleOptional()
          if (singleOptional._tag === "Success" && singleOptional.success) {
            singleOptional.success.data.position.get()
            // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
            singleOptional.success.data.velocity.get()

            const handle = Game.Entity.handle(singleOptional.success.entity.id, Position)
            const fromHandle = queries.player.getHandle(handle)
            if (fromHandle._tag === "Success") {
              fromHandle.success.data.position.get()
              // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
              fromHandle.success.data.velocity.get()
            }
          }

          const direct = queries.player.get(entityId)
          if (direct._tag === "Success") {
            direct.success.data.position.get()
            // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
            direct.success.data.velocity.get()
          }

          const children = queries.player.children(entityId, ChildOf)
          if (children._tag === "Success") {
            for (const child of children.success) {
              child.data.position.get()
              // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
              child.data.velocity.get()
            }
          }

          const descendants = queries.player.descendants(entityId, ChildOf, { order: "depth" })
          if (descendants._tag === "Success") {
            for (const descendant of descendants.success) {
              descendant.data.position.get()
              // @ts-expect-error Property 'velocity' does not exist on type 'Cells<QuerySpec<{ readonly position
              descendant.data.velocity.get()
            }
          }
        }
    )

    expect(ObserveSystem).type.toBeAssignableTo<SchemaTypes.Schema.BoundSystem<typeof schema, typeof Root, any, never>>()
  })

  it("supports durable handles with explicit roots, resolved through declared queries", () => {
    const Root = Schema.defineRoot("HandleRoot")
    const Target = Descriptor.Component<{
      target: Entity.Handle<typeof Root, typeof Position> | null
    }>()("Target")

    const Game = Schema.bind(Schema.fragment({
      components: {
        Position,
        Target
      }
    }), Root)
    const schema = Game.schema

    const PositionQuery = Game.Query({ selection: { position: Game.Query.read(Position) } })
    const TargetQuery = Game.Query({ selection: { target: Game.Query.read(Target), position: Game.Query.read(Position) } })
    const WithQuery = Game.Query({ selection: { target: Game.Query.read(Target) }, with: [Position] as const })
    const WrongQuery = Game.Query({ selection: { target: Game.Query.read(Target) } })
    const OptionalOnlyQuery = Game.Query({ selection: { target: Game.Query.read(Target), position: Game.Query.optional(Position) } })
    const LifecycleOnlyQuery = Game.Query({ selection: { target: Game.Query.read(Target) }, filters: [Game.Query.changed(Position)] as const })

    const ObserveSystem = Game.System(
      "ObserveHandles",
      {
        queries: {
          targets: TargetQuery,
          positions: PositionQuery,
          withPosition: WithQuery,
          wrong: WrongQuery,
          optionalOnly: OptionalOnlyQuery,
          lifecycleOnly: LifecycleOnlyQuery
        }
      },
      ({ queries, lookup }) =>
        {
          for (const match of queries.targets.each()) {
            const current = match.data.target.get().target
            if (!current) {
              continue
            }

            expect(queries.positions.getHandle(current)).type.toBe<Result.Result<QueryTypes.QueryMatch<typeof schema, typeof PositionQuery>, QueryTypes.Query.LookupError>>()
            queries.withPosition.getHandle(current)

            const unqualified = Game.Entity.handle(match.entity.id)
            expect(unqualified).type.toBe<Entity.Handle<typeof Root>>()
            const fromRef = Game.Entity.handle(match.entity)
            expect(fromRef).type.toBe<Entity.Handle<typeof Root>>()
            const qualified = Game.Entity.handle(match.entity.id, Position)
            expect(qualified).type.toBe<Entity.Handle<typeof Root, typeof Position>>()
            const fromRefQualified = Game.Entity.handle(match.entity, Position)
            expect(fromRefQualified).type.toBe<Entity.Handle<typeof Root, typeof Position>>()
            // A handle without an intent resolves through any declared query.
            queries.wrong.getHandle(unqualified)

            // @ts-expect-error Types of property '__brand' are incompatible.
            queries.positions.get(current)
            // @ts-expect-error this query does not prove the handle's intent component: select it, or add it to with
            queries.wrong.getHandle(current)
            // @ts-expect-error this query does not prove the handle's intent component: select it, or add it to with
            queries.optionalOnly.getHandle(current)
            // A query with a changed filter has no lookups: they would fail whenever nothing changed.
            // @ts-expect-error lookups need a query without added/changed filters: declare a second query for resolving entities
            queries.lifecycleOnly.getHandle(current)
            // @ts-expect-error Property 'getHandle' does not exist on type 'LookupApi
            lookup.getHandle(current, PositionQuery)
          }
        }
    )

    expect(ObserveSystem).type.toBeAssignableTo<SchemaTypes.Schema.BoundSystem<typeof schema, typeof Root, any, never>>()
  })

  it("cannot write through a query the system did not declare", () => {
    const Hp = Descriptor.Component<number>()("UndeclaredWrite/Hp")
    const Game = Schema.bind(Schema.fragment({ components: { Hp } }))
    const entityId = Entity.makeEntityId<typeof Game.schema, typeof Game.schema>(1)
    Game.System("UndeclaredWrite/Probe", {
      queries: { readers: Game.Query({ selection: { hp: Game.Query.read(Hp) } }) }
    }, ({ queries, lookup }) => {
      const read = queries.readers.get(entityId)
      if (read._tag === "Success") {
        // @ts-expect-error Property 'set' does not exist on type 'ReadCell<number>'.
        read.success.data.hp.set(0)
      }
      // @ts-expect-error Property 'get' does not exist on type 'LookupApi
      lookup.get(entityId, Game.Query({ selection: { hp: Game.Query.write(Hp) } }))
    })
  })
})
