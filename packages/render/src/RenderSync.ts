/**
 * A system that mirrors ECS entities into renderer nodes.
 *
 * Every renderer integration does the same bookkeeping: keep one node for
 * every entity that has the renderable, the transform, and every required
 * `select` slot; re-apply it when its transform changes; destroy it when the
 * entity loses any of them or despawns. A node appears whichever of those
 * components arrives last, and goes as soon as one leaves. `RenderSync.system(...)` builds one system that does all three,
 * in a safe order (destroy, create, update), for one bound `Game`. What a
 * node looks like and how state is applied stay caller-defined. The registry
 * belongs to the system: when removals were dropped before it read them
 * (`lagged()`, after it did not run for long), it destroys every node whose
 * entity no longer matches, so give each `RenderSync.system` its own registry.
 *
 * Change detection is per system, so the system sees every addition, change,
 * and removal exactly once, wherever it sits in the schedule, and applies each
 * node at most once per run: a node created in a run is not applied again for
 * the same changes. `redrawOn` lists more components whose changes re-run
 * `apply`, for node state beyond the transform (animation frames, tints,
 * interpolation). Place the system after the `applyDeferred()` that commits
 * spawns to render new entities in the same tick.
 *
 * `create` and `apply` receive one context: the renderable and transform
 * values, the entity id, extra read-only slots declared in `select` (as query
 * cells in `data`), resources declared in `resources` (as read cells), and extra
 * services declared in `services`. Those resources and services become
 * runtime requirements like the registry itself.
 *
 * With `hierarchy` (a `Descriptor.Hierarchy` of the game), a child's node is
 * attached under its parent's node instead of the root, and moved whenever
 * its parent changes, so the renderer composes the transforms: `apply` sets
 * the child's own (local) transform, relative to the parent's node, and no
 * world-transform math happens in the system.
 *
 * Its spec is erased, so it does not count as a writer for
 * `Game.System.thisTick(...)` order checks.
 *
 * @module RenderSync
 * @docGroup render
 *
 * @example
 * ```ts
 * const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
 *
 * const Render = RenderSync.system(Game, {
 *   name: "Game/Render",
 *   renderable: Renderable,
 *   transform: Position,
 *   registry: Sprites,
 *   services: { assets: Assets },
 *   create: ({ renderable, services }) => new Sprite(services.assets.textures[renderable.texture]),
 *   apply: (sprite, { transform }) => sprite.position.set(transform.x, transform.y)
 * })
 *
 * const update = Game.Schedule(Gameplay, Game.Schedule.applyDeferred(), Render)
 * ```
 */
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import type { Condition, ConditionNeedsFromConditions } from "@typeonce/ritmo/Machine"
import type * as Entity from "@typeonce/ritmo/Entity"
import type { Relation } from "@typeonce/ritmo/Relation"
import type { OptionalReadAccess, OptionalReadCell, ReadAccess, ReadCell, ReadonlyValue } from "@typeonce/ritmo/Query"
import type { Schema } from "@typeonce/ritmo/Schema"
import type { NodeRegistry } from "./NodeRegistry.ts"

type RegistryService = Descriptor<"service", string, NodeRegistry<any>>
type ServiceDescriptor = Descriptor<"service", string, any>
type ResourceDescriptor = Descriptor<"resource", string, any>

/**
 * The `hierarchy` option: a `Descriptor.Hierarchy` relation of the game's
 * schema, or a message naming the fix for anything else.
 */
export type HierarchyOption<S extends Schema.Any, H> =
  [H] extends [undefined] ? H
  : [H] extends [Schema.RelationDescriptor<S>]
    ? [H] extends [Relation.Hierarchy]
      ? H
      : "hierarchy must be a Descriptor.Hierarchy relation: a Descriptor.Relation does not make a parent's node hold its children"
    : "hierarchy must be a relation of the game's schema: add it to Schema.fragment({ relations })"

/**
 * The node type held by a registry service.
 */
export type NodeOf<R extends RegistryService> =
  R extends Descriptor<"service", string, NodeRegistry<infer Node>> ? Node : never

/**
 * Extra read-only slots available to `create` and `apply`.
 */
