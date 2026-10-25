/**
 * Nominal descriptor constructors for schema authoring.
 *
 * Descriptors are the stable typed identities behind every public ECS surface:
 * schema entries, query slots, system specs, runtime provisioning, long-lived
 * handle intents, and relationships.
 *
 * If `Schema` answers "what world can exist?", descriptors answer "what is
 * each named thing in that world?" They are the vocabulary the rest of the
 * ECS system reuses everywhere else.
 *
 * The normal authoring flow is:
 *
 * 1. declare descriptors with `Descriptor.*`
 * 2. register them in `Schema.fragment(...)`
 * 3. bind one `Game` with `Schema.bind(...)`
 *
 * Reach for this module first whenever you introduce a new component,
 * resource, event, or service to the game. A game-wide mode whose transitions
 * matter is a state machine (`Game.StateMachine(...)`); a state each entity
 * has on its own is a component (`Descriptor.EntityState(...)`).
 *
 * Identity is `(kind, name)`: names are unique per kind across everything
 * bound with `Schema.bind`, and a clash between fragments is rejected there.
 * Prefix every name with the game or package (`"Game/Position"`), as the
 * `ritmo/prefix-descriptor-and-system-names` lint rule requires.
 *
 * @module Descriptor
 * @docGroup core
 *
 * @groupDescription Namespaces
 * Grouped descriptor helper types for narrowing and reflecting descriptor metadata.
 *
 * @groupDescription Interfaces
 * Public descriptor contracts and constructor-aware descriptor variants.
 *
 * @groupDescription Type Aliases
 * Shared descriptor identities and helper types used throughout the ECS surface.
 *
 * @groupDescription Variables
 * Stable runtime markers used to brand descriptor kinds and constructor-aware variants.
 *
 * @groupDescription Functions
 * Authoring helpers for declaring components, resources, services, and events.
 *
 * @example
 * ```ts
 * // Components describe per-entity state that queries can match.
 * const Position = Descriptor.Component<{ x: number; y: number }>()("Game/Position")
 *
 * // Resources describe singleton world data shared across systems.
 * const DeltaTime = Descriptor.Resource<number>()("Game/DeltaTime")
 *
 * // Events describe messages between systems, read once per reader.
 * const DamageTaken = Descriptor.Event<{ amount: number }>()("Game/DamageTaken")
 *
 * // Services describe host capabilities that live outside ECS storage.
 * const Logger = Descriptor.Service<{ log: (message: string) => void }>()("Game/Logger")
 * ```
 */
export type DescriptorTypeId = "~ritmo/Descriptor"
export type DescriptorConstructionTypeId = "~ritmo/DescriptorConstruction"

/**
 * Runtime value for the descriptor type id.
 */
const descriptorTypeId: DescriptorTypeId = "~ritmo/Descriptor"
const descriptorConstructionTypeId: DescriptorConstructionTypeId = "~ritmo/DescriptorConstruction"

/**
 * The public categories of nominal descriptors used by the engine.
 *
 * Descriptors are the strongly typed identities behind components, resources,
 * events, and dependency-injected services.
 */
export type DescriptorKind = "component" | "resource" | "event" | "service"

/**
 * A branded identity for a schema item.
 *
 * Use descriptors instead of strings anywhere data is registered or accessed.
 * They are the foundation for schema typing, query typing, and system specs.
 */
export interface Descriptor<
  out Kind extends DescriptorKind,
  out Name extends string,
  in out Value
> {
  readonly kind: Kind
  readonly name: Name
  readonly key: symbol
  readonly [descriptorTypeId]: {
    readonly _Value: (_: Value) => Value
  }
}

/**
 * The Standard Schema v1 interface (https://standardschema.dev), the one
 * schema contract Ritmo reads. Zod, Valibot, and ArkType schemas are
 * Standard Schemas as they are; an Effect schema goes through the `codec`
 * helper in the skill's `playbooks/effect.md`, which also encodes. `Input` is the saved form a schema
 * decodes, `Output` the value it produces.
 *
 * Ritmo ships no schemas of its own: the game brings them.
 */
