import { describe, expect, it } from "vitest"
import { Descriptor, Entity, Schema } from "@typeonce/ritmo"
import { readResourceValue, unknownEntityId } from "./utils/fixtures.ts"

const Name = Descriptor.Component<{ value: string }>()("Name")
const Summary = Descriptor.Resource<string>()("Summary")
const { relation: ChildOf } = Descriptor.Hierarchy("ChildOf", "Children")
const { relation: Targeting } = Descriptor.Relation("Targeting", "TargetedBy")

const Root = Schema.defineRoot("Runtime")
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
}), Root)
const schema = Game.schema

const makeRuntime = () =>
  Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: {
      Summary: ""
    }
  }).value

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
            rootChildren.ok ? queries.hasChildren.data.children.get(rootChildren.value).length : -1,
            childParent.ok ? queries.parents.data.parent.get(childParent.value) : -1,
            descendants.ok ? descendants.value.length : -1,
            target.ok ? target.value : -1,
            ancestors.ok ? ancestors.value.length : -1
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
            if (root.ok) {
              commands.despawn(root.value)
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

          resources.summary.set(`${childRoot.ok ? "ok" : childRoot.error._tag}/${archerTarget.ok ? "ok" : archerTarget.error._tag}`)
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
            .map((entity) => {
              const { data } = queries.optionalTargets
              const target = data.target.get(entity)?.toString() ?? "none"
              const sources = data.sources.get(entity)?.length.toString() ?? "none"
              return `${data.name.get(entity).value}:${target}:${sources}`
            })
            .sort()
            .join("|")

          resources.summary.set([
            betaTarget.ok ? betaTarget.value : -1,
            alphaSources.ok ? alphaSources.value.length : -1,
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

          resources.summary.set(`${target.ok ? target.value : target.error._tag}/${sources.ok ? sources.value.length : -1}`)
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
              children.ok ? children.value.map((child) => String(child)).join(",") : children.error._tag,
              descendants.ok ? descendants.value.map((child) => String(child)).join(",") : descendants.error._tag,
              fromQuery.ok ? queries.hasChildren.data.children.get(fromQuery.value).map((child) => String(child)).join(",") : fromQuery.error._tag
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
            unknownEntityId<typeof schema, typeof Root>(999),
            ChildOf
          )

          resources.summary.set([
            children.ok
              ? children.value.map((entity) => queries.named.data.name.get(entity).value).join(",")
              : children.error._tag,
            descendants.ok
              ? descendants.value.map((entity) => queries.named.data.name.get(entity).value).join(",")
              : descendants.error._tag,
            missing.ok ? "ok" : missing.error._tag
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
          resources.summary.set(`${target.ok ? "ok" : target.error._tag}/${relationFailures.targeting.all().length}`)
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
            target.ok ? String(target.value) : target.error._tag,
            sources.ok ? sources.value.map((source) => String(source)).join(",") : sources.error._tag,
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
          commands.unrelate(unknownEntityId<typeof schema, typeof Root>(999), Targeting)
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
            target.ok ? "ok" : target.error._tag,
            sources.ok ? sources.value.length : 0,
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
          commands.relate(alphaId, Targeting, unknownEntityId<typeof schema, typeof Root>(999))
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
          const betaParent = lookup.related(betaId, ChildOf)

          resources.summary.set([
            targetingFailures.map((failure) => failure.error._tag).join(","),
            hierarchyFailures.map((failure) => failure.error._tag).join(","),
            alphaTarget.ok ? "ok" : alphaTarget.error._tag,
            betaParent.ok ? "ok" : betaParent.error._tag
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
          commands.reorderChildren(unknownEntityId<typeof schema, typeof Root>(999), ChildOf, [firstId, secondId])
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
            children.ok ? children.value.map((child) => String(child)).join(",") : children.error._tag
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

  it("lists a child once when it is related to its parent again, and last when it comes back from another", () => {
    let firstId: Entity.EntityId<typeof schema, any> | undefined
    let secondId: Entity.EntityId<typeof schema, any> | undefined
    let aId: Entity.EntityId<typeof schema, any> | undefined
    let bId: Entity.EntityId<typeof schema, any> | undefined
    let step: "spawn" | "again" | "away" | "back" = "spawn"
    const act = Game.System(
      "RelateAgain/Act",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf)) },
      ({ commands }) => {
        if (step === "spawn") {
          firstId = commands.spawn(Game.Command.spawn([Name, { value: "first" }] as const))
          secondId = commands.spawn(Game.Command.spawn([Name, { value: "second" }] as const))
          aId = commands.spawn(Game.Command.relate(Game.Command.spawn([Name, { value: "a" }] as const), ChildOf, firstId))
          bId = commands.spawn(Game.Command.relate(Game.Command.spawn([Name, { value: "b" }] as const), ChildOf, firstId))
        }
        if (step === "again") commands.relate(aId!, ChildOf, firstId!)
        if (step === "away") commands.relate(aId!, ChildOf, secondId!)
        if (step === "back") commands.relate(aId!, ChildOf, firstId!)
      }
    )
    let children = ""
    const observe = Game.System("RelateAgain/Observe", {}, ({ lookup }) => {
      const name = (id: number) => (id === aId ? "a" : id === bId ? "b" : "?")
      const of = (parent: Entity.EntityId<typeof schema, any>) => {
        const sources = lookup.relatedSources(parent, ChildOf)
        return sources.ok ? sources.value.map(name).join(",") : sources.error._tag
      }
      children = `${of(firstId!)}/${of(secondId!)}`
    })
    const runtime = makeRuntime()
    const schedule = Game.Schedule(act, Game.Schedule.applyDeferred(), observe)
    const after = (next: typeof step) => {
      step = next
      runtime.tick(schedule)
      return children
    }
    expect(after("spawn")).toBe("a,b/")
    expect(after("again")).toBe("a,b/")
    expect(after("away")).toBe("b/a")
    expect(after("back")).toBe("b,a/")
  })

  it("puts a despawned parent's children and a despawned target's sources back in their order when the tick is rewound", () => {
    let parentId: Entity.EntityId<typeof schema, any> | undefined
    let targetId: Entity.EntityId<typeof schema, any> | undefined
    const childIds: Array<number> = []
    const watcherIds: Array<number> = []
    let step: "spawn" | "despawn" | "watch" = "spawn"
    const act = Game.System(
      "RewoundDespawn/Act",
      {
        queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) },
        commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf), Game.System.relates(Targeting), Game.System.despawns(Name))
      },
      ({ queries, commands }) => {
        if (step === "spawn") {
          parentId = commands.spawn(Game.Command.spawn([Name, { value: "parent" }] as const))
          targetId = commands.spawn(Game.Command.spawn([Name, { value: "target" }] as const))
          for (let index = 0; index < 3; index++) {
            childIds.push(commands.spawn(Game.Command.relate(Game.Command.spawn([Name, { value: "child" }] as const), ChildOf, parentId)))
            watcherIds.push(commands.spawn(Game.Command.relate(Game.Command.spawn([Name, { value: "watcher" }] as const), Targeting, targetId)))
          }
        }
        if (step === "despawn") {
          for (const id of [parentId!, targetId!]) {
            const entity = queries.named.get(id)
            if (entity.ok) commands.despawn(entity.value)
          }
        }
      }
    )
    let seen = { children: "", watchers: "", alive: 0 }
    const observe = Game.System(
      "RewoundDespawn/Observe",
      { queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) } },
      ({ queries, lookup }) => {
        const children = lookup.relatedSources(parentId!, ChildOf)
        const watchers = lookup.relatedSources(targetId!, Targeting)
        seen = {
          children: children.ok ? children.value.join(",") : children.error._tag,
          watchers: watchers.ok ? watchers.value.join(",") : watchers.error._tag,
          alive: queries.named.each().length
        }
      }
    )
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Summary: "" }, checkpoints: 4 }).value
    const schedule = Game.Schedule(act, Game.Schedule.applyDeferred(), observe)
    runtime.tick(schedule)
    const whole = { children: childIds.join(","), watchers: watcherIds.join(","), alive: 8 }
    expect(seen).toEqual(whole)

    // The parent takes its children with it; the target's watchers stay, pointing at nothing.
    step = "despawn"
    const checkpoint = runtime.checkpoint(schedule)
    runtime.tick(schedule)
    expect(seen.alive).toBe(3)

    expect(runtime.rewind(checkpoint).ok).toBe(true)
    step = "watch"
    runtime.tick(schedule)
    expect(seen).toEqual(whole)
  })

  it("lists the descendants of a parent with 200,000 children in breadth order, and despawns them with it", () => {
    let rootId: Entity.EntityId<typeof schema, any> | undefined
    const spawn = Game.System(
      "WideHierarchy/Spawn",
      { commands: Game.System.commands(Game.System.spawns(Name), Game.System.relates(ChildOf)) },
      ({ commands }) => {
        rootId = commands.spawn(Game.Command.spawn([Name, { value: "root" }] as const))
        const parent = commands.spawn(Game.Command.relate(Game.Command.spawn([Name, { value: "parent" }] as const), ChildOf, rootId))
        for (let index = 0; index < 200_000; index++) {
          commands.spawn(Game.Command.relate(Game.Command.spawn([Name, { value: "child" }] as const), ChildOf, parent))
        }
      }
    )
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))
    let counted: Array<number | string> = []
    const count = Game.System("WideHierarchy/Count", {}, ({ lookup }) => {
      const breadth = lookup.descendants(rootId!, ChildOf, { order: "breadth" })
      const depth = lookup.descendants(rootId!, ChildOf)
      counted = [breadth.ok ? breadth.value.length : breadth.error._tag, depth.ok ? depth.value.length : depth.error._tag]
    })
    runtime.tick(Game.Schedule(count))
    expect(counted).toEqual([200_001, 200_001])

    // The root takes every descendant with it. Relating the children and letting them go both take time that
    // grows with their number: when each searched its parent's list, this test ran for minutes.
    let left = -1
    const despawn = Game.System(
      "WideHierarchy/Despawn",
      { queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) }, commands: Game.System.commands(Game.System.despawns(Name)) },
      ({ queries, commands }) => {
        const root = queries.named.get(rootId!)
        if (root.ok) commands.despawn(root.value)
      }
    )
    const remaining = Game.System(
      "WideHierarchy/Remaining",
      { queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) } },
      ({ queries }) => {
        left = queries.named.each().length
      }
    )
    runtime.tick(Game.Schedule(despawn, Game.Schedule.applyDeferred(), remaining))
    expect(left).toBe(0)
  }, 30_000)
})