export type Selection<S extends Schema.Any> = Readonly<Record<
  string,
  ReadAccess<Schema.ComponentDescriptor<S>> | OptionalReadAccess<Schema.ComponentDescriptor<S>>
>>

type SelectionCells<Select> = {
  readonly [K in keyof Select]:
    Select[K] extends ReadAccess<infer D> ? ReadCell<Descriptor.Value<D>>
    : Select[K] extends OptionalReadAccess<infer D> ? OptionalReadCell<Descriptor.Value<D>>
    : never
}

type ResourceCells<Resources> = {
  readonly [K in keyof Resources]: Resources[K] extends ResourceDescriptor ? ReadCell<Descriptor.Value<Resources[K]>> : never
}

type ServiceValues<Services> = {
  readonly [K in keyof Services]: Services[K] extends ServiceDescriptor ? Descriptor.Value<Services[K]> : never
}

/** The transform value a callback sees: `undefined` when no transform is configured. */
export type TransformValue<Transform> =
  Transform extends Descriptor<"component", string, any> ? ReadonlyValue<Descriptor.Value<Transform>> : undefined

/**
 * What `create` and `apply` see for one entity.
 */
export interface NodeContext<
  S extends Schema.Any,
  Root,
  Renderable extends Schema.ComponentDescriptor<S>,
  Transform extends Schema.ComponentDescriptor<S> | undefined,
  Select,
  Services,
  Resources = {}
> {
  readonly entity: Entity.EntityId<S, Root>
  readonly renderable: ReadonlyValue<Descriptor.Value<Renderable>>
  readonly transform: TransformValue<Transform>
  readonly data: SelectionCells<Select>
  readonly resources: ResourceCells<Resources>
  readonly services: ServiceValues<Services>
}

/** The options of `system`. */
export interface Options<
  S extends Schema.Any,
  Root,
  Renderable extends Schema.ComponentDescriptor<S>,
  Transform extends Schema.ComponentDescriptor<S> | undefined,
  Registry extends RegistryService,
  Select extends Selection<S>,
  Services extends Readonly<Record<string, ServiceDescriptor>>,
  Resources extends Readonly<Record<string, Schema.ResourceDescriptor<S>>> = {},
  When extends ReadonlyArray<Condition> = readonly [],
  Hierarchy extends Relation.Any | undefined = undefined
> {
  /** The system name. */
  readonly name: string
  /** The component whose presence means "this entity has a node". */
  readonly renderable: Renderable
  /**
   * The component applied to the node on creation and whenever it changes.
   * Omit it when nodes are placed some other way every frame (for example
   * by `interpolate`); `apply` then runs on creation and on `redrawOn`
   * changes only.
   */
  readonly transform?: Transform
  /** The service providing the node registry. */
  readonly registry: Registry
  /** Extra read-only query slots passed to the callbacks as `data`. */
  readonly select?: Select
  /** Extra services passed to the callbacks as `services`. */
  readonly services?: Services
  /** Resources passed to the callbacks as read-only cells in `resources`. */
  readonly resources?: Resources
  /**
   * More components whose changes re-run `apply`, for node state other than
   * the transform: animation frames, tints, interpolation. `apply` then runs
   * once per changed entity per sync, however many of these changed, so it
   * should set the node's state rather than increment it.
   */
  readonly redrawOn?: ReadonlyArray<Schema.ComponentDescriptor<S>>
  /**
   * Run conditions, like a system's `when`. While they fail, nothing is
   * created, updated, or destroyed; additions, changes, and removals are
   * seen when the system runs again.
   */
  readonly when?: When
  /**
   * A `Descriptor.Hierarchy` of the game whose tree the nodes follow: a
   * child's node is attached under its parent's node (`attach(node, parent)`)
   * when the parent has a node in this registry, and at the root otherwise,
   * and is moved when the parent changes, is removed, or gains or loses its
   * node. Only the direct parent counts: a child of a parent without a node
   * sits at the root, not under a grandparent. `apply` then receives the
   * child's own components, which the renderer composes with its parent's
   * node: a child's transform is local to its parent. Despawning a parent
   * despawns its children (hierarchies despawn together), so their nodes go
   * with it; a parent that only loses its node hands its children's nodes
   * back to the root. Each run checks every renderable entity that has a
   * parent, so the cost grows with the number of children, not of changes.
   */
  readonly hierarchy?: HierarchyOption<S, Hierarchy>
  /** Builds the node for a new renderable entity. */
  readonly create: (context: NodeContext<S, Root, Renderable, Transform, Select, Services, Resources>) => NodeOf<Registry>
  /**
   * Applies the current state to the node: on creation, and whenever the
   * transform or a `redrawOn` component changes.
   */
  readonly apply: (node: NodeOf<Registry>, context: NodeContext<S, Root, Renderable, Transform, Select, Services, Resources>) => void
}

