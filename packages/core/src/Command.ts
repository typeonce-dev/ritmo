/**
 * Deferred command builders and typed entity-draft helpers.
 *
 * This module exists for the part of ECS work that wants to describe mutation
 * now and make it visible later. Systems often decide that an entity should be
 * spawned, despawned, or extended while iterating queries, but the actual
 * world change is intentionally deferred until the schedule reaches
 * `Game.Schedule.applyDeferred()`.
 *
 * `Command` is therefore the write-side companion to `Query`:
 *
 * - queries prove what exists right now
 * - commands stage what should exist after the next deferred boundary
 *
 * Reach for this module when gameplay logic needs explicit world mutation,
 * especially for setup, reset, projectiles, pickups, despawns, and relation
 * edits that should stay schedule-visible instead of happening implicitly.
 *
 * @example
 * ```ts
 * // Build drafts as values so spawn intent stays explicit inside the system.
 * const EnemyWave = Game.System(
 *   "Game/EnemyWave",
 *   // Declare which components this system may spawn.
 *   { commands: Game.System.commands(Game.System.spawns(Position, Enemy, Health)) },
 *   ({ commands }) => {
 *     const enemy = Game.Command.spawn(
 *       // Validate raw authored input through the constructed descriptor.
 *       Game.Command.entryRaw(Position, { x: 96, y: 32 }),
 *       // Add already-validated marker or config components directly.
 *       [Enemy, {}],
 *       [Health, 3]
 *     )
 *
 *     if (enemy._tag === "Failure") {
 *       return
 *     }
 *
 *     // Queue the world write now. The entity becomes visible later.
 *     commands.spawn(enemy.success)
 *   }
 * )
 *
 * // Make the deferred mutation boundary part of the schedule itself.
 * const update = Game.Schedule(
 *   EnemyWave,
 *   Game.Schedule.applyDeferred(),
 *   observeSpawnedEnemies
 * )
 * ```
 *
 * @module Command
 * @docGroup core
 *
 * @groupDescription Namespaces
 * Type-level draft helpers that derive exact component proofs while command values are still staged.
 *
 * @groupDescription Interfaces
 * Structural command-side contracts used by the deferred mutation layer.
 *
 * @groupDescription Type Aliases
 * Explicit entry, error, and proof-folding shapes used by staged command builders.
 *
 * @groupDescription Functions
 * Public command builders that stage entity and component mutations as explicit values.
 */
import * as DescriptorModule from "./Descriptor.ts"
import type { Descriptor } from "./Descriptor.ts"
import * as Entity from "./Entity.ts"
import type * as EntityScope from "./EntityScope.ts"
import type * as Relation from "./Relation.ts"
import * as Result from "./Result.ts"
import type { ReadonlyValue } from "./Query.ts"
import type { RequirementPair, Schema } from "./Schema.ts"

/**
 * Type-level helpers for staged entity construction.
 *
 * These helpers let command builders carry exact component proofs before the
 * draft is flushed into the runtime world.
 */
export namespace Draft {
  /**
   * Adds or replaces a component proof on an entity draft.
   *
   * This is used internally by typed draft builders so each staged insert
   * returns a new draft with a more precise component set.
   */
  export type Insert<
    P extends Entity.ComponentProof,
    Key extends string,
    Value
  > = Omit<P, Key> & {
    readonly [K in Key]: Value
  }

  /**
   * Adds the proof implied by one descriptor/value entry.
   */
  export type InsertEntry<
    P extends Entity.ComponentProof,
    Entry extends readonly [Descriptor<"component", string, any>, unknown]
  > = Entry extends readonly [infer D extends Descriptor<"component", string, any>, infer _Value]
    ? Insert<P, Descriptor.Name<D>, Descriptor.Value<D>>
    : P
}

/**
 * A typed descriptor/value pair used by the flat command authoring APIs.
 */
export type Entry<D extends Descriptor<"component", string, any>> = readonly [D, ReadonlyValue<Descriptor.Value<D>>]

/**
 * Extracts the component-descriptor union from a schema.
 */
type SchemaComponentDescriptor<S extends Schema.Any> =
  Extract<Schema.Components<S>[keyof Schema.Components<S>], Descriptor<"component", string, any>>

/**
 * Pairs each descriptor of a union with its own value type. Building one pair
 * from the whole union instead would accept any descriptor with any value of
 * the schema, e.g. `[Health, "a name"]`.
 */
type EntryOf<D> = D extends Descriptor<"component", string, any> ? Entry<D> : never

/**
 * Any component entry accepted by a schema-aware command API: a descriptor of
 * the schema with a value of that descriptor.
 */
export type SchemaEntry<S extends Schema.Any> = EntryOf<SchemaComponentDescriptor<S>>

/**
 * One entry accepted by `spawn(...)` and `insert(...)`: a plain descriptor/value
 * pair, or a `Result` of one (from `entryRaw(...)`).
 */
export type SpawnEntry<S extends Schema.Any> = SchemaEntry<S> | Result.Result<SchemaEntry<S>, any>

type EntryValue<T> =
  [T] extends [Result.Result<infer Value extends readonly [Descriptor<"component", string, any>, unknown], any>]
    ? Value
    : [T] extends [readonly [Descriptor<"component", string, any>, unknown]]
      ? T
      : never

/**
 * Folds entries into the component proof of the resulting draft.
 */
export type FoldEntries<
  Entries extends ReadonlyArray<SpawnEntry<any>>,
  P extends Entity.ComponentProof = {}
