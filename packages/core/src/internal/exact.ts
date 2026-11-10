/** Every key of every member of a union (a union of shapes has only their shared keys). */
type KeysOfAny<T> = T extends unknown ? keyof T : never

/**
 * The fields of `Next` that no shape of `T` has: `never` unless `Next` is a
 * plain object (not a primitive, branded or not) and `T` has fixed keys
 * (no index signature). Shared by the checks that reject a field a value
 * does not have: `update` results (`Query.ExactUpdate`), command entries
 * (`Command.ExactEntries`), and initial resources (`Runtime.ExactResources`).
 */
export type ExtraFields<T, Next> =
  0 extends 1 & Next ? never
  : unknown extends T ? never
  // A branded primitive (`Random.State`) carries its brand as a field.
  : Next extends string | number | boolean | bigint | symbol ? never
  : Next extends ReadonlyArray<unknown> | ((...args: ReadonlyArray<any>) => unknown) | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> ? never
  : Next extends object
    ? string extends KeysOfAny<T> ? never : Exclude<keyof Next, KeysOfAny<T>>
  : never

/**
 * The keys a value of `T` may have without `ExtraFields` rejecting one:
 * every key of a plain object, and any key where it does not check (a
 * primitive, a collection, a function, an index signature, `unknown`).
 * Computed once per component, it lets `Command.ExactEntries` test the
 * common case with `keyof` instead of `ExtraFields` per call.
 */
export type CheckedKeys<T> =
  0 extends 1 & T ? PropertyKey
  : unknown extends T ? PropertyKey
  : [T] extends [string | number | boolean | bigint | symbol | null | undefined | ReadonlyArray<unknown> | ((...args: ReadonlyArray<any>) => unknown) | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>] ? PropertyKey
  : string extends KeysOfAny<T> ? PropertyKey
  : KeysOfAny<T>