/**
 * The generated system. It requires the registry and any extra resources and
 * services.
 */
export type RenderSystem<S extends Schema.Any, Root, Needs extends ServiceDescriptor | ResourceDescriptor | ConditionNeedsFromConditions<ReadonlyArray<Condition>>> =
  Schema.BoundSystem<S, Root, any, never, string, Needs>

/**
 * Builds the render system for one renderable component: it creates,
 * applies, and destroys that component's nodes. To place nodes between fixed
 * steps every frame, add `interpolate` on the same registry after it.
 */
export const system = <
  S extends Schema.Any,
  Root,
  const Renderable extends Schema.ComponentDescriptor<S>,
  const Registry extends RegistryService,
  const Select extends Selection<S> = {},
  const Services extends Readonly<Record<string, ServiceDescriptor>> = {},
  const Resources extends Readonly<Record<string, Schema.ResourceDescriptor<S>>> = {},
  const When extends ReadonlyArray<Condition<Root>> = readonly [],
  const Transform extends Schema.ComponentDescriptor<S> | undefined = undefined,
  const Hierarchy extends Relation.Any | undefined = undefined
>(
  Game: Schema.Game<S, Root>,
  options: Options<S, Root, Renderable, Transform, Registry, Select, Services, Resources, When, Hierarchy>
): RenderSystem<S, Root, Registry | Services[keyof Services] | Resources[keyof Resources] | ConditionNeedsFromConditions<When>> => {
  type Node = NodeOf<Registry>
  type Context = NodeContext<S, Root, Renderable, Transform, Select, Services, Resources>
  // Internally the generic descriptors are erased; the public result type
  // above carries the exact requirements (the registry and extra services).
  const System = Game.System as unknown as (name: string, spec: object, run: (context: any) => void) => unknown
  const Query = Game.Query as unknown as (spec: object) => object
  const anyOf = Game.Query.anyOf as unknown as (...filters: ReadonlyArray<object>) => object
  const transform = options.transform as Schema.ComponentDescriptor<S> | undefined
  const hierarchy = options.hierarchy as Schema.RelationDescriptor<S> | undefined
  const selection = {
    ...options.select,
    __renderable: Game.Query.read(options.renderable),
    ...(transform === undefined ? {} : { __transform: Game.Query.read(transform) }),
    ...(hierarchy === undefined ? {} : { __parent: Game.Query.optionalRelation(hierarchy) })
  }
  const services: Record<string, unknown> = { __registry: Game.System.service(options.registry) }
  for (const [key, descriptor] of Object.entries(options.services ?? {})) {
    services[key] = Game.System.service(descriptor)
  }
  const resources: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(options.resources ?? {})) {
    resources[key] = Game.System.readResource(descriptor as Schema.ResourceDescriptor<S>)
  }

  const contextOf = (
    entity: { readonly id: unknown },
    data: Record<string, any>,
    provided: Record<string, unknown>,
    cells: Record<string, unknown>
  ): Context => ({
    entity: entity.id,
    renderable: data["__renderable"].get(),
    transform: data["__transform"]?.get(),
    data,
    resources: cells,
    services: provided
  }) as unknown as Context

  // The components an entity needs to have a node: the query's required slots.
  const required = [
    options.renderable,
    ...(transform === undefined ? [] : [transform]),
    ...Object.values(options.select ?? {}).flatMap((access) => access.mode === "read" ? [access.descriptor] : [])
  ].filter((descriptor, index, all) => all.indexOf(descriptor) === index)

  // A changed query also sees additions. Reuse it for membership rather
  // than querying a moving transform twice on every frame.
  const triggers = [...new Set([...(transform === undefined ? [] : [transform]), ...(options.redrawOn ?? [])])]
  const additions = required.filter((descriptor) => !triggers.includes(descriptor))
  const queries: Record<string, object> = {}
  const removedReads: Record<string, unknown> = {}
  required.forEach((descriptor, index) => {
    // Despawns are recorded as removals of every component, so these cover them too.
    removedReads[`removed${index}`] = Game.System.readRemoved(descriptor)
  })
  // One query: an entity whose required component was added, or whose
  // trigger changed, is synced once.
  const filters = [
    ...additions.map((descriptor) => Game.Query.added(descriptor)),
    ...triggers.map((trigger) => Game.Query.changed(trigger))
  ]
  // Never empty: `required` always holds the renderable.
  queries["sync"] = Query({ selection, filters: [filters.length === 1 ? filters[0] : anyOf(...filters)] })
  // Every entity that should have a node: read only after removals were lost.
  queries["members"] = Query({
    selection: { __renderable: Game.Query.read(options.renderable) },
    with: required.filter((descriptor) => descriptor !== options.renderable)
  })
  // Every renderable entity with a parent: checked each run against where
  // its node is attached. There is no per-reader filter for relation edges.
  if (hierarchy !== undefined) {
    queries["parented"] = Query({ selection: { __parent: Game.Query.readRelation(hierarchy) }, with: [options.renderable] })
  }

  return System(options.name, {
    queries,
    removed: removedReads,
    resources,
    services,
    when: options.when ?? []
  }, ({ queries, removed, resources, services, lookup }) => {
    const registry = services.__registry as NodeRegistry<Node>
    // Destroy first: an entity that lost a required component has no node,
    // and one that lost it and got it back since the last run gets a fresh one.
    let lagged = false
    for (let index = 0; index < required.length; index++) {
      const stream = removed[`removed${index}`]
      for (const entity of stream.all()) registry.remove(entity)
      if (stream.lagged()) lagged = true
    }
    // Removals were dropped before this system read them (it did not run
    // for longer than the stream keeps them): destroy every node whose
    // entity no longer has one, so none stays on screen.
    if (lagged) {
      const members = new Set<number>()
      for (const { entity } of queries["members"].each()) members.add(entity.id)
      for (const [entity] of [...registry.entries()]) {
        if (!members.has(entity)) registry.remove(entity)
      }
    }

    for (const { entity, data } of queries["sync"].each()) {
      const context = contextOf(entity, data, services, resources)
      // A child met before its parent's node exists starts at the root; the
      // pass below moves it under the parent in this same run.
      const parent: number | undefined = hierarchy === undefined || !data["__parent"].present ? undefined : data["__parent"].get()
      options.apply(registry.ensure(entity.id, () => options.create(context), parent), context)
    }

    if (hierarchy !== undefined) reattach(registry as NodeRegistry<unknown>, queries["parented"], lookup, hierarchy)
  }) as RenderSystem<S, Root, Registry | Services[keyof Services] | Resources[keyof Resources] | ConditionNeedsFromConditions<When>>
}