> = Entries extends readonly [
    infer Head extends SpawnEntry<any>,
    ...infer Tail extends ReadonlyArray<SpawnEntry<any>>
  ]
  ? FoldEntries<Tail, Draft.InsertEntry<P, EntryValue<Head>>>
  // Fixed entries after a spread are there too.
  : Entries extends readonly [
      ...infer Init extends ReadonlyArray<SpawnEntry<any>>,
      infer Last extends SpawnEntry<any>
    ]
    ? FoldEntries<Init, Draft.InsertEntry<P, EntryValue<Last>>>
    : number extends Entries["length"]
      // A widened array (a spread of entries built at runtime): each entry may or may not be there.
      ? P & MaybeEntries<EntryValue<Entries[number]>>
      : P

/** The proof of entries that may each be present: every component they can hold, optional. */
type MaybeEntries<Entry> = {
  readonly [E in Entry as E extends readonly [infer D extends Descriptor<"component", string, any>, unknown] ? Descriptor.Name<D> : never]?:
    E extends readonly [infer D extends Descriptor<"component", string, any>, unknown] ? Descriptor.Value<D> : never
}

/**
 * Per-entry failures, aligned with the entries: `null` for entries that
 * succeeded or could not fail.
 */
export type EntryErrors<Entries extends ReadonlyArray<SpawnEntry<any>>> = {
  readonly [K in keyof Entries]:
    Entries[K] extends Result.Result<any, infer Error> ? Error | null : null
}

/**
 * The draft produced from `Entries`, wrapped in a `Result` exactly when at
 * least one entry is a `Result` and can therefore fail.
 */
export type DraftFor<
  S extends Schema.Any,
  Entries extends ReadonlyArray<SpawnEntry<S>>,
  P extends Entity.ComponentProof,
  Root,
  Relates = never
> = [Extract<Entries[number], { readonly _tag: "Success" | "Failure" }>] extends [never]
  ? Entity.EntityDraft<S, FoldEntries<Entries, P>, Root, Relates>
  : Result.Result<Entity.EntityDraft<S, FoldEntries<Entries, P>, Root, Relates>, EntryErrors<Entries>>

/**
 * A deferred world mutation.
 *
 * Systems never mutate the world directly. Instead they build command values
 * that are applied during an explicit flush phase.
 */
export type DeferredCommand<S extends Schema.Any> = {
  /**
   * A small runtime tag that makes command traces and debugging easier.
   */
  readonly tag: string
  /**
   * Applies the deferred mutation to the internal world.
   */
  readonly apply: (world: InternalWorld<S>) => void
}

/**
 * Minimal internal world surface required to apply deferred commands.
 *
 * Commands addressed to entities that no longer exist are ignored: a despawn
 * queued earlier in the same flush wins over later inserts or removals.
 */
export interface InternalWorld<S extends Schema.Any> {
  /**
   * Creates the entity for an id reserved by `commands.spawn(...)` with its
   * staged components. Returns `false`, creating nothing, when the
   * components break a `Schema.requires` requirement.
   */
  readonly spawnEntity: (id: Entity.EntityId<S, any>, components: ReadonlyArray<Entity.StagedComponent>) => boolean
  /**
   * Removes an entity and its outgoing and incoming relations.
   */
  readonly destroyEntity: (id: Entity.EntityId<S, any>) => void
  /**
   * Assigns one live entity to an ownership scope.
   */
  readonly assignEntityScope: (
    id: Entity.EntityId<S, any>,
    scope: EntityScope.EntityScope.Any
  ) => void
  /**
   * Removes every live entity currently owned by one scope.
   */
  readonly destroyEntityScope: (scope: EntityScope.EntityScope.Any) => void
  /**
   * Removes components from a live entity, all or none: nothing is removed
   * when that would leave a component without one it requires.
   */
  readonly removeComponents: (id: Entity.EntityId<S, any>, descriptors: ReadonlyArray<Descriptor<"component", string, any>>) => void
  /**
   * Inserts or replaces components on a live entity, all or none: nothing is
   * written when an inserted component would miss one it requires.
   */
  readonly insertComponents: (id: Entity.EntityId<S, any>, entries: ReadonlyArray<Entity.StagedComponent>) => void
  /**
   * Reports a `despawn` or `remove` given a numeric id this run did not
   * spawn: an id kept from an earlier run, or a raw id that erased types let
   * through. The command is skipped.
   */
  readonly reportStaleTarget: (command: "despawn" | "remove", id: Entity.EntityId<S, any>) => void
  /**
   * Attempts to attach one relation edge between two live entities.
   */
  readonly tryRelate: (
    id: Entity.EntityId<S, any>,
    relation: Relation.Relation.Any,
    target: Entity.EntityId<S, any>
  ) => Result.Result<void, Relation.Relation.MutationError>
  /**
   * Removes one outgoing relation from an entity when present.
   */
  readonly unrelate: (
    id: Entity.EntityId<S, any>,
    relation: Relation.Relation.Any
  ) => void
  /**
   * Reorders the existing children of one hierarchy parent.
   */
  readonly reorderChildren: (
    id: Entity.EntityId<S, any>,
    relation: Relation.Relation.Hierarchy,
    children: ReadonlyArray<Entity.EntityId<S, any>>
  ) => Result.Result<void, Relation.Relation.MutationError>
}

/**
 * Placeholder id carried by drafts; `commands.spawn(...)` reserves the real id.
 */
const unspawnedId = Entity.makeEntityId<any, any>(-1)

