/**
 * Save and load the world as plain data.
 *
 * `runtime.snapshot()` captures entities (with their ids), component values,
 * relation edges, resources, and committed state-machine values, keyed by
 * descriptor, relation, and machine names. A bound schema guarantees those
 * names are unique, so they are stable save keys. The snapshot is plain data:
 * store it with `JSON.stringify` or `structuredClone`.
 *
 * `runtime.restore(data)` accepts `unknown`, because saved data comes from
 * outside the program, and validates it before touching the world: shape,
 * unknown names, every component and resource value (through its descriptor's
 * constructor), relation edges, and machine states. On failure the world is
 * unchanged.
 *
 * Both methods exist only when every component and resource in the schema is
 * either constructed with a constructor that accepts untrusted input
 * (`Descriptor.ConstructedComponent(...)` given a `decode(raw: unknown)`, as
 * `@typeonce/ritmo-math` modules export, or a `result(raw: unknown)`) or transient
 * (`Descriptor.TransientComponent<T>()`, which is not saved). Otherwise calling them is a compile error naming the descriptors
 * without a validator, so no unvalidated value can enter the world through a
 * save file. `Descriptor.fromStandardSchema(...)` turns any Standard Schema
 * validator into a constructor.
 *
 * Restoring despawns every current entity and spawns the saved ones with their
 * original ids, so change detection and renderer sync see a restore as normal
 * despawns and spawns. Pending commands and events emitted by systems are
 * dropped; events the host sent with `runtime.send` and no system has read
 * yet are kept, since they are input that has not been handled. Transient
 * components are absent from restored entities; transient resources keep their
 * current value.
 *
 * When the game's save format changes, give the runtime its migrations
 * (`Game.Runtime.make({ saves: Snapshot.migrations(...) })`): saves carry a
 * `gameVersion`, and `restore` upgrades older ones step by step before
 * validating them.
 *
 * @module Snapshot
 * @docGroup runtime
 *
 * @example
 * ```ts
 * localStorage.setItem("save", JSON.stringify(runtime.snapshot()))
 *
 * const restored = runtime.restore(JSON.parse(localStorage.getItem("save") ?? "null"))
 * if (restored._tag === "Failure") {
 *   console.error(restored.failure)
 * }
 * ```
 */
import type { DecodableDescriptor, Descriptor, TransientDescriptor } from "./Descriptor.ts"
import * as Result from "./Result.ts"
import type { Schema } from "./Schema.ts"

// Loadable: transient, constructed with `decode`, or constructed with a
// `result` that accepts `unknown` input.
type UnvalidatedName<D> = D extends TransientDescriptor<any, any, any> ? never
  : D extends DecodableDescriptor<any, any, any, any, any> ? never
  : D extends Descriptor.AnyConstructed ? unknown extends Descriptor.Raw<D> ? never : D["name"]
  : D extends Descriptor.Any ? D["name"]
  : never

type UnvalidatedIn<R> = { readonly [K in keyof R]: UnvalidatedName<R[K]> }[keyof R]

/**
 * Names of the schema's components and resources that a snapshot could not
 * validate on load: neither transient nor constructed with a constructor that
 * accepts untrusted input (`decode`, or `result` taking `unknown`).
 */
export type Unvalidated<S extends Schema.Any> = UnvalidatedIn<S["components"]> | UnvalidatedIn<S["resources"]>

/**
 * The `snapshot`/`restore` member type for schema `S`.
 *
 * When some component or resource is neither constructed nor transient, the
 * member is an object with no call signature, so calling it fails to compile
 * and the error lists each descriptor to fix, for example
 * `{ "Game/Position needs a validator": "..." }`.
 */
export type Gate<S extends Schema.Any, Method> = Unvalidated<S> extends infer Names extends string
  ? [Names] extends [never] ? Method
  : { readonly [Name in Names as `${Name} needs a validator`]: "Use a Constructed* descriptor whose constructor accepts unknown input (validated on load) or a Transient* one (not saved)" }
  : never

export interface EntitySnapshot {
  readonly id: number
  /** Component values by descriptor name. */
  readonly components: Readonly<Record<string, unknown>>
}

/**
 * The snapshot format version `snapshot()` writes and `restore()` accepts.
 * Version 1 had no scope membership; restoring one would leave every scoped
 * entity outside its scope, so it is rejected (`UnsupportedVersion`).
 */