// Moves every node whose parent changed since it was attached: the entity
// gained, lost, or changed its parent, or the parent gained or lost its node.
// There is no per-reader filter for relation edges, so every parented entity
// is checked each run. Leaving parents go first, then the rest in depth
// order (parents before children), so a node never moves under a node that
// is still inside it and each move happens once.
const reattach = (
  registry: NodeRegistry<unknown>,
  parented: ParentedQuery,
  lookup: HierarchyLookup,
  hierarchy: unknown
): void => {
  let moves: Array<{ readonly entity: number; readonly parent: number | undefined; depth: number }> | undefined
  // Nested nodes whose entity still has a parent; any other nested node lost it.
  let stillParented = 0
  for (const { entity, data } of parented.each()) {
    const attached = registry.parents.get(entity.id)
    if (attached !== undefined) stillParented++
    const parent = data.__parent.get()
    if (attached === parent) continue
    const wanted = registry.get(parent) === undefined ? undefined : parent
    if (attached === wanted || registry.get(entity.id) === undefined) continue
    ;(moves ??= []).push({ entity: entity.id, parent: wanted, depth: 0 })
  }
  if (stillParented < registry.parents.size) {
    const toRoot: Array<number> = []
    for (const [entity] of registry.parents) {
      if (!lookup.parent(entity, hierarchy).ok) toRoot.push(entity)
    }
    for (const entity of toRoot) registry.reparent(entity, undefined)
  }
  if (moves === undefined) return
  if (moves.length > 1) {
    for (const move of moves) {
      const ancestors = lookup.ancestors(move.entity, hierarchy)
      move.depth = ancestors.ok ? ancestors.value.length : 0
    }
    moves.sort((a, b) => a.depth - b.depth)
  }
  for (const move of moves) registry.reparent(move.entity, move.parent)
}