/**
 * Creates a typed component entry.
 */
export const entry = <D extends Descriptor<"component", string, any>>(
  descriptor: D,
  value: ReadonlyValue<Descriptor.Value<D>>
): Entry<D> => [descriptor, value]

/**
 * Validates raw input through a constructed descriptor's own validator and
 * returns an entry result for `Game.Command.spawn(...)` / `extend(...)`.
 * `commands.insert` takes valid entries only: check the result first.
 *
 * This is the one way to put unvalidated data on an entity: the descriptor
 * owns its validator (`Descriptor.ConstructedComponent(...)`, built with
 * `Decode` or `Descriptor.fromStandardSchema`). Values that are already
 * valid use a plain `[Descriptor, value]` entry instead. To validate authored
 * constants once at module load, call the constructor (`Vector2.result(...)`)
 * and keep the carried value.
 *
 * @example
 * ```ts
 * const draft = Game.Command.spawn(
 *   Game.Command.entryRaw(Position, { x: 8, y: 12 }),
 *   [Player, {}]
 * )
 * if (draft._tag === "Failure") return
 * commands.spawn(draft.success)
 * ```
 */
export const entryRaw = <D extends DescriptorModule.ConstructedDescriptor<"component", string, any, any, any>>(
  descriptor: D,
  raw: Descriptor.Raw<D>
): Result.Result<Entry<D>, Descriptor.ConstructionError<D>> => {
  const validated = DescriptorModule.constructorOf(descriptor).result(raw) as Result.Result<Descriptor.Value<D>, Descriptor.ConstructionError<D>>
  return validated._tag === "Success"
    ? Result.succeed([descriptor, validated.success] as Entry<D>)
    : Result.fail(validated.failure)
}

/**
 * Adds entries to a draft, a value not yet spawned. Plain entries return the
 * new draft; if any entry is a `Result`, the draft is returned as a `Result`
 * whose error lists every entry's failure (or `null`).
 *
 * Use this while building what a spawn will hold. Use `commands.insert` to
 * add or replace components on an entity that already exists.
 */
export const extend = <
  S extends Schema.Any,
  P extends Entity.ComponentProof,
  Root,
  const Entries extends ReadonlyArray<SpawnEntry<S>>,
  Relates = never
>(
  draft: Entity.EntityDraft<S, P, Root, Relates>,
  ...entries: Entries
): DraftFor<S, Entries, P, Root, Relates> =>
  build(draft.id, { ...draft.proof }, [...draft.components], draft.relations, entries) as DraftFor<S, Entries, P, Root, Relates>

/**
 * Shared draft builder. Plain entries take a fast path; the first `Result`
 * entry switches to collecting per-entry errors.
 */
const build = (
  id: Entity.EntityId<any, any>,
  proof: Record<string, unknown>,
  components: Array<Entity.StagedComponent>,
  relations: ReadonlyArray<Relation.StagedRelation<any, any>>,
  entries: ReadonlyArray<SpawnEntry<any>>
): Entity.EntityDraft<any, any, any> | Result.Result<Entity.EntityDraft<any, any, any>, ReadonlyArray<unknown>> => {
  let errors: Array<unknown> | undefined
  let failed = false
  for (let index = 0; index < entries.length; index++) {
    const candidate = entries[index]!
    let resolved: SchemaEntry<any>
    if (Array.isArray(candidate)) {
      resolved = candidate as SchemaEntry<any>
      errors?.push(null)
    } else {
      errors ??= new Array<unknown>(index).fill(null)
      const result = candidate as Result.Result<SchemaEntry<any>, unknown>
      if (result._tag === "Failure") {
        failed = true
        errors.push(result.failure)
        continue
      }
      errors.push(null)
      resolved = result.success
    }
    proof[resolved[0].name] = resolved[1]
    components.push(resolved)
  }
  if (errors === undefined) {
    return Entity.draft(id, proof, components, relations)
  }
  return failed ? Result.fail(errors) : Result.succeed(Entity.draft(id, proof, components, relations))
}

/**
 * Starts a staged entity from component entries.
 *
 * Drafts are plain values: build them anywhere (including small factories),
 * then queue them with `commands.spawn(...)`. Entries may be `[Descriptor,
 * value]` pairs or results from `entryRaw(...)`; see `extend(...)` for how
 * failures are reported.
 *
 * @example
 * ```ts
 * const makeBullet = (x: number, y: number) =>
 *   Game.Command.spawn([Position, { x, y }], [Velocity, { x: 0, y: -8 }])
 *
 * commands.spawn(makeBullet(10, 20))
 * ```
 */
export const spawn = <
  S extends Schema.Any,
  Root = unknown,
  const Entries extends ReadonlyArray<SpawnEntry<S>> = readonly []
>(
  ...entries: Entries
): DraftFor<S, Entries, {}, Root> =>
  build(unspawnedId, {}, [], noRelations, entries) as DraftFor<S, Entries, {}, Root>

const noRelations: ReadonlyArray<Relation.StagedRelation<any, any>> = []

/**
 * Stages one outgoing relation edge on an entity draft.
 *
 * Drafts stay pure: this only records intent so the runtime can attempt to
 * attach the relation when the spawn command is applied.
 */
export const relate = <
  S extends Schema.Any,
  P extends Entity.ComponentProof,
  R extends Relation.Relation.Any,
  Root = unknown,
  Relates = never
