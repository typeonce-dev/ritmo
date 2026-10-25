/**
 * Named world checks evaluated after every frame of a session run.
 *
 * An invariant is a `Game.Inspector` whose projection returns a message
 * describing the violation, or `undefined` when the invariant holds. The
 * inspector declares its reads like a system and cannot write, so the check
 * is typed and read-only, and `Session.make` rejects at compile time an
 * invariant that reads a resource, service, or machine the runtime does not
 * provide. The invariant is named after its inspector.
 *
 * Write entities in the message as `e${id}`: a session with `labels` prints
 * each one with its label (`player e12`) in the run summary; the run's
 * `stop.message` keeps the text the inspector returned.
 *
 * Use `Invariant.fromInspector` for checks over the world during a session.
 * Use `Game.Inspector` with `runtime.inspect(...)` directly for one-off reads
 * in tests and scripts.
 *
 * @module Invariant
 * @docGroup devtools
 *
 * @example
 * ```ts
 * const PlayerInsideWorld = Invariant.fromInspector(Game.Inspector("player inside world", {
 *   queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) }
 * }, ({ queries }) => {
 *   for (const { entity, data } of queries.players.each()) {
 *     const { x } = data.position.get()
 *     if (x < 0 || x > WORLD_WIDTH) return `e${entity.id} at x=${x}`
 *   }
 *   return undefined
 * }))
 *
 * const session = Session.make(runtime, { hostClock, schedules: { update }, invariants: [PlayerInsideWorld] })
 * ```
 */
import type * as Inspector from "@typeonce/ritmo/Inspector"

export namespace Invariant {
  /** An inspector usable as an invariant: it returns a violation message or `undefined`. */
  export type CheckInspector = Inspector.InspectorDefinition<any, string | undefined, any, any, any>
}

/** A named read-only world check, made with {@link fromInspector}. */
export interface Invariant<I extends Invariant.CheckInspector = Invariant.CheckInspector> {
  /** The inspector's name, printed when the invariant is violated. */
  readonly name: I["name"]
  /** The read-only check: a violation message, or `undefined` when the invariant holds. */
  readonly inspector: I
}

/**
 * Turns a `Game.Inspector` that returns `string | undefined` into an
 * invariant for `Session.make({ invariants })`.
 */
export const fromInspector = <const I extends Invariant.CheckInspector>(inspector: I): Invariant<I> => ({
  name: inspector.name,
  inspector
})