/** A 2D position, the value `interpolate` blends when no `blend` is given. */
export interface Planar {
  readonly x: number
  readonly y: number
}

/**
 * Blends the previous value into the current one at `alpha`, in [0, 1), for
 * values beyond a 2D position (3D positions, angles, scales). Without it,
 * `interpolate` blends `x` and `y` linearly.
 */
export type Blend<From, To, Blended> = (from: From, to: To, alpha: number) => Blended

type ClockService = Descriptor<"service", string, { readonly alpha: number }>

// The numeric fields the default blend would drop (anything beyond x and y).
type Dropped<Value> = { [K in Exclude<keyof Value, "x" | "y">]: Value[K] extends number ? K : never }[Exclude<keyof Value, "x" | "y">]

// Whether the default blend covers a value: `{ x, y }` and no other numbers.
type BlendsByDefault<Value> = Value extends Planar ? [Dropped<Value>] extends [never] ? true : false : false

declare const noBlend: unique symbol
/** Stands for "no `blend` given" until `blend`'s result is inferred. */
export interface NoBlend {
  readonly [noBlend]: true
}

/** What `place` receives: the result of `blend`, or the blended `{ x, y }`. */
export type Placed<Result> = [Result] extends [NoBlend] ? Planar : Result

/**
 * `blend` is optional when both values blend by default (`{ x, y }` and no
 * other numbers), and required otherwise, so nothing (a `z`, an angle) is
 * silently left unblended.
 */
export type BlendOption<From, To, Result> =
  [BlendsByDefault<From>, BlendsByDefault<To>] extends [true, true]
    ? { readonly blend?: Blend<From, To, Result> }
    : { readonly blend: Blend<From, To, Result> }

/**
 * The options of `interpolate`: `blend` is required when the components hold
 * numbers beyond `x` and `y` (see `BlendOption`).
 */
export type InterpolateOptions<
  S extends Schema.Any,
  Root,
  Previous extends Schema.ComponentDescriptor<S>,
  Current extends Schema.ComponentDescriptor<S>,
  Registry extends RegistryService,
  Clock extends ServiceDescriptor,
  When extends ReadonlyArray<Condition> = readonly [],
  Result = NoBlend
> =
  & InterpolateBase<S, Root, Previous, Current, Registry, Clock, When, Result>
  & BlendOption<Descriptor.Value<Previous>, Descriptor.Value<Current>, Result>

interface InterpolateBase<
  S extends Schema.Any,
  Root,
  Previous extends Schema.ComponentDescriptor<S>,
  Current extends Schema.ComponentDescriptor<S>,
  Registry extends RegistryService,
  Clock extends ServiceDescriptor,
  When extends ReadonlyArray<Condition>,
  Result