>(
  draft: Entity.EntityDraft<S, P, Root, Relates>,
  relation: R,
  target: Entity.EntityId<S, Root>
): Entity.EntityDraft<S, P, Root, Relates | R> =>
  Entity.draft(draft.id, draft.proof, draft.components, [
    ...draft.relations,
    {
      relation,
      target
    }
  ])

/** One permission of `Game.System.commands(...)`: a kind of command, and what it may touch. */
export interface Permission<out Kind extends PermissionKind, out Value> {
  readonly permission: Kind
  readonly values: ReadonlyArray<Value>
}

export type PermissionKind = "spawns" | "inserts" | "removes" | "despawns" | "despawnsScope" | "relates"

type ComponentDescriptor = Descriptor<"component", string, any>

/**
 * Allows `spawn` / `spawnIn` of drafts whose components are all among `components`.
 * Use it for entities the system creates; use `extend` on a draft to build one.
 */
export const spawns = <const Components extends readonly [ComponentDescriptor, ...ReadonlyArray<ComponentDescriptor>]>(...components: Components): Permission<"spawns", Components[number]> =>
  ({ permission: "spawns", values: components })

/**
 * Allows `insert(entity, [X, value])` with `X` among `components`: add or
 * replace at the next `applyDeferred()`. To change a value now, on an entity
 * you matched, write through a query (`Game.Query.write`) instead.
 */
export const inserts = <const Components extends readonly [ComponentDescriptor, ...ReadonlyArray<ComponentDescriptor>]>(...components: Components): Permission<"inserts", Components[number]> =>
  ({ permission: "inserts", values: components })

/** Allows `remove(entity, X)` with `X` among `components`. */
export const removes = <const Components extends readonly [ComponentDescriptor, ...ReadonlyArray<ComponentDescriptor>]>(...components: Components): Permission<"removes", Components[number]> =>
  ({ permission: "removes", values: components })

/**
 * Allows `despawn(entity)` where `entity` comes from a query match proving one
 * of `components` (`match.entity`), never a raw id: the system can only
 * despawn what it has proven is, for example, an `Enemy`.
 */
export const despawns = <const Components extends readonly [ComponentDescriptor, ...ReadonlyArray<ComponentDescriptor>]>(...components: Components): Permission<"despawns", Components[number]> =>
  ({ permission: "despawns", values: components })

/** Allows `despawnScope(scope)` for this scope. */
export const despawnsScope = <const Scope extends EntityScope.EntityScope.Any>(scope: Scope): Permission<"despawnsScope", Scope> =>
  ({ permission: "despawnsScope", values: [scope] })

/** Allows `relate`, `unrelate`, and `reorderChildren` for these relations. */
export const relates = <const Relations extends readonly [Relation.Relation.Any, ...ReadonlyArray<Relation.Relation.Any>]>(...relations: Relations): Permission<"relates", Relations[number]> =>
  ({ permission: "relates", values: relations })

type PermissionValue<Permissions, Kind extends PermissionKind> =
  Permissions extends Permission<Kind, infer Value> ? Value : never

/**
 * The commands a system may queue, declared in its spec as
 * `commands: Game.System.commands(...)`. Without it, the system has no
 * `commands`.
 */
export interface CommandAccess<
  out Spawns = never,
  out Inserts = never,
  out Removes = never,
  out Despawns = never,
  out Scopes = never,
  out Relates = never
> {
  readonly kind: "commands"
  readonly permissions: ReadonlyArray<Permission<PermissionKind, unknown>>
  readonly __permissions?: (_: never) => readonly [Spawns, Inserts, Removes, Despawns, Scopes, Relates]
}

export namespace CommandAccess {
  export type Any = CommandAccess<any, any, any, any, any, any>
}

/** Declares the commands a system may queue; see the permission builders. */
export const commands = <const Permissions extends ReadonlyArray<Permission<PermissionKind, unknown>>>(
  ...permissions: Permissions
): CommandAccess<
  PermissionValue<Permissions[number], "spawns">,
  PermissionValue<Permissions[number], "inserts">,
  PermissionValue<Permissions[number], "removes">,
  PermissionValue<Permissions[number], "despawns">,
  PermissionValue<Permissions[number], "despawnsScope">,
  PermissionValue<Permissions[number], "relates">
> => ({ kind: "commands", permissions })

/** The `commands` of a system that declares none. */
export type NotDeclared =
  "commands are not declared for this system: add commands: Game.System.commands(...) to its spec, with the permissions it needs (spawns, inserts, removes, despawns, despawnsScope, relates)"

/** A method whose permission is not declared: any call fails with an argument error naming the fix. */
type MethodNotDeclared<Method extends string, Builder extends string> =
  (...fix: ReadonlyArray<`${Method} is not declared in this system's commands: add Game.System.${Builder}(...) to Game.System.commands(...)`>) => never

type Fix<Message extends string> = { readonly __fixCommands__: Message }

type Names<D> = D extends { readonly name: infer Name extends string } ? Name : never

/** Every key of every member of a union of proofs (a draft with a conditional entry is a union). */
type AllKeys<P> = P extends unknown ? keyof P & string : never

/** Relations staged on a draft need `relates`, like `commands.relate`. */
type DraftRelationsAllowed<Relates, Declared> =
  [Exclude<Relates, Declared>] extends [never]
    ? unknown
    : Fix<`${Names<Exclude<Relates, Declared>>} is related by this draft but not declared in this system's commands: add it to Game.System.relates(...)`>