export interface StandardSchema<Input, Output> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardSchema.Result<Output> | Promise<StandardSchema.Result<Output>>
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}

export namespace StandardSchema {
  export type Result<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<Issue> }
  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
  }
}

/**
 * A codec: what a constructed component or resource, or a state with data,
 * is validated and saved with. It is a Standard Schema that decodes the
 * saved form (`Encoded`) into the value (`Type`), carrying under `"~encode"`
 * a Standard Schema back to the saved form when the two differ (an
 * `Option`, a `Map`, a `Date`, a class).
 *
 * A schema whose value is already its saved form (plain numbers, strings,
 * arrays, and objects) needs no `"~encode"`, so a Zod, Valibot, or ArkType
 * schema passes as it is. A schema that transforms its value does not
 * compile without one: build it with the skill's helper for Zod or Effect
 * (`playbooks/zod.md`, `playbooks/effect.md`), or write the reverse schema
 * with any library (`{ "~standard": decode["~standard"], "~encode": back }`).
 * The key starts with `~`, like
 * Standard Schema's own, so it never collides with a library's methods (Zod
 * schemas have an `encode()` method). `runtime.snapshot()` runs
 * `"~encode"`, and `runtime.restore(...)` and the raw APIs (`setRaw`,
 * `entryRaw`) run the schema.
 *
 * @example
 * ```ts
 * // A plain value: the schema as it is (Zod here; Valibot and ArkType alike)
 * const Position = Descriptor.ConstructedComponent(z.object({ x: z.number(), y: z.number() }))("Game/Position")
 * // A value that transforms: the schema and its "~encode" (Effect, through the playbook's `codec`)
 * const Inventory = Descriptor.ConstructedComponent(codec(Schema.ReadonlyMap(Schema.String, Schema.Int)))("Game/Inventory")
 * // Any library: the reverse schema by hand (Valibot here)
 * const Born = Descriptor.ConstructedComponent({
 *   "~standard": v.pipe(v.string(), v.isoTimestamp(), v.transform((text) => new Date(text)))["~standard"],
 *   "~encode": v.pipe(v.date(), v.transform((date) => date.toISOString()))
 * })("Game/Born")
 * ```
 */
export type Codec<Type, Encoded = Type> = StandardSchema<Encoded, Type> & {
  readonly "~encode"?: StandardSchema<Type, Encoded> | undefined
}

/** Why a value did not validate: the schema library's own issues, each with its path. */
export interface SchemaIssues {
  readonly _tag: "SchemaIssues"
  readonly issues: ReadonlyArray<StandardSchema.Issue>
}

/** The value a codec decodes to. */
export type CodecType<S> = S extends StandardSchema<infer _Encoded, infer Type> ? Type : never

/** The saved form a codec decodes from (and its `"~encode"` returns). */
export type CodecEncoded<S> = S extends StandardSchema<infer Encoded, infer _Type> ? Encoded : never

// `true` when every value of `T` survives `JSON.stringify` unchanged:
// primitives, arrays, and objects of them. Symbol keys are phantom brands.
type PlainData<T, Depth extends ReadonlyArray<0> = []> = unknown extends T ? true
  : Depth["length"] extends 10 ? true
  : T extends string | number | boolean | null | undefined ? true
  : T extends (...args: ReadonlyArray<any>) => unknown ? false
  : T extends ReadonlyArray<infer Item> ? PlainData<Item, [...Depth, 0]>
  : T extends object ? { readonly [K in keyof T]-?: K extends symbol ? true : PlainData<T[K], [...Depth, 0]> }[keyof T] | true
  : false

type PlainEncoded<Encoded> = false extends PlainData<Encoded>
  ? "the saved form of this schema is not plain data: decode it from numbers, strings, booleans, null, arrays, and objects"
  : never