export const version = 2

export interface WorldSnapshot {
  readonly version: typeof version
  /**
   * The game's own save version: the last `Snapshot.migration` the runtime
   * that wrote it was given (0 without migrations, and for saves written
   * before game versions existed).
   */
  readonly gameVersion: number
  /** The next id the runtime will allocate. */
  readonly nextEntity: number
  readonly entities: ReadonlyArray<EntitySnapshot>
  /** Per relation name: `[target, sources in order]` pairs. */
  readonly relations: Readonly<Record<string, ReadonlyArray<readonly [number, ReadonlyArray<number>]>>>
  /** Resource values by descriptor name. */
  readonly resources: Readonly<Record<string, unknown>>
  /** Committed machine values by machine name. */
  readonly machines: Readonly<Record<string, string | number>>
  /**
   * Entity scope membership: per scope name, the ids of the entities spawned
   * into it (`commands.spawnIn`), so `despawnScope` still finds them after a
   * restore. An entity is in at most one scope.
   */
  readonly scopes: Readonly<Record<string, ReadonlyArray<number>>>
}

/**
 * Why a snapshot could not be restored.
 */
export type RestoreError =
  | { readonly _tag: "InvalidSnapshot"; readonly path: string }
  | { readonly _tag: "UnsupportedVersion"; readonly version: unknown }
  /** A save written by a newer game than this runtime's migrations reach. */
  | { readonly _tag: "NewerGameVersion"; readonly gameVersion: number; readonly latest: number }
  | { readonly _tag: "UnknownComponent"; readonly entityId: number; readonly name: string }
  | { readonly _tag: "InvalidComponent"; readonly entityId: number; readonly name: string; readonly error: unknown }
  /** A saved entity holds `requiredBy` but lacks `name`, which `Schema.requires` says it needs. */
  | { readonly _tag: "MissingRequiredComponent"; readonly entityId: number; readonly name: string; readonly requiredBy: string }
  | { readonly _tag: "UnknownResource"; readonly name: string }
  | { readonly _tag: "InvalidResource"; readonly name: string; readonly error: unknown }
  | { readonly _tag: "UnknownRelation"; readonly name: string }
  | { readonly _tag: "InvalidRelation"; readonly name: string; readonly sourceId: number; readonly targetId: number }
  | { readonly _tag: "UnknownMachine"; readonly name: string }
  | { readonly _tag: "InvalidMachineState"; readonly name: string; readonly value: unknown }
  /** A saved sub-state value while its parent machine is not in the state the sub-state exists in. */
  | { readonly _tag: "InactiveSubState"; readonly name: string; readonly parent: string; readonly requires: unknown }
  | { readonly _tag: "DuplicateEntity"; readonly entityId: number }
  /** A scope name that no `Game.EntityScope(...)` of this game defines. */
  | { readonly _tag: "UnknownScope"; readonly name: string }
  /** A scope member that is not a saved entity, or is already in another scope. */
  | { readonly _tag: "InvalidScope"; readonly name: string; readonly entityId: number }
  | { readonly _tag: "UnvalidatedDescriptor"; readonly name: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEntityId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0

const invalid = (path: string) => Result.fail<RestoreError>({ _tag: "InvalidSnapshot", path })

/**
 * Checks the structure of untrusted snapshot data. Names and values are
 * checked against the schema by the runtime.
 */
export const parse = (data: unknown): Result.Result<WorldSnapshot, RestoreError> => {
  if (!isRecord(data)) return invalid("$")
  if (data["version"] !== version) return Result.fail({ _tag: "UnsupportedVersion", version: data["version"] })
  const gameVersion = data["gameVersion"] ?? 0
  if (typeof gameVersion !== "number" || !Number.isSafeInteger(gameVersion) || gameVersion < 0) return invalid("$.gameVersion")
  if (!isEntityId(data["nextEntity"])) return invalid("$.nextEntity")
  const entities = data["entities"]
  if (!Array.isArray(entities)) return invalid("$.entities")
  for (const [index, entity] of entities.entries()) {
    if (!isRecord(entity) || !isEntityId(entity["id"])) return invalid(`$.entities[${index}].id`)
    if (!isRecord(entity["components"])) return invalid(`$.entities[${index}].components`)
  }
  const relations = data["relations"]
  if (!isRecord(relations)) return invalid("$.relations")
  for (const [name, edges] of Object.entries(relations)) {
    if (!Array.isArray(edges)) return invalid(`$.relations.${name}`)
    for (const [index, edge] of edges.entries()) {
      const valid = Array.isArray(edge)
        && edge.length === 2
        && isEntityId(edge[0])
        && Array.isArray(edge[1])
        && edge[1].every(isEntityId)
      if (!valid) return invalid(`$.relations.${name}[${index}]`)
    }
  }
  if (!isRecord(data["resources"])) return invalid("$.resources")
  const machines = data["machines"]
  if (!isRecord(machines)) return invalid("$.machines")
  for (const [name, value] of Object.entries(machines)) {
    if (typeof value !== "string" && typeof value !== "number") return invalid(`$.machines.${name}`)
  }
  const scopes = data["scopes"]
  if (!isRecord(scopes)) return invalid("$.scopes")
  for (const [name, members] of Object.entries(scopes)) {
    if (!Array.isArray(members) || !members.every(isEntityId)) return invalid(`$.scopes.${name}`)
  }
  return Result.succeed({ ...data, gameVersion } as unknown as WorldSnapshot)
}

/**
 * One step of a game's save format: turns a save of version `to - 1` into
 * version `to`. A pure function on the save's plain data, tested like one.
 */
export interface Migration<To extends number = number> {
  readonly to: To
  readonly migrate: (save: WorldSnapshot) => WorldSnapshot
}

/** A game's save migrations, given to `Game.Runtime.make({ saves })`. Built with {@link migrations}. */
export interface Migrations<Latest extends number = number> {
  readonly kind: "SnapshotMigrations"
  /** The game version `snapshot()` writes. */
  readonly latest: Latest
  readonly steps: ReadonlyArray<Migration>
}

/**
 * Declares the step that upgrades saves to game version `to` (from `to - 1`).
 *
 * @example
 * ```ts
 * Snapshot.migration(2, (save) => ({ ...save, resources: { ...save.resources, "Town/Gold": 0 } }))
 * ```
 */
export const migration = <const To extends number>(to: To, migrate: (save: WorldSnapshot) => WorldSnapshot): Migration<To> => ({ to, migrate })

type Last<Steps> = Steps extends readonly [...Array<unknown>, infer L extends Migration] ? L["to"] : number

/** `unknown` when the steps are numbered 1, 2, 3, ... in order; otherwise the message naming the misplaced one. */
type Consecutive<Steps, Count extends Array<0> = []> =
  Steps extends readonly [infer Head extends Migration, ...infer Tail]
    ? number extends Head["to"] ? unknown
    : Head["to"] extends [...Count, 0]["length"] ? Consecutive<Tail, [...Count, 0]>
    : { readonly __fixMigrations__: `migration ${Head["to"]} is listed where migration ${[...Count, 0]["length"]} belongs: number migrations 1, 2, 3, ... in order` }
    : unknown

/**
 * A game's save migrations, numbered 1, 2, 3, ... in order (checked at
 * compile time for literal numbers, and at runtime). Pass them to
 * `Game.Runtime.make({ saves })`: `snapshot()` then writes the last number as
 * the save's `gameVersion`, and `restore(data)` runs every step after the
 * save's version, in order, before validating it as usual. A save newer than
 * the last step fails with `NewerGameVersion`. Use it instead of editing raw
 * save data before `restore`.
 *
 * @example
 * ```ts
 * const runtime = Game.Runtime.make({
 *   services,
 *   saves: Snapshot.migrations(
 *     Snapshot.migration(1, (save) => ({ ...save, scopes: {} })),
 *     Snapshot.migration(2, renameGold)
 *   )
 * }).value
 * runtime.restore(raw)
 * ```
 */
export const migrations = <const Steps extends readonly [Migration, ...Array<Migration>]>(
  ...steps: Steps & Consecutive<Steps>
): Migrations<Last<Steps>> => {
  steps.forEach((step, index) => {
    if (step.to !== index + 1) {
      throw new Error(`migration ${step.to} is listed where migration ${index + 1} belongs: number migrations 1, 2, 3, ... in order`)
    }
  })
  return { kind: "SnapshotMigrations", latest: steps.length as Last<Steps>, steps }
}