type DraftAllowed<P, Spawns> =
  [Exclude<AllKeys<P>, Names<Spawns>>] extends [never]
    ? unknown
    : Fix<`${Exclude<AllKeys<P>, Names<Spawns>>} is not declared in this system's commands: add it to Game.System.spawns(...)`>

type EntriesAllowed<Entries extends ReadonlyArray<readonly [ComponentDescriptor, unknown]>, Inserts> =
  [Exclude<Entries[number][0], Inserts>] extends [never]
    ? unknown
    : Fix<`${Names<Exclude<Entries[number][0], Inserts>>} is not declared in this system's commands: add it to Game.System.inserts(...)`>

type RemoveAllowed<D, Removes> =
  [D] extends [Removes] ? unknown : Fix<`${Names<D>} is not declared in this system's commands: add it to Game.System.removes(...)`>

/**
 * Why each possible target of a despawn is not allowed (`never` when it is).
 * Computed per member, so a target chosen from several queries
 * (`cond ? a.entity : b.entity`) must pass for every one of them.
 */
type DespawnRejections<E, Despawns> =
  E extends { readonly kind: "EntityRef" | "EntityMut"; readonly __proves?: (_: infer Proves) => void }
    ? [Extract<Proves, Despawns>] extends [never]
      ? `despawn needs an entity from a query proving ${Names<Despawns>} (declared in despawns)`
      : never
    : E extends { readonly [spawnedTypeId]: (_: never) => infer Spawned }
      ? [Extract<Spawned, Names<Despawns>>] extends [never]
        ? `despawn needs an entity spawned with ${Names<Despawns>} (declared in despawns)`
        : never
      : `despawn needs an entity from a query proving ${Names<Despawns>} (declared in despawns), not a raw id: pass match.entity`

type DespawnAllowed<E, Despawns> =
  [DespawnRejections<E, Despawns>] extends [never] ? unknown : Fix<DespawnRejections<E, Despawns>>

declare const spawnedTypeId: unique symbol

/**
 * The id `spawn` / `spawnIn` return: an `EntityId` that also records the
 * components its draft holds in every case, so the system that queued it can
 * `despawn` it before the next `applyDeferred()` (no query can match it yet).
 * It is valid only in the run that spawned it: kept in a closure or a
 * resource and passed to `despawn` / `remove` in a later run, the command is
 * skipped and reported (the `stale-target` lint). Keep the entity id or a
 * handle and resolve it again through a query instead.
 * Stored as a plain `EntityId`, it is a raw id again.
 */
export type SpawnedId<S extends Schema.Any, Root, Components extends string> =
  Entity.EntityId<S, Root> & { readonly [spawnedTypeId]: (_: never) => Components }

/** One message per missing requirement: `"Player requires Velocity"`. */
type MissingMessages<Pairs> = Pairs extends readonly [infer From extends string, infer To extends string] ? `${From} requires ${To}` : never

/** The requirements (`[requirer, required]`) of the components in `From` that `Held` lacks. */
type MissingPairsFrom<S extends Schema.Any, From extends string, Held extends string> =
  Extract<Schema.Requires<S>, readonly [From, string]> extends infer Pair
    ? Pair extends readonly [string, infer To extends string]
      ? To extends Held ? never : Pair
      : never
    : never

/**
 * The requirements a draft may break. A draft's proof is a union of
 * alternatives when an entry is conditional, and has optional keys for
 * spread entries: in each alternative, every component it may hold needs
 * every component it requires surely held. Direct requirements are enough:
 * each required component must be held too, with its own requirements.
 */
type DraftViolations<S extends Schema.Any, P> =
  P extends unknown ? MissingPairsFrom<S, keyof P & string, RequiredKeys<P>> : never

type DraftRequirementsMet<S extends Schema.Any, P> =
  [DraftViolations<S, P>] extends [never]
    ? unknown
    : Fix<`${MissingMessages<DraftViolations<S, P>>}: add the missing entries to the draft`>

/** What one possible target holds: a query match's proof, or a `SpawnedId`'s draft. A raw id proves nothing. */
type HeldBy<E> =
  E extends { readonly kind: "EntityRef" | "EntityMut"; readonly __proves?: (_: infer Proves) => void }
    ? Names<Proves>
    : E extends { readonly [spawnedTypeId]: (_: never) => infer Spawned extends string }
      ? Spawned
      : never

/** What one possible target's query proves absent: its `without`. */
type LackedBy<E> =
  E extends { readonly kind: "EntityRef" | "EntityMut"; readonly __lacks?: (_: infer Lacks) => void }
    ? Names<Lacks>
    : never

/** The names in `All` that some member of `E` does not hold (or lack). */
type MissingFromHeld<E, All> = E extends unknown ? Exclude<All, HeldBy<E>> : never
type MissingFromLacked<E, All> = E extends unknown ? Exclude<All, LackedBy<E>> : never

/**
 * What an insert or remove target is known to hold. For a target chosen
 * from several queries (`cond ? a.entity : b.entity`), only what every one
 * of them proves.
 */
type TargetHolds<E> = Exclude<HeldBy<E>, MissingFromHeld<E, HeldBy<E>>>

/** What a remove target is known to lack: its query's `without` (for several queries, what all of them exclude). */
type TargetLacks<E> = Exclude<LackedBy<E>, MissingFromLacked<E, LackedBy<E>>>

type EntryNames<Entries extends ReadonlyArray<readonly [ComponentDescriptor, unknown]>> = Names<Entries[number][0]>