/** The message naming what is wrong with schema `S`, or `never` when Ritmo can validate and save with it. */
export type CodecRejection<S> = S extends StandardSchema<infer Encoded, infer Type>
  ? S extends { readonly "~encode": StandardSchema<infer EncodeInput, infer EncodeOutput> }
    ? [Type] extends [EncodeInput]
      ? [EncodeOutput] extends [Encoded] ? PlainEncoded<Encoded>
      : "its ~encode does not return the saved form the schema decodes: make ~encode the schema's inverse"
    : "its ~encode does not take the value the schema decodes: make ~encode the schema's inverse"
  : [Type] extends [Encoded] ? PlainEncoded<Encoded>
  : "this schema changes its value when it decodes (an Option, a Map, a Date, a class): give it a ~encode schema back to the saved form (the skill's codec helper for Zod or Effect, or the reverse schema by hand)"
  : never

/** The schema argument of a constructed descriptor, or the message naming what is wrong with it. */
export type CheckedCodec<S> = [CodecRejection<S>] extends [never] ? unknown : { readonly __fixCodec__: CodecRejection<S> }

/**
 * Descriptor whose values are validated by a schema: raw input
 * (`setRaw`, `entryRaw`, raw values given to `Game.Runtime.make`) and saved
 * values are decoded by it, and `runtime.snapshot()` encodes with it. `Raw`
 * is the saved form.
 */
export interface ConstructedDescriptor<
  out Kind extends DescriptorKind,
  out Name extends string,
  in out Value,
  Raw,
  Error
> extends Descriptor<Kind, Name, Value> {
  readonly [constructionKey]: Construction
  readonly [descriptorConstructionTypeId]: {
    readonly _Raw: (_: never) => Raw
    readonly _Error: (_: never) => Error
  }
}

/**
 * Descriptor whose values are runtime-only: snapshots skip it.
 *
 * Use it for state that should not be saved or cannot be serialized, such as
 * per-frame input, caches, or references to host objects. On restore,
 * transient components are absent from restored entities and transient
 * resources keep their current value.
 */
export interface TransientDescriptor<
  out Kind extends "component" | "resource",
  out Name extends string,
  in out Value
> extends Descriptor<Kind, Name, Value> {
  readonly transient: true
}

/**
 * Marks a component that is never edited in place: `Game.Query.write(...)`
 * rejects it, and the only way to change its value is to replace it with
 * `commands.insert(...)` (applied at `applyDeferred()`, seen by
 * `Game.Query.changed(...)`).
 */
export interface Immutable {
  readonly immutable: true
}

/**
 * Options of the component descriptor constructors (`Component`,
 * `ConstructedComponent`, `TransientComponent`).
 */
export interface ComponentOptions {
  /**
   * `true` for data that says what an entity is (a kind, a team, a tile) and
   * is replaced, never edited: queries can only read it, and
   * `commands.insert(...)` replaces it. Leave it out for state that systems
   * update every frame.
   */
  readonly immutable?: true
}

/** The descriptor a component constructor returns for `Options`: `D`, plus `Immutable` when `immutable: true`. */
export type WithComponentOptions<D, Options extends ComponentOptions> =
  Options extends { readonly immutable: true } ? D & Immutable : D

const applyComponentOptions = <D extends object>(descriptor: D, options: ComponentOptions | undefined): D =>
  options?.immutable === true ? { ...descriptor, immutable: true } : descriptor

/**
 * Whether a component descriptor was declared `immutable: true` (readable by
 * queries, replaced only with `commands.insert(...)`).
 */
export const isImmutable = (descriptor: Descriptor.Any): descriptor is Descriptor.Any & Immutable =>
  "immutable" in descriptor && descriptor.immutable === true

/**
 * Type-level helpers for working with descriptors.
 */
