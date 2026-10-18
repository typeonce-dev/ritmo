/** The data-only structured clone operation for hosts without the Web API. */
export const structuredClone = <T>(value: T, options?: { readonly transfer?: readonly unknown[] }): T => {
  if (options?.transfer?.length) throw new Error("Native structuredClone does not support transfer lists; clone buffers without transferring ownership")
  const copies = new Map<object, unknown>()
  const invalid = (): never => { const error = new Error("Value cannot be structured-cloned; use plain data, collections, dates or numeric buffers"); error.name = "DataCloneError"; throw error }
  const clone = (source: unknown): unknown => {
    if (typeof source === "function" || typeof source === "symbol") return invalid()
    if (source === null || typeof source !== "object") return source
    if (copies.has(source)) return copies.get(source)
    if (source instanceof Date) { const next = new Date(source.getTime()); copies.set(source, next); return next }
    if (source instanceof RegExp) { const next = new RegExp(source.source, source.flags); copies.set(source, next); return next }
    if (source instanceof ArrayBuffer) { const next = source.slice(0); copies.set(source, next); return next }
    if (ArrayBuffer.isView(source)) {
      const buffer = clone(source.buffer) as ArrayBuffer
      const next = source instanceof DataView ? new DataView(buffer, source.byteOffset, source.byteLength)
        : new (source.constructor as { new(buffer: ArrayBuffer, offset: number, length: number): ArrayBufferView })(buffer, source.byteOffset, source.byteLength / (source as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT)
      copies.set(source, next); return next
    }
    if (source instanceof Map) { const next = new Map(); copies.set(source, next); for (const [key, val] of source) next.set(clone(key), clone(val)); return next }
    if (source instanceof Set) { const next = new Set(); copies.set(source, next); for (const val of source) next.add(clone(val)); return next }
    if (source instanceof Error) {
      const next = new Error(source.message); next.name = source.name; copies.set(source, next)
      if (source.cause !== undefined) next.cause = clone(source.cause)
      if (source.stack !== undefined) next.stack = source.stack
      return next
    }
    if (source instanceof WeakMap || source instanceof WeakSet || source instanceof Promise || Object.prototype.toString.call(source) !== "[object Object]" && !Array.isArray(source)) return invalid()
    const next: object = Array.isArray(source) ? new Array(source.length) : {}
    copies.set(source, next)
    for (const key of Object.keys(source)) Object.defineProperty(next, key, { value: clone((source as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true })
    return next
  }
  return clone(value) as T
}