/** The names one entry surely holds: none when it is conditional between descriptors. */
type SureEntryNames<Entry, All extends string = EntryNamesOf<Entry>> =
  Exclude<All, Entry extends unknown ? Exclude<All, EntryNamesOf<Entry>> : never>
type EntryNamesOf<Entry> = Entry extends readonly [infer D, unknown] ? Names<D> : never

/** The names surely inserted: fixed entries, not spread or conditional ones. */
type SurelyInserted<Entries> =
  Entries extends readonly [infer Head, ...infer Tail]
    ? SureEntryNames<Head> | SurelyInserted<Tail>
    : Entries extends readonly [...infer Init, infer Last]
      ? SureEntryNames<Last> | SurelyInserted<Init>
      : never

/**
 * Inserted components (any entry may be one) with requirements neither
 * surely inserted alongside nor proven held by the target.
 */
type InsertViolations<S extends Schema.Any, E, Entries extends ReadonlyArray<readonly [ComponentDescriptor, unknown]>> =
  MissingPairsFrom<S, EntryNames<Entries>, SurelyInserted<Entries> | TargetHolds<E>>

type InsertRequirementsMet<S extends Schema.Any, E, Entries extends ReadonlyArray<readonly [ComponentDescriptor, unknown]>> =
  [InsertViolations<S, E, Entries>] extends [never]
    ? unknown
    : Fix<`${MissingMessages<InsertViolations<S, E, Entries>>}: insert it in the same call, or pass match.entity from a query that proves it`>

/**
 * Removing `Removed` is sound when every component that requires one of
 * them is removed in the same call or proven absent by the target's query
 * (`without`): otherwise the entity may keep a requirer without its
 * requirement.
 */
type RemoveViolations<S extends Schema.Any, E, Removed extends string> =
  Extract<Schema.Requires<S>, readonly [string, Removed]> extends infer Pair
    ? Pair extends readonly [infer From extends string, infer To extends string]
      ? From extends Removed | TargetLacks<E>
        ? never
        : `${To} is required by ${From}: remove ${From} in the same call, or match the entity with a query that has without: [${From}]`
      : never
    : never

type RemoveRequirementsMet<S extends Schema.Any, E, Removed extends string> =
  [RemoveViolations<S, E, Removed>] extends [never] ? unknown : Fix<RemoveViolations<S, E, Removed>>

/** A remove target: `match.entity`, or the id `spawn` returned in this run; never a raw id, not even as one of several. */
type RemoveTargetRejections<S extends Schema.Any, Root, E> =
  E extends { readonly kind: "EntityRef" | "EntityMut"; readonly id: Entity.EntityId<S, Root> }
    ? never
    : E extends SpawnedId<S, Root, string>
      ? never
      : "remove needs an entity from a query (pass match.entity) or the id spawn returned in this run, not a raw id"

type RemoveTargetAllowed<S extends Schema.Any, Root, E> =
  [RemoveTargetRejections<S, Root, E>] extends [never] ? unknown : Fix<RemoveTargetRejections<S, Root, E>>

/** The transitive closure of the names `N` require (cycles stop). */
type RequiredClosure<Pairs extends RequirementPair, N extends string, Seen extends string = never> =
  [Exclude<N, Seen>] extends [never]
    ? Seen
    : RequiredClosure<Pairs, Extract<Pairs, readonly [Exclude<N, Seen>, string]>[1], Seen | N>

/**
 * The component descriptors that `Names` require, transitively
 * (`Schema.requires`): what `Game.System.spawns(...)` also allows.
 */
export type RequiredDescriptors<S extends Schema.Any, Names extends string> =
  // Non-literal names (an unresolved descriptor, alone or next to known ones) would never
  // close: leave the error to the descriptor.
  0 extends 1 & Names
    ? never
    : string extends Names
    ? never
    : [Extract<Schema.Requires<S>, readonly [Names, string]>] extends [never]
    ? never
    : Extract<Schema.ComponentDescriptor<S>, { readonly name: Exclude<RequiredClosure<Schema.Requires<S>, Names>, Names> }>

type SchemaComponent<S extends Schema.Any> = Extract<Schema.Components<S>[keyof Schema.Components<S>], ComponentDescriptor>

/** An entity a system has proven something about: `match.entity`, or the id `spawn` returned. */
type EntityTarget<S extends Schema.Any, Root> =
  | { readonly kind: "EntityRef" | "EntityMut"; readonly id: Entity.EntityId<S, Root> }
  | SpawnedId<S, Root, string>

/** The keys every member of a union of proofs requires (what a draft holds in every case). */
type RequiredKeys<P> = P extends unknown ? { [K in keyof P]-?: {} extends Pick<P, K> ? never : K }[keyof P] & string : never
type MissingSomewhere<P, All> = P extends unknown ? Exclude<All, RequiredKeys<P>> : never
type HeldNames<P> = Exclude<AllKeys<P>, MissingSomewhere<P, AllKeys<P>>>

/**
 * The command API a system gets for its declared permissions. Commands are
 * the structural mutation entrypoint: spawns, inserts, removals, despawns,
 * and relation edits. They are queued in order and applied only at the next
 * `applyDeferred()` (or `applyStateTransitions(...)`) schedule step.
 *
 * Each method exists only with its permission, and only for what it names:
 * `spawn` needs `Game.System.spawns(...)` listing every component of the
 * draft, `insert` needs `inserts`, `remove` needs `removes`, `despawn` needs
 * `despawns` and an entity from a query proving one of them, `despawnScope`
 * needs `despawnsScope`, and relation edits need `relates`, including
 * relations a spawned draft stages with `Game.Command.relate(...)`.
 *
 * Resource and event writes are not commands: they go through the
 * `writeResource(...)` / `writeEvent(...)` access a system declares.
 */
