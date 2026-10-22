import { describe, expect, it } from "vitest"
import { Descriptor, Entity, Schema } from "@typeonce/ritmo"
import { readResourceValue } from "./utils/fixtures.ts"

const Name = Descriptor.Component<{ value: string }>()("Name")
const Summary = Descriptor.Resource<string>()("Summary")
const { relation: ChildOf } = Descriptor.Hierarchy("ChildOf", "Children")
const { relation: Targeting } = Descriptor.Relation("Targeting", "TargetedBy")

const Game = Schema.bind(Schema.fragment({
  components: {
    Name
  },
  resources: {
    Summary
  },
  relations: {
    ChildOf,
    Targeting
  }
}))
const schema = Game.schema

const makeRuntime = () =>
  Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: {
      Summary: ""
    }
  }).success

describe("Runtime relationships", () => {
  it("supports relation-aware queries and hierarchy traversal", () => {
    let rootId: Entity.EntityId<typeof schema, any> | undefined
    let childId: Entity.EntityId<typeof schema, any> | undefined
    let archerId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnRelations",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf, Targeting)) },
      ({ commands }) =>
        {
          rootId = commands.spawn(Game.Command.spawn([Name, { value: "root" }] as const))
          childId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "child" }] as const),
              ChildOf,
              rootId
            )
          )
          commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "grandchild" }] as const),
              ChildOf,
              childId
            )
          )
          archerId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "archer" }] as const),
              Targeting,
              rootId
            )
          )
        }
    )

    const observe = Game.System(
      "ObserveRelations",
      {
        queries: {
          parents: Game.Query({
            selection: {
              parent: Game.Query.readRelation(ChildOf)
            },
            withRelations: [ChildOf]
          }),
          hasChildren: Game.Query({
            selection: {
              children: Game.Query.readRelated(ChildOf)
            },
            withRelated: [ChildOf]
          })
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ queries, lookup, resources }) =>
        {
          if (!rootId || !childId || !archerId) {
            resources.summary.set("missing-setup")
            return
          }

          const rootChildren = queries.hasChildren.get(rootId)
          const childParent = queries.parents.get(childId)
          const descendants = lookup.descendants(rootId, ChildOf, { order: "breadth" })
          const target = lookup.related(archerId, Targeting)
          const ancestors = lookup.ancestors(childId, ChildOf)

          resources.summary.set([
            rootChildren._tag === "Success" ? rootChildren.success.data.children.get().length : -1,
            childParent._tag === "Success" ? childParent.success.data.parent.get() : -1,
            descendants._tag === "Success" ? descendants.success.length : -1,
            target._tag === "Success" ? target.success : -1,
            ancestors._tag === "Success" ? ancestors.success.length : -1
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe("1/1/2/1/1")
  })

  it("recursively despawns hierarchy descendants and clears non-hierarchy incoming edges", () => {
    let rootId: Entity.EntityId<typeof schema, any> | undefined
    let childId: Entity.EntityId<typeof schema, any> | undefined
    let archerId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnHierarchyForDespawn",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf, Targeting)) },
      ({ commands }) =>
        {
          rootId = commands.spawn(Game.Command.spawn([Name, { value: "root" }] as const))
          childId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "child" }] as const),
              ChildOf,
              rootId
            )
          )
          archerId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "archer" }] as const),
              Targeting,
              rootId
            )
          )
        }
    )

    const destroy = Game.System(
      "DestroyRoot",
      {
        queries: {
          named: Game.Query({
            selection: {
              name: Game.Query.read(Name)
            }
          })
        },
        commands: Game.System.commands(Game.System.despawns(Name))
      },
      ({ queries, commands }) =>
        {
          if (rootId) {
            const root = queries.named.get(rootId)
            if (root._tag === "Success") {
              commands.despawn(root.success.entity)
            }
          }
        }
    )

    const observe = Game.System(
      "ObserveDespawn",
      {
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ lookup, resources }) =>
        {
          if (!rootId || !childId || !archerId) {
            resources.summary.set("missing-setup")
            return
          }

          const childRoot = lookup.root(childId, ChildOf)
          const archerTarget = lookup.related(archerId, Targeting)

          resources.summary.set(`${childRoot._tag === "Success" ? "ok" : childRoot.failure._tag}/${archerTarget._tag === "Success" ? "ok" : archerTarget.failure._tag}`)
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(destroy, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe("MissingEntity/MissingRelation")
  })

  it("allows general relation cycles and keeps optional relation slots non-matching-safe", () => {
    let alphaId: Entity.EntityId<typeof schema, any> | undefined
    let betaId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnGeneralCycle",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(Targeting)) },
      ({ commands }) =>
        {
          alphaId = commands.spawn(Game.Command.spawn([Name, { value: "alpha" }] as const))
          betaId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "beta" }] as const),
              Targeting,
              alphaId
            )
          )
          commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "gamma" }] as const),
              Targeting,
              betaId
            )
          )
        }
    )

    const observe = Game.System(
      "ObserveOptionalRelations",
      {
        queries: {
          optionalTargets: Game.Query({
            selection: {
              name: Game.Query.read(Name),
              target: Game.Query.optionalRelation(Targeting),
              sources: Game.Query.optionalRelated(Targeting)
            }
          })
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ queries, lookup, resources }) =>
        {
          if (!alphaId || !betaId) {
            resources.summary.set("missing-setup")
            return
          }

          const betaTarget = lookup.related(betaId, Targeting)
          const alphaSources = lookup.relatedSources(alphaId, Targeting)

          const optionalSummary = queries.optionalTargets.each()
            .map((match) => {
              const target = match.data.target.present
                ? match.data.target.get().toString()
                : "none"
              const sources = match.data.sources.present
                ? match.data.sources.get().length.toString()
                : "none"
              return `${match.data.name.get().value}:${target}:${sources}`
            })
            .sort()
            .join("|")

          resources.summary.set([
            betaTarget._tag === "Success" ? betaTarget.success : -1,
            alphaSources._tag === "Success" ? alphaSources.success.length : -1,
            optionalSummary
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe(
      "1/1/alpha:none:1|beta:1:1|gamma:2:none"
    )
  })

  it("supports live relate and unrelate commands after explicit deferred application", () => {
    let alphaId: Entity.EntityId<typeof schema, any> | undefined
    let betaId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnLiveRelationEntities",
      { commands: Game.System.commands(Game.System.spawns(Name)) },
      ({ commands }) =>
        {
          alphaId = commands.spawn(Game.Command.spawn([Name, { value: "alpha" }] as const))
          betaId = commands.spawn(Game.Command.spawn([Name, { value: "beta" }] as const))
        }
    )

    const relate = Game.System(
      "RelateLiveEntities",
      { commands: Game.System.commands(Game.System.relates(Targeting)) },
      ({ commands }) =>
        {
          if (alphaId && betaId) {
            commands.relate(alphaId, Targeting, betaId)
          }
        }
    )

    const unrelate = Game.System(
      "UnrelateLiveEntities",
      { commands: Game.System.commands(Game.System.relates(Targeting)) },
      ({ commands }) =>
        {
          if (alphaId) {
            commands.unrelate(alphaId, Targeting)
          }
        }
    )

    const observe = Game.System(
      "ObserveLiveRelationMutation",
      {
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ lookup, resources }) =>
        {
          if (!alphaId || !betaId) {
            resources.summary.set("missing-setup")
            return
          }

          const target = lookup.related(alphaId, Targeting)
          const sources = lookup.relatedSources(betaId, Targeting)

          resources.summary.set(`${target._tag === "Success" ? target.success : target.failure._tag}/${sources._tag === "Success" ? sources.success.length : -1}`)
        }
    )

    const runtime = makeRuntime()
    const spawnSchedule = Game.Schedule(spawn, Game.Schedule.applyDeferred())
    const relateSchedule = Game.Schedule(relate, Game.Schedule.applyDeferred(), observe)
    const unrelateSchedule = Game.Schedule(unrelate, Game.Schedule.applyDeferred(), observe)
    runtime.tick(spawnSchedule, relateSchedule, unrelateSchedule)

    expect(readResourceValue(runtime, schema, Summary)).toBe("MissingRelation/0")
  })

  it("reorders hierarchy children through deferred commands", () => {
    let rootId: Entity.EntityId<typeof schema, any> | undefined
    let firstId: Entity.EntityId<typeof schema, any> | undefined
    let secondId: Entity.EntityId<typeof schema, any> | undefined
    let thirdId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnHierarchyForReorder",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf)) },
      ({ commands }) =>
        {
          rootId = commands.spawn(Game.Command.spawn([Name, { value: "root" }] as const))
          firstId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "first" }] as const),
              ChildOf,
              rootId
            )
          )
          secondId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "second" }] as const),
              ChildOf,
              rootId
            )
          )
          thirdId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "third" }] as const),
              ChildOf,
              rootId
            )
          )
        }
    )

    const reorder = Game.System(
      "ReorderHierarchyChildren",
      { commands: Game.System.commands(Game.System.relates(ChildOf)) },
      ({ commands }) =>
        {
          if (!rootId || !firstId || !secondId || !thirdId) {
            return
          }
          commands.reorderChildren(rootId, ChildOf, [thirdId, firstId, secondId])
        }
    )

    const observe = Game.System(
      "ObserveHierarchyReorder",
      {
        queries: {
          hasChildren: Game.Query({
            selection: {
              children: Game.Query.readRelated(ChildOf)
            },
            withRelated: [ChildOf]
          })
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ queries, lookup, resources }) =>
        {
          if (!rootId) {
            resources.summary.set("missing-setup")
            return
          }
          const children = lookup.relatedSources(rootId, ChildOf)
          const descendants = lookup.descendants(rootId, ChildOf, { order: "breadth" })
          const fromQuery = queries.hasChildren.get(rootId)
          resources.summary.set(
            [
              children._tag === "Success" ? children.success.map((child) => String(child)).join(",") : children.failure._tag,
              descendants._tag === "Success" ? descendants.success.map((child) => String(child)).join(",") : descendants.failure._tag,
              fromQuery._tag === "Success" ? fromQuery.success.data.children.get().map((child) => String(child)).join(",") : fromQuery.failure._tag
            ].join("/")
          )
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(reorder, Game.Schedule.applyDeferred(), observe)
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe("4,2,3/4,2,3/4,2,3")
  })

  it("returns ordered typed hierarchy matches while skipping non-matching entities", () => {
    let rootId: Entity.EntityId<typeof schema, any> | undefined
    let branchId: Entity.EntityId<typeof schema, any> | undefined

    const NamedQuery = Game.Query({
      selection: {
        name: Game.Query.read(Name)
      }
    })

    const spawn = Game.System(
      "SpawnHierarchyMatchTraversal",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf)) },
      ({ commands }) =>
        {
          rootId = commands.spawn(Game.Command.spawn([Name, { value: "root" }] as const))
          commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "first" }] as const),
              ChildOf,
              rootId
            )
          )
          branchId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn(),
              ChildOf,
              rootId
            )
          )
          commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "nested" }] as const),
              ChildOf,
              branchId
            )
          )
        }
    )

    const observe = Game.System(
      "ObserveHierarchyMatchTraversal",
      {
        queries: {
          named: NamedQuery
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ queries, resources }) =>
        {
          if (!rootId) {
            resources.summary.set("missing-setup")
            return
          }

          const children = queries.named.children(rootId, ChildOf)
          const descendants = queries.named.descendants(rootId, ChildOf, { order: "breadth" })
          const missing = queries.named.descendants(
            Entity.makeEntityId<typeof schema, typeof Game.schema>(999),
            ChildOf
          )

          resources.summary.set([
            children._tag === "Success"
              ? children.success.map((match) => match.data.name.get().value).join(",")
              : children.failure._tag,
            descendants._tag === "Success"
              ? descendants.success.map((match) => match.data.name.get().value).join(",")
              : descendants.failure._tag,
            missing._tag === "Success" ? "ok" : missing.failure._tag
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(observe)
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe("first/first,nested/MissingEntity")
  })

  it("makes successful deferred relation mutations visible through lookup and keeps failure streams empty", () => {
    let alphaId: Entity.EntityId<typeof schema, any> | undefined
    let betaId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnSuccessfulRelationMutation",
      { commands: Game.System.commands(Game.System.spawns(Name)) },
      ({ commands }) =>
        {
          alphaId = commands.spawn(Game.Command.spawn([Name, { value: "alpha" }] as const))
          betaId = commands.spawn(Game.Command.spawn([Name, { value: "beta" }] as const))
        }
    )

    const relate = Game.System(
      "QueueSuccessfulRelationMutation",
      { commands: Game.System.commands(Game.System.relates(Targeting)) },
      ({ commands }) =>
        {
          if (!alphaId || !betaId) {
            return
          }
          commands.relate(alphaId, Targeting, betaId)
        }
    )

    const observeBefore = Game.System(
      "ObserveSuccessfulRelationMutationBeforeFlush",
      {
        relationFailures: {
          targeting: Game.System.readRelationFailures(Targeting)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, lookup, resources }) =>
        {
          if (!alphaId) {
            resources.summary.set("missing-setup")
            return
          }
          const target = lookup.related(alphaId, Targeting)
          resources.summary.set(`${target._tag === "Success" ? "ok" : target.failure._tag}/${relationFailures.targeting.all().length}`)
        }
    )

    const observeAfter = Game.System(
      "ObserveSuccessfulRelationMutationAfterFlush",
      {
        relationFailures: {
          targeting: Game.System.readRelationFailures(Targeting)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, lookup, resources }) =>
        {
          if (!alphaId || !betaId) {
            resources.summary.set("missing-setup")
            return
          }
          const target = lookup.related(alphaId, Targeting)
          const sources = lookup.relatedSources(betaId, Targeting)
          resources.summary.set([
            target._tag === "Success" ? String(target.success) : target.failure._tag,
            sources._tag === "Success" ? sources.success.map((source) => String(source)).join(",") : sources.failure._tag,
            relationFailures.targeting.all().length
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(
        relate,
        observeBefore,
        Game.Schedule.applyDeferred(),
        observeAfter
      )
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe("2/1/0")
  })

  it("keeps unrelate total and benign when repeated or when no edge exists", () => {
    let alphaId: Entity.EntityId<typeof schema, any> | undefined
    let betaId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnForRepeatedUnrelate",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(Targeting)) },
      ({ commands }) =>
        {
          betaId = commands.spawn(Game.Command.spawn([Name, { value: "beta" }] as const))
          alphaId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "alpha" }] as const),
              Targeting,
              betaId
            )
          )
        }
    )

    const clear = Game.System(
      "RepeatedUnrelate",
      { commands: Game.System.commands(Game.System.relates(Targeting)) },
      ({ commands }) =>
        {
          if (!alphaId) {
            return
          }
          commands.unrelate(alphaId, Targeting)
          commands.unrelate(alphaId, Targeting)
          commands.unrelate(Entity.makeEntityId<typeof schema, typeof Game.schema>(999), Targeting)
        }
    )

    const observe = Game.System(
      "ObserveRepeatedUnrelate",
      {
        relationFailures: {
          targeting: Game.System.readRelationFailures(Targeting)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, lookup, resources }) =>
        {
          if (!alphaId || !betaId) {
            resources.summary.set("missing-setup")
            return
          }
          const target = lookup.related(alphaId, Targeting)
          const sources = lookup.relatedSources(betaId, Targeting)
          resources.summary.set([
            target._tag === "Success" ? "ok" : target.failure._tag,
            sources._tag === "Success" ? sources.success.length : 0,
            relationFailures.targeting.all().length
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(clear, Game.Schedule.applyDeferred(), observe)
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe("MissingRelation/0/0")
  })

  it("surfaces failed deferred relation mutations to readers after applyDeferred and leaves world state unchanged", () => {
    let alphaId: Entity.EntityId<typeof schema, any> | undefined
    let betaId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnFailureEntities",
      { commands: Game.System.commands(Game.System.spawns(Name)) },
      ({ commands }) =>
        {
          alphaId = commands.spawn(Game.Command.spawn([Name, { value: "alpha" }] as const))
          betaId = commands.spawn(Game.Command.spawn([Name, { value: "beta" }] as const))
        }
    )

    const queueInvalid = Game.System(
      "QueueInvalidRelations",
      { commands: Game.System.commands(Game.System.relates(Targeting, ChildOf)) },
      ({ commands }) =>
        {
          if (!alphaId || !betaId) {
            return
          }
          commands.relate(alphaId, Targeting, Entity.makeEntityId<typeof schema, typeof Game.schema>(999))
          commands.relate(alphaId, ChildOf, betaId)
          commands.relate(betaId, ChildOf, alphaId)
        }
    )

    const readBefore = Game.System(
      "ReadRelationFailuresBeforeFlush",
      {
        relationFailures: {
          targeting: Game.System.readRelationFailures(Targeting),
          childOf: Game.System.readRelationFailures(ChildOf)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, resources }) =>
        {
          resources.summary.set(`${relationFailures.targeting.all().length}/${relationFailures.childOf.all().length}`)
        }
    )

    const readAfter = Game.System(
      "ReadRelationFailuresAfterFlush",
      {
        relationFailures: {
          targeting: Game.System.readRelationFailures(Targeting),
          childOf: Game.System.readRelationFailures(ChildOf)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, lookup, resources }) =>
        {
          if (!alphaId || !betaId) {
            resources.summary.set("missing-setup")
            return
          }

          const targetingFailures = relationFailures.targeting.all()
          const hierarchyFailures = relationFailures.childOf.all()
          const alphaTarget = lookup.related(alphaId, Targeting)
          const betaParent = lookup.parent(betaId, ChildOf)

          resources.summary.set([
            targetingFailures.map((failure) => failure.error._tag).join(","),
            hierarchyFailures.map((failure) => failure.error._tag).join(","),
            alphaTarget._tag === "Success" ? "ok" : alphaTarget.failure._tag,
            betaParent._tag === "Success" ? "ok" : betaParent.failure._tag
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    const spawnSchedule = Game.Schedule(spawn, Game.Schedule.applyDeferred())
    const failureSchedule = Game.Schedule(
      queueInvalid,
      Game.Schedule.applyDeferred(),
      readBefore,
      readAfter
    )
    runtime.tick(spawnSchedule, failureSchedule)

    expect(readResourceValue(runtime, schema, Summary)).toBe(
      "MissingTargetEntity/HierarchyCycle/MissingRelation/MissingRelation"
    )
  })

  it("surfaces failed hierarchy reorders to readers after applyDeferred and keeps child order unchanged", () => {
    let rootId: Entity.EntityId<typeof schema, any> | undefined
    let firstId: Entity.EntityId<typeof schema, any> | undefined
    let secondId: Entity.EntityId<typeof schema, any> | undefined
    let unrelatedId: Entity.EntityId<typeof schema, any> | undefined

    const spawn = Game.System(
      "SpawnHierarchyForReorderFailure",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf)) },
      ({ commands }) =>
        {
          rootId = commands.spawn(Game.Command.spawn([Name, { value: "root" }] as const))
          firstId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "first" }] as const),
              ChildOf,
              rootId
            )
          )
          secondId = commands.spawn(
            Game.Command.relate(
              Game.Command.spawn([Name, { value: "second" }] as const),
              ChildOf,
              rootId
            )
          )
          unrelatedId = commands.spawn(Game.Command.spawn([Name, { value: "free" }] as const))
        }
    )

    const queueInvalid = Game.System(
      "QueueInvalidReorders",
      { commands: Game.System.commands(Game.System.relates(ChildOf)) },
      ({ commands }) =>
        {
          if (!rootId || !firstId || !secondId || !unrelatedId) {
            return
          }
          commands.reorderChildren(rootId, ChildOf, [secondId, secondId])
          commands.reorderChildren(rootId, ChildOf, [firstId])
          commands.reorderChildren(rootId, ChildOf, [firstId, unrelatedId])
          commands.reorderChildren(Entity.makeEntityId<typeof schema, typeof Game.schema>(999), ChildOf, [firstId, secondId])
        }
    )

    const readBefore = Game.System(
      "ReadReorderFailuresBeforeFlush",
      {
        relationFailures: {
          childOf: Game.System.readRelationFailures(ChildOf)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, resources }) =>
        {
          resources.summary.set(String(relationFailures.childOf.all().length))
        }
    )

    const readAfter = Game.System(
      "ReadReorderFailuresAfterFlush",
      {
        relationFailures: {
          childOf: Game.System.readRelationFailures(ChildOf)
        },
        resources: {
          summary: Game.System.writeResource(Summary)
        }
      },
      ({ relationFailures, lookup, resources }) =>
        {
          if (!rootId) {
            resources.summary.set("missing-setup")
            return
          }
          const failures = relationFailures.childOf.all()
          const children = lookup.relatedSources(rootId, ChildOf)
          resources.summary.set([
            failures.map((failure) => `${failure.operation}:${failure.error._tag}`).join(","),
            children._tag === "Success" ? children.success.map((child) => String(child)).join(",") : children.failure._tag
          ].join("/"))
        }
    )

    const runtime = makeRuntime()
    runtime.tick(
      Game.Schedule(spawn, Game.Schedule.applyDeferred()),
      Game.Schedule(
        queueInvalid,
        Game.Schedule.applyDeferred(),
        readBefore,
        readAfter
      )
    )

    expect(readResourceValue(runtime, schema, Summary)).toBe(
      "reorderChildren:DuplicateChild,reorderChildren:ChildSetMismatch,reorderChildren:ChildNotRelatedToParent,reorderChildren:MissingEntity/2,3"
    )
  })
})