> {
  /** The system name. */
  readonly name: string
  /** The service providing the node registry (the same one `system` fills). */
  readonly registry: Registry
  /** The value at the start of the latest fixed step. */
  readonly previous: Previous
  /** The value after the latest fixed step. */
  readonly current: Current
  /**
   * A service whose `alpha` is the fraction of a fixed step elapsed since the
   * latest one, in [0, 1): `FixedLoop`'s render `alpha`.
   */
  readonly clock: Descriptor.Value<Clock> extends { readonly alpha: number } ? Clock : "The clock service must provide alpha"
  /** Run conditions, like a system's `when`. */
  readonly when?: When
  /**
   * Places a node at the blended value. Called every run for every entity
   * that has both components and a node, so it should set, not accumulate.
   */
  readonly place: (node: NodeOf<Registry>, position: Placed<Result>, entity: Entity.EntityId<S, Root>) => void
}

/**
 * Builds the system that draws moving entities between fixed steps.
 *
 * A fixed-step simulation moves things in steps; drawing them at their
 * latest position makes motion stutter whenever the display rate differs
 * from the step rate. This system places every node at
 * `previous + (current - previous) * alpha`, where `alpha` comes from the
 * loop (`FixedLoop`'s render callback). The game copies `current` into
 * `previous` at the start of each step.
 *
 * Only `x` and `y` are blended by default, so components holding other
 * numbers (a `z`, an angle) are rejected unless `blend` says how to blend
 * them; `place` then receives what `blend` returns.
 *
 * @example
 * ```ts
 * const Interpolate = RenderSync.interpolate(Game, {
 *   name: "Game/Interpolate",
 *   registry: Sprites,
 *   previous: PrevPosition,
 *   current: Position,
 *   clock: RenderClock,
 *   place: (sprite, { x, y }) => sprite.position.set(x, y)
 * })
 * const render = Game.Schedule(Sync, Interpolate)
 *
 * // 3D: blend every coordinate.
 * RenderSync.interpolate(Game, {
 *   name: "Game/Interpolate3D",
 *   registry: Meshes,
 *   previous: PrevPosition3,
 *   current: Position3,
 *   clock: RenderClock,
 *   blend: (from, to, alpha) => ({
 *     x: from.x + (to.x - from.x) * alpha,
 *     y: from.y + (to.y - from.y) * alpha,
 *     z: from.z + (to.z - from.z) * alpha
 *   }),
 *   place: (mesh, { x, y, z }) => mesh.position.set(x, y, z)
 * })
 * ```
 */
export const interpolate = <
  S extends Schema.Any,
  Root,
  const Previous extends Schema.ComponentDescriptor<S>,
  const Current extends Schema.ComponentDescriptor<S>,
  const Registry extends RegistryService,
  const Clock extends ServiceDescriptor,
  const When extends ReadonlyArray<Condition<Root>> = readonly [],
  Result = NoBlend
>(
  Game: Schema.Game<S, Root>,
  options: InterpolateOptions<S, Root, Previous, Current, Registry, Clock, When, Result>
): RenderSystem<S, Root, Registry | Clock | ConditionNeedsFromConditions<When>> => {
  type Node = NodeOf<Registry>
  const System = Game.System as unknown as (name: string, spec: object, run: (context: any) => void) => unknown
  const Query = Game.Query as unknown as (spec: object) => object
  const entities = Query({
    selection: {
      previous: Game.Query.read(options.previous as Previous),
      current: Game.Query.read(options.current as Current)
    }
  })
  return System(options.name, {
    queries: { entities },
    services: {
      registry: Game.System.service(options.registry),
      clock: Game.System.service(options.clock as ClockService)
    },
    when: options.when ?? []
  }, ({ queries, services }) => {
    const registry = services.registry as NodeRegistry<Node>
    const alpha = (services.clock as { readonly alpha: number }).alpha
    const blend = options.blend as Blend<unknown, unknown, Placed<Result>> | undefined
    const place = options.place
    for (const { entity, data } of queries.entities.each()) {
      const node = registry.get(entity.id)
      if (node === undefined) continue
      if (blend !== undefined) {
        place(node, blend(data.previous.get(), data.current.get(), alpha), entity.id)
        continue
      }
      const from = data.previous.get() as Planar
      const to = data.current.get() as Planar
      place(node, { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha } as Placed<Result>, entity.id)
    }
  }) as RenderSystem<S, Root, Registry | Clock | ConditionNeedsFromConditions<When>>
}