export interface CommandsApi<
  S extends Schema.Any,
  Root = unknown,
  Spawns = never,
  Inserts = never,
  Removes = never,
  Despawns = never,
  Scopes = never,
  Relates = never
> {
  /**
   * Queues a staged entity for spawning and returns its stable runtime id.
   *
   * The draft must hold every component its components require
   * (`Schema.requires`); drafts are checked here, so a partial draft built
   * with `Game.Command.spawn(...)` and completed with `extend(...)` is fine.
   * A component the draft may hold (a conditional or spread entry) needs
   * what it requires surely held.
   */
  readonly spawn: [Spawns] extends [never]
    ? MethodNotDeclared<"spawn", "spawns">
    : <P extends Entity.ComponentProof, R = never>(
        draft: Entity.EntityDraft<S, P, Root, R> & DraftAllowed<P, Spawns> & DraftRequirementsMet<S, P> & DraftRelationsAllowed<R, Relates>
      ) => SpawnedId<S, Root, HeldNames<P>>
  /**
   * Queues an entity spawn owned by one lifetime scope (removed together
   * with `despawnScope(...)`). The draft is checked like `spawn(...)`.
   */
  readonly spawnIn: [Spawns] extends [never]
    ? MethodNotDeclared<"spawnIn", "spawns">
    : <P extends Entity.ComponentProof, R = never>(
        scope: EntityScope.EntityScope<string, Root>,
        draft: Entity.EntityDraft<S, P, Root, R> & DraftAllowed<P, Spawns> & DraftRequirementsMet<S, P> & DraftRelationsAllowed<R, Relates>
      ) => SpawnedId<S, Root, HeldNames<P>>
  /**
   * Queues component inserts (or replacements) on an existing entity, applied
   * at the next `applyDeferred()`. To change a value now, on an entity you
   * matched, write through a query (`Game.Query.write`) instead; components
   * declared `immutable: true` change only through `insert`.
   *
   * Pass `match.entity`: its query proves what the entity holds, which must
   * cover what the inserted components require (`Schema.requires`) together
   * with the entries inserted in the same call. The id `spawn` returned in
   * this run proves its draft. A raw `EntityId` proves nothing, so it only
   * inserts components without requirements.
   *
   * Entries must already be valid; validate raw input with
   * `Game.Command.entryRaw(...)` first.
   */
  readonly insert: [Inserts] extends [never]
    ? MethodNotDeclared<"insert", "inserts">
    : <const E extends Entity.EntityId<S, Root> | EntityTarget<S, Root>, const Entries extends ReadonlyArray<SchemaEntry<S>>>(
        entity: E,
        ...entries: Entries & EntriesAllowed<Entries, Inserts> & InsertRequirementsMet<S, E, Entries>
      ) => Entity.EntityId<S, Root>
  /**
   * Queues an entity removal. A despawned entity stays visible to queries
   * until the next `applyDeferred()`, and despawns never count as writers for
   * `Game.System.thisTick` query reads.
   *
   * Pass `match.entity` from a query proving one of the `despawns`
   * components, or the id `spawn` returned in this run (it holds its draft's
   * components); never a raw id.
   */
  readonly despawn: [Despawns] extends [never]
    ? MethodNotDeclared<"despawn", "despawns">
    : <const E>(entity: unknown extends DespawnAllowed<E, Despawns> ? E : DespawnAllowed<E, Despawns>) => void
  /**
   * Queues removal of every entity owned by one lifetime scope.
   */
  readonly despawnScope: [Scopes] extends [never]
    ? MethodNotDeclared<"despawnScope", "despawnsScope">
    : (scope: Scopes) => void
  /**
   * Queues the removal of one or more components from an existing entity,
   * applied together at the next `applyDeferred()`.
   *
   * Pass `match.entity` from a query, or the id `spawn` returned in this run;
   * never a raw id. A component another one requires (`Schema.requires`) can
   * only go together with that requirer, in the same call, or from an
   * entity whose query has `without: [Requirer]`.
   */
  readonly remove: [Removes] extends [never]
    ? MethodNotDeclared<"remove", "removes">
    : <
        const E,
        const Ds extends readonly [SchemaComponent<S>, ...Array<SchemaComponent<S>>]
      >(
        entity: unknown extends RemoveTargetAllowed<S, Root, E> ? E : RemoveTargetAllowed<S, Root, E>,
        ...descriptors: Ds & RemoveAllowed<Ds[number], Removes> & RemoveRequirementsMet<S, E, Names<Ds[number]>>
      ) => Entity.EntityId<S, Root>
  /**
   * Queues one live relation mutation for deferred application.
   */
  readonly relate: [Relates] extends [never]
    ? MethodNotDeclared<"relate", "relates">
    : <R extends Extract<Relates, Relation.Relation.Any>>(
        entity: Entity.EntityId<S, Root>,
        relation: R,
        target: Entity.EntityId<S, Root>
      ) => void
  /**
   * Queues removal of one outgoing relation when present.
   */
  readonly unrelate: [Relates] extends [never]
    ? MethodNotDeclared<"unrelate", "relates">
    : <R extends Extract<Relates, Relation.Relation.Any>>(
        entity: Entity.EntityId<S, Root>,
        relation: R
      ) => void
  /**
   * Queues a hierarchy-only reorder of one parent's current children.
   */
  readonly reorderChildren: [Relates] extends [never]
    ? MethodNotDeclared<"reorderChildren", "relates">
    : <R extends Extract<Relates, Relation.Relation.Hierarchy>>(
        entity: Entity.EntityId<S, Root>,
        relation: R,
        children: ReadonlyArray<Entity.EntityId<S, Root>>
      ) => void
}

