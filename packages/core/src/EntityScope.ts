/**
 * Typed ownership scopes for groups of runtime entities.
 *
 * An entity scope is a lifetime token, not a component and not proof that an
 * entity is alive. Systems can spawn entities into a scope and later queue one
 * deferred cleanup for the complete group. This is the small piece needed to
 * build scenes without teaching the ECS runtime about menus, levels, overlays,
 * or any other game-specific scene model.
 *
 * Use a scope when a set of entities shares one lifetime and nothing else: a
 * level's walls, a menu's buttons. Membership is flat, unordered, and not
 * queryable. Use `Descriptor.Hierarchy(...)` instead when entities form a
 * parent-child tree: ordered children, `lookup.parent` / `descendants`
 * traversal, and children despawned with their parent.
 *
 * A scope whose lifetime is a game state declares it:
 * `Game.EntityScope(name, { despawnOnExit: [Flow, "Playing"] })` despawns
 * every member when `applyStateTransitions(...)` commits that state change,
 * with no system, permission, or marker to place.
 *
 * @module EntityScope
 * @docGroup core
 */

/** A nominal entity-lifetime scope tied to one bound game root. */
export interface EntityScope<
  out Name extends string = string,
  out Root = unknown
> {
  readonly kind: "entityScope"
  readonly name: Name
  readonly key: symbol
  /** State changes that despawn every member, applied by `applyStateTransitions(...)`. */
  readonly despawnOn: ReadonlyArray<Trigger>
  readonly __schemaRoot?: Root | undefined
}

/**
 * One state change that despawns a scope: leaving (`exit`) or entering
 * (`enter`) `state` of `machine`.
 */
export interface Trigger {
  readonly phase: "enter" | "exit"
  readonly machine: { readonly key: symbol; readonly name: string }
  readonly state: string | number
}

/** Type-level helpers for entity scopes. */
export namespace EntityScope {
  /** Any entity scope, whatever its name and game; a bound for generic code. */
  export type Any = EntityScope<string, any>
  /** The scope's name, as passed to `Game.EntityScope(name, ...)`. */
  export type Name<T extends Any> = T["name"]
  /** The game root a scope belongs to. */
  export type Root<T extends Any> = T extends EntityScope<string, infer Root> ? Root : never
}

/**
 * Creates one canonical entity-scope token.
 *
 * Normal game code should use `Game.EntityScope(...)` so the returned token is
 * branded to that game's root.
 */
export const make = <const Name extends string, Root = unknown>(
  name: Name,
  despawnOn: ReadonlyArray<Trigger> = []
): EntityScope<Name, Root> => ({
  kind: "entityScope",
  name,
  key: keyOf(name),
  despawnOn
})

const keyPrefix = "ritmo/entityScope/"

/** The storage key of the scope named `name`: the same for every scope value of that name. */
export const keyOf = (name: string): symbol => Symbol.for(`${keyPrefix}${name}`)

/** The name of the scope behind a storage key made by {@link keyOf}. */
export const nameOf = (key: symbol): string | undefined => {
  const description = Symbol.keyFor(key)
  return description?.startsWith(keyPrefix) ? description.slice(keyPrefix.length) : undefined
}