export namespace Descriptor {
  /**
   * Any supported descriptor.
   */
  export type Any = Descriptor<DescriptorKind, string, any>
  export type AnyConstructed = ConstructedDescriptor<DescriptorKind, string, any, any, any>
  export type AnyTransient = TransientDescriptor<"component" | "resource", string, any>
  /**
   * Extracts the runtime value associated with a descriptor.
   */
  export type Value<T extends Any> = T extends Descriptor<infer _Kind, infer _Name, infer Value> ? Value : never
  /**
   * Extracts the descriptor name.
   */
  export type Name<T extends Any> = T extends Descriptor<infer _Kind, infer Name, infer _Value> ? Name : never
  export type Raw<T extends Any> = T extends ConstructedDescriptor<infer _Kind, infer _Name, infer _Value, infer Raw, infer _Error>
    ? Raw
    : never
  export type ConstructionError<T extends Any> =
    T extends ConstructedDescriptor<infer _Kind, infer _Name, infer _Value, infer _Raw, infer Error>
      ? Error
      : never
}

/**
 * Internal descriptor constructor shared by all descriptor helpers.
 *
 * The runtime value is intentionally tiny: only category, name, and a stable
 * symbol key are needed.
 */
const makeDescriptor = <Kind extends DescriptorKind, Name extends string, Value>(
  kind: Kind,
  name: Name
): Descriptor<Kind, Name, Value> =>
  ({
    kind,
    name,
    key: Symbol.for(`ritmo/${kind}/${name}`)
  }) as Descriptor<Kind, Name, Value>

const makeTransientDescriptor = <Kind extends "component" | "resource", Name extends string, Value>(
  kind: Kind,
  name: Name
): TransientDescriptor<Kind, Name, Value> =>
  ({
    kind,
    name,
    key: Symbol.for(`ritmo/${kind}/${name}`),
    transient: true
  }) as TransientDescriptor<Kind, Name, Value>

const makeConstructedDescriptor = <
  Kind extends DescriptorKind,
  Name extends string,
  Value,
  Raw,
  Error
>(
  kind: Kind,
  name: Name,
  schema: Codec<unknown, unknown>
): ConstructedDescriptor<Kind, Name, Value, Raw, Error> =>
  ({
    kind,
    name,
    key: Symbol.for(`ritmo/${kind}/${name}`),
    [constructionKey]: construction(schema)
  }) as unknown as ConstructedDescriptor<Kind, Name, Value, Raw, Error>

/**
 * The message naming why `Value` cannot be the value of a descriptor of
 * `Kind`, or `never` when it can. `any` turns off every check on the
 * descriptor's reads and writes, and `never` erases the fragment it is listed in.
 */
type Article<Kind extends string> = Kind extends "event" ? "an" : "a"

type ValueRejection<Kind extends string, Value> = 0 extends 1 & Value
  ? `${Article<Kind>} ${Kind} value cannot be \`any\`: give it a type (use \`unknown\` for a value you never read)`
  : [Value] extends [never] ? `${Article<Kind>} ${Kind} value cannot be \`never\`: give it a type (use \`{}\` for a marker)`
  : never

/** `Make`, or, when `Value` is rejected, a function whose only parameter is the message. */
type CheckedValue<Kind extends string, Value, Make> = [ValueRejection<Kind, Value>] extends [never] ? Make
  : (name: ValueRejection<Kind, Value>) => never

/**
 * Defines a component descriptor.
 *
 * Use this when declaring per-entity data that should participate in queries
 * and typed entity proofs.
 *
 * Components are the only descriptor kind that can be queried directly with
 * `Game.Query.read(...)`, `write(...)`, or `optional(...)`.
 *
 * The value is a real type: `any` and `never` do not compile (here and in
 * every other descriptor constructor). Use `unknown` for a value no system
 * reads, and `Descriptor.Tag` for a marker.
 *
 * @example
 * ```ts
 * const Position = Descriptor.Component<{ x: number; y: number }>()("Game/Position")
 * // What an entity is, replaced with commands.insert and never written by a query:
 * const EnemyKind = Descriptor.Component<"grunt" | "boss">()("Game/EnemyKind", { immutable: true })
 * ```
 */