/** The command queue the runtime gives each system: every command, unchecked, and `flush`. */
export interface CommandQueue<S extends Schema.Any, Root = unknown> {
  readonly spawn: (draft: Entity.EntityDraft<S, any, Root, any>) => Entity.EntityId<S, Root>
  readonly spawnIn: (scope: EntityScope.EntityScope<string, Root>, draft: Entity.EntityDraft<S, any, Root, any>) => Entity.EntityId<S, Root>
  readonly insert: (entity: Entity.EntityId<S, Root> | { readonly id: Entity.EntityId<S, Root> }, ...entries: ReadonlyArray<SchemaEntry<S>>) => Entity.EntityId<S, Root>
  readonly despawn: (entity: Entity.EntityId<S, Root> | { readonly id: Entity.EntityId<S, Root> }) => void
  readonly despawnScope: (scope: EntityScope.EntityScope<string, Root>) => void
  readonly remove: (entity: Entity.EntityId<S, Root> | { readonly id: Entity.EntityId<S, Root> }, ...descriptors: ReadonlyArray<ComponentDescriptor>) => Entity.EntityId<S, Root>
  readonly relate: (entity: Entity.EntityId<S, Root>, relation: Relation.Relation.Any, target: Entity.EntityId<S, Root>) => void
  readonly unrelate: (entity: Entity.EntityId<S, Root>, relation: Relation.Relation.Any) => void
  readonly reorderChildren: (entity: Entity.EntityId<S, Root>, relation: Relation.Relation.Hierarchy, children: ReadonlyArray<Entity.EntityId<S, Root>>) => void
  /**
   * Drains the queued commands in insertion order.
   */
  readonly flush: () => ReadonlyArray<DeferredCommand<S>>
}

/**
 * Creates a fresh command queue for a system execution.
 *
 * The returned API is intentionally imperative for system authors, but all
 * mutations stay deferred until `flush()` is applied by the runtime.
 */
export const makeCommands = <S extends Schema.Any, Root = unknown>(
  allocateId: () => Entity.EntityId<S, Root>
): CommandQueue<S, Root> => {
  /**
   * The per-system command buffer.
   *
   * Each system gets a fresh queue so command application happens only after
   * the system effect completes.
   */
  const queue: Array<DeferredCommand<S>> = []
  /**
   * Ids this run spawned: the only numeric targets `despawn` and `remove`
   * accept. Their types reject raw ids, so any other number is an id kept
   * from an earlier run (or erased types), and proves nothing now.
   */
  const spawnedThisRun = new Set<number>()

  return {
    spawn(draft) {
      const id = allocateId()
      spawnedThisRun.add(id)
      queue.push({
        tag: "spawn",
        apply(world) {
          if (!world.spawnEntity(id, draft.components)) return
          for (const stagedRelation of draft.relations) {
            world.tryRelate(id, stagedRelation.relation, stagedRelation.target)
          }
        }
      })
      return id
    },
    spawnIn(scope, draft) {
      const id = allocateId()
      spawnedThisRun.add(id)
      queue.push({
        tag: "spawnIn",
        apply(world) {
          if (!world.spawnEntity(id, draft.components)) return
          world.assignEntityScope(id, scope)
          for (const stagedRelation of draft.relations) {
            world.tryRelate(id, stagedRelation.relation, stagedRelation.target)
          }
        }
      })
      return id
    },
    insert(target, ...entries) {
      const entity = typeof target === "object" ? target.id : target
      queue.push({
        tag: "insert",
        apply(world) {
          world.insertComponents(entity, entries)
        }
      })
      return entity
    },
    despawn(entity) {
      const id = typeof entity === "object" ? entity.id : entity
      const stale = typeof entity !== "object" && !spawnedThisRun.has(id)
      queue.push({
        tag: "despawn",
        apply(world) {
          if (stale) world.reportStaleTarget("despawn", id)
          else world.destroyEntity(id)
        }
      })
    },
    despawnScope(scope) {
      queue.push({
        tag: "despawnScope",
        apply(world) {
          world.destroyEntityScope(scope)
        }
      })
    },
    remove(target, ...descriptors) {
      const entity = typeof target === "object" ? target.id : target
      const stale = typeof target !== "object" && !spawnedThisRun.has(entity)
      queue.push({
        tag: "remove",
        apply(world) {
          if (stale) world.reportStaleTarget("remove", entity)
          else world.removeComponents(entity, descriptors)
        }
      })
      return entity
    },
    relate(entity, relation, target) {
      queue.push({
        tag: "relate",
        apply(world) {
          world.tryRelate(entity, relation, target)
        }
      })
    },
    unrelate(entity, relation) {
      queue.push({
        tag: "unrelate",
        apply(world) {
          world.unrelate(entity, relation)
        }
      })
    },
    reorderChildren(entity, relation, children) {
      queue.push({
        tag: "reorderChildren",
        apply(world) {
          world.reorderChildren(entity, relation, children)
        }
      })
    },
    flush() {
      spawnedThisRun.clear()
      return queue.splice(0, queue.length)
    }
  }
}
