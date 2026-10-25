/**
 * Root barrel for the public library surface.
 *
 * Consumers should typically import from this file so the package presents a
 * small number of stable namespaces instead of many deep internal paths.
 */
/**
 * Brand types for Ritmo's own validated values (`Random.State`,
 * `Clock.Deadline`). Game code brands through its schema library instead.
 */
export * as Brand from "./Brand.ts"
/**
 * Opt-in runtime introspection for tools and agents.
 */
export * as Debug from "./Debug.ts"
/**
 * Rewind a runtime in memory, for rollback netcode and client prediction.
 */
export * as Checkpoint from "./Checkpoint.ts"
/**
 * Simulation time: the fixed step, the clock resource, durations in whole steps.
 */
export * as Clock from "./Clock.ts"
/**
 * Descriptor authoring helpers.
 */
export * as Descriptor from "./Descriptor.ts"
/**
 * Entity identity and proof helpers.
 */
export * as Entity from "./Entity.ts"
/**
 * Entity lifetime scopes used by scene and level ownership patterns.
 */
export * as EntityScope from "./EntityScope.ts"
/**
 * Fixed-step timing for any host: clamping, catch-up limits, interpolation.
 */
export * as FixedLoop from "./FixedLoop.ts"
/**
 * The host's wall clock as an injected contract (`standard`, `test()`).
 */
export * as HostClock from "./HostClock.ts"
/**
 * Read-only typed world projections.
 */
export * as Inspector from "./Inspector.ts"
/**
 * Math functions that return the same bits on every engine, for simulation code.
 */
export * as Ops from "./Ops.ts"
/**
 * Deterministic random numbers whose whole state is one integer, kept in a resource.
 */
export * as Random from "./Random.ts"
/**
 * Explicit success/failure helpers.
 */
export * as Result from "./Result.ts"
/**
 * Runtime requirement tokens and normalization helpers.
 */
export * as Requirement from "./Requirement.ts"
/**
 * Save and load the world as plain data.
 */
export * as Snapshot from "./Snapshot.ts"
/**
 * Schema authoring and binding helpers.
 */
export * as Schema from "./Schema.ts"