export const Component = <Value>(): CheckedValue<"component", Value, <const Name extends string, const Options extends ComponentOptions = {}>(
  name: Name,
  options?: Options
) => WithComponentOptions<Descriptor<"component", Name, Value>, Options>> =>
  ((name: string, options?: ComponentOptions) => applyComponentOptions(makeDescriptor("component", name), options)) as never

/**
 * Defines a component descriptor whose values are validated by a schema the
 * game brings (any Standard Schema, see {@link Codec}): raw input
 * (`setRaw`, `Game.Command.entryRaw`) and saved values are decoded by it,
 * and snapshots save its values through its `"~encode"`.
 *
 * Use this for every component a snapshot saves, and for values that should
 * never exist in the world in an unvalidated shape (vectors, sizes, ids).
 * `Raw` (what the raw APIs take) is the schema's saved form.
 *
 * @example
 * ```ts
 * const Position = Descriptor.ConstructedComponent(z.object({ x: z.number(), y: z.number() }))("Game/Position")
 * const Velocity = Descriptor.ConstructedComponent(Vector2.schema)("Game/Velocity")
 * ```
 */
export const ConstructedComponent = <const S extends Codec<any, any>>(
  schema: S & CheckedCodec<S>
) => <const Name extends string, const Options extends ComponentOptions = {}>(
  name: Name,
  options?: Options
): WithComponentOptions<ConstructedDescriptor<"component", Name, CodecType<S>, CodecEncoded<S>, SchemaIssues>, Options> =>
  applyComponentOptions(makeConstructedDescriptor("component", name, schema), options) as WithComponentOptions<ConstructedDescriptor<"component", Name, CodecType<S>, CodecEncoded<S>, SchemaIssues>, Options>

/**
 * Defines a component descriptor that snapshots skip.
 *
 * Restored entities come back without it, so systems that need it rebuild it,
 * for example from an `added(...)` query.
 *
 * @example
 * ```ts
 * const SpriteRef = Descriptor.TransientComponent<{ frame: number }>()("Game/SpriteRef")
 * ```
 */
export const TransientComponent = <Value>(): CheckedValue<"component", Value, <const Name extends string, const Options extends ComponentOptions = {}>(
  name: Name,
  options?: Options
) => WithComponentOptions<TransientDescriptor<"component", Name, Value>, Options>> =>
  ((name: string, options?: ComponentOptions) => applyComponentOptions(makeTransientDescriptor("component", name), options)) as never

/**
 * Defines a marker component: no data, only presence (`[Player, {}]`).
 *
 * Tags validate on load like any constructed component, so they never block
 * snapshots.
 *
 * @example
 * ```ts
 * const Player = Descriptor.Tag("Game/Player")
 * const Enemy = Descriptor.Tag("Game/Enemy")
 * ```
 */
export const Tag = <const Name extends string>(
  name: Name
): ConstructedDescriptor<"component", Name, {}, {}, SchemaIssues> =>
  makeConstructedDescriptor("component", name, tagSchema)

const tagSchema = standard<{}>((raw) =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw) ? ResultModule.success({}) : ResultModule.failure("Expected an object")
)

/**
 * One state of an {@link EntityState} component or a `Game.StateMachine(...)`:
 * `{}` for a state without data, or the {@link Codec} of the state's data
 * (an object of fields, without `_tag`, which holds the state's name).
 */
export type StateDefinition = Readonly<Record<string, never>> | Codec<object, unknown>

/**
 * Every state of an entity state or a state machine, by state name: each a
 * {@link StateDefinition} (`CheckedStates` names what is wrong with one that
 * is not).
 */
export type StateDefinitions = Readonly<Record<string, object>>

/** The name of a state in `States`. */
export type StateName<States extends StateDefinitions> = keyof States & string

/** The data of one state: its schema's value, or nothing for `{}`. */
type StateData<Definition> = Definition extends StandardSchema<infer _Encoded, infer Data> ? Data : {}

/**
 * The value of state `State` (of every state, for a union): its name in
 * `_tag`, and its data. Use {@link EntityStateOf} or `Machine.StateOf` in
 * game code.
 */
export type StateValueOf<States extends StateDefinitions, State extends StateName<States>> = State extends unknown
  ? { readonly _tag: State } & StateData<States[State]> extends infer Value
    ? { readonly [Key in keyof Value]: Value[Key] }
    : never
  : never

/** The saved form of every state's value: its name in `_tag`, next to its data's saved form. */
export type StateEncodedOf<States extends StateDefinitions> = {
  readonly [State in StateName<States>]: { readonly _tag: State } & (States[State] extends StandardSchema<infer Encoded, infer _Data> ? Encoded : {}) extends infer Value
    ? { readonly [Key in keyof Value]: Value[Key] }
    : never
}[StateName<States>]

/**
 * The allowed moves of a {@link EntityState} component: for every state, the
 * states it may move to (`[]` for a state with no way out).
 */
export type EntityStateTransitions<States extends StateDefinitions> = {
  readonly [From in keyof States & string]: ReadonlyArray<keyof States & string>
}

/**
 * A component whose value is one of a closed set of states, each with its own
 * data, and an optional graph of allowed moves. Built with {@link EntityState}.
 */
export interface EntityStateDescriptor<
  out Name extends string,
  in out States extends StateDefinitions,
  in out Transitions extends EntityStateTransitions<States> | undefined
> extends ConstructedDescriptor<
  "component",
  Name,
  StateValueOf<States, StateName<States>>,
  StateEncodedOf<States>,
  SchemaIssues
> {
  readonly states: States
  readonly transitions: Transitions
}

/**
 * The value of an entity state component, or of one of its states: what
 * game functions that work on the state take and return.
 *
 * @example
 * ```ts
 * const fall = (air: Descriptor.EntityStateOf<typeof Contact, "air">, gravity: number) => air.vy - gravity
 * const describe = (contact: Descriptor.EntityStateOf<typeof Contact>) => contact._tag
 * ```
 */
export type EntityStateOf<
  D extends EntityStateDescriptor<string, any, any>,
  State extends keyof D["states"] & string = keyof D["states"] & string
> = StateValueOf<D["states"], State>

/**
 * The `states` argument of an entity state or a state machine, or the message
 * naming what is wrong with it: `Empty` is the message for a record without
 * states.
 */
export type CheckedStates<States extends StateDefinitions, Empty extends string> = [StateName<States>] extends [never]
  ? { readonly [Message in Empty]: StateDefinition }
  : { readonly [State in keyof States]: StateRejection<States[State]> }

type StateRejection<Definition> = Definition extends StandardSchema<infer _Encoded, infer Data>
  ? [CodecRejection<Definition>] extends [never]
    ? Data extends ReadonlyArray<unknown> ? { readonly __fixState__: "a state's data is an object of fields: decode it with an object schema" }
    : "_tag" extends keyof Data ? { readonly __fixState__: "`_tag` holds the state's name: give this field another name" }
    : unknown
  : CheckedCodec<Definition>
  : keyof Definition extends never ? unknown
  : { readonly __fixState__: "a state is `{}` or one schema for all of its data: wrap the fields in your library's object schema" }

/**
 * Defines a per-entity state: a component whose value is one of `states`,
 * each with its own fields, validated (so snapshots reject unknown states and
 * wrong fields), that behaves like any other component (storage, change
 * detection, rollback, traces).
 *
 * Use this when each entity has its own state: an enemy's attack windup, a
 * fighter on the ground or in the air, a unit's AI mode. Give each state the
 * data only it has (an airborne speed, a hitstun length), so a value can
 * never pair a state with data that does not belong to it. Data every state
 * shares stays in another component. Use `Game.StateMachine(...)` instead for
 * one game-wide mode (menu, playing, paused, game over): machines change only
 * at `applyStateTransitions(...)`, run `onEnter`/`onExit` schedules, and gate
 * systems with `Game.Condition.inState(...)`. An entity state does none of
 * that; it is data on an entity. A closed set of values with no moves (a
 * team, a direction) is a `Descriptor.ConstructedComponent(...)` with your
 * library's literal schema.
 *
 * The value is a tagged union: `_tag` is the state's name, next to that
 * state's fields. Its write cell moves with `transition({ from, to, data })`,
 * which takes all of `to`'s fields so nothing carries over from `from`, and
 * changes the current state's fields with `update({ state, data })`. Both are
 * a compare-and-set: they write only while the entity is still in `from` (or
 * `state`), and otherwise return an `EntityStateMismatch` failure. With
 * `transitions`, `to` is checked against the graph at compile time; the graph
 * lists every state (`[]` for one with no way out). Writes are ordinary
 * component writes: immediate, visible to later systems, rolled back with a
 * failed system. There are no per-state schedules: branch on `get()._tag` in
 * the system that owns the component, and emit an event on a transition
 * other systems must react to.
 *
 * @example
 * ```ts
 * const Contact = Descriptor.EntityState("Game/Contact", {
 *   ground: z.object({ platform: z.int().nullable() }),
 *   air: z.object({ vy: z.number(), coyote: z.int() })
 * }, { transitions: { ground: ["air"], air: ["ground"] } })
 *
 * commands.spawn(Game.Command.spawn([Contact, { _tag: "ground", platform: null }]))
 * // in a system with a write slot `contact`:
 * data.contact.transition({ from: "ground", to: "air", data: { vy: 12, coyote: 0 } })
 * data.contact.update({ state: "air", data: (air) => ({ ...air, vy: air.vy - gravity }) })
 * ```
 */
export const EntityState = <
  const Name extends string,
  const States extends StateDefinitions,
  const Transitions extends EntityStateTransitions<States> | undefined = undefined
>(
  name: Name,
  states: States & CheckedStates<States, "an entity state needs at least one state">,
  options?: {
    readonly transitions: Transitions & { readonly [Key in Exclude<keyof Transitions, keyof States>]: never }
  }
): EntityStateDescriptor<Name, States, Transitions> => ({
  ...makeConstructedDescriptor("component", name, stateCodec(states)),
  states,
  transitions: options?.transitions
}) as unknown as EntityStateDescriptor<Name, States, Transitions>

/** Whether a descriptor was built with {@link EntityState}. */
export const isEntityState = (
  descriptor: Descriptor.Any
): descriptor is EntityStateDescriptor<string, StateDefinitions, EntityStateTransitions<StateDefinitions> | undefined> =>
  "states" in descriptor

/**
 * Defines a resource descriptor.
 *
 * Resources represent unique world-level values accessed through explicit
 * system specs.
 *
 * Use resources for singleton world data such as counters, configuration,
 * global timers, camera summaries, or transient per-frame aggregates that
 * should not be duplicated across entities.
 *
 * @example
 * ```ts
 * // Store shared world state once and request it explicitly from systems.
 * const Score = Descriptor.Resource<number>()("Game/Score")
 * ```
 */
export const Resource = <Value>(): CheckedValue<"resource", Value, <const Name extends string>(
  name: Name
) => Descriptor<"resource", Name, Value>> => ((name: string) => makeDescriptor("resource", name)) as never

/**
 * Defines a resource descriptor whose value is validated by a schema the
 * game brings (see {@link ConstructedComponent}): raw values given to
 * `Game.Runtime.make`, `setRaw`, and saved values are decoded by it, and
 * snapshots save it through its `"~encode"`.
 *
 * @example
 * ```ts
 * const Gold = Descriptor.ConstructedResource(z.number().int().nonnegative())("Game/Gold")
 * ```
 */
export const ConstructedResource = <const S extends Codec<any, any>>(
  schema: S & CheckedCodec<S>
) => <const Name extends string>(
  name: Name
): ConstructedDescriptor<"resource", Name, CodecType<S>, CodecEncoded<S>, SchemaIssues> =>
  makeConstructedDescriptor("resource", name, schema)

/**
 * Defines a resource descriptor that snapshots skip. Restoring keeps its
 * current value.
 *
 * @example
 * ```ts
 * const DeltaTime = Descriptor.TransientResource<number>()("Game/DeltaTime")
 * ```
 */
export const TransientResource = <Value>(): CheckedValue<"resource", Value, <const Name extends string>(
  name: Name
) => TransientDescriptor<"resource", Name, Value>> => ((name: string) => makeTransientDescriptor("resource", name)) as never

/**
 * Defines an event descriptor.
 *
 * Use event descriptors to model append-only messages flowing between systems
 * without exposing untyped channels.
 *
 * Events are per-reader streams, like change detection: each reading system
 * sees the events published since its own previous run, once, in emission
 * order. A system's events are published when it completes successfully, so
 * later systems in the same schedule see them, and a failed system publishes
 * nothing. Events are kept until every system that reads them has run (see
 * `Game.System.readEvent`).
 *
 * @example
 * ```ts
 * const Hit = Descriptor.Event<{ target: number; amount: number }>()("Game/Hit")
 * ```
 */
export const Event = <Value>(): CheckedValue<"event", Value, <const Name extends string>(
  name: Name
) => Descriptor<"event", Name, Value>> => ((name: string) => makeDescriptor("event", name)) as never

/**
 * Defines a service descriptor.
 *
 * Services are the dependency-injection side of the system model, similar to
 * Effect environment entries.
 *
 * Use them for capabilities owned by the host instead of the ECS world:
 * render/audio bridges, logs, storage, or network clients. Simulation time
 * is `Clock` and randomness is the `Random` resource from
 * `@typeonce/ritmo-math`, not services. Systems request them explicitly with
 * `Game.System.service(...)` (or `Game.System.consumeService(...)` for the
 * one system that drains it), and the runtime provides them through
 * `Game.Runtime.services(...)`. A service's effects (a sound played, a
 * request sent, a value stored) are not rolled back when the system fails.
 *
 * @example
 * ```ts
 * // Describe one host capability the runtime must provide.
 * const Logger = Descriptor.Service<{ log: (message: string) => void }>()("Game/Logger")
 * ```
 */
export const Service = <Value>(): CheckedValue<"service", Value, <const Name extends string>(
  name: Name
) => Descriptor<"service", Name, Value>> => ((name: string) => makeDescriptor("service", name)) as never

/**
 * Checks whether one descriptor is transient (skipped by snapshots).
 */
export const isTransient = (descriptor: Descriptor.Any): descriptor is Descriptor.AnyTransient =>
  "transient" in descriptor && descriptor.transient === true

/**
 * Checks whether one descriptor is validated by a schema.
 */
export const hasConstructor = (descriptor: Descriptor.Any): descriptor is Descriptor.AnyConstructed =>
  constructionKey in descriptor

/**
 * Defines the canonical parent/children relationship pair.
 *
 * The returned `relation` is the source-of-truth edge component, while
 * `related` is the reverse collection maintained by the runtime.
 *
 * Use hierarchy when the relationship must support ordered children,
 * ancestor/descendant traversal, and linked recursive despawn. Use
 * `Game.EntityScope(...)` instead when entities only share a lifetime (a
 * level, a menu) and need no tree, order, or traversal.
 */
export const Hierarchy = <const Name extends string, const RelatedName extends string>(
  name: Name,
  relatedName: RelatedName
) => makePair("hierarchy", name, relatedName)

/**
 * Defines a general relationship pair with direct edges and reverse lookups.
 *
 * Use a general relation when you need direct source -> target edges plus
 * reverse lookup, but not hierarchy-only behavior such as tree traversal or
 * child reordering.
 */
export const Relation = <const Name extends string, const RelatedName extends string>(
  name: Name,
  relatedName: RelatedName
) => makePair("relation", name, relatedName)
import type { Construction } from "./internal/schema.ts"
import { construction, constructionKey, standard } from "./internal/schema.ts"
import { makePair } from "./internal/relations.ts"
import { stateCodec } from "./internal/states.ts"
import * as ResultModule from "./Result.ts"
