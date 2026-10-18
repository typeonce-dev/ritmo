import { expect, it } from "vitest"
import { structuredClone as nativeClone } from "@typeonce/ritmo-native/internal/clone.ts"
it("matches structuredClone for the data shapes used by native games", () => {
  const buffer = new ArrayBuffer(32), shared = { x: -0, y: NaN }
  const source = { shared, again: shared, map: new Map([[shared, new Set([shared])]]), date: new Date(1234), pattern: /a/gi, buffer, view: new Float64Array(buffer, 8, 2), hole: [, 1] }
  source.view[0] = Number.MIN_VALUE
  const copied = nativeClone(source), expected = structuredClone(source)
  expect(copied).toEqual(expected); expect(copied.shared).toBe(copied.again)
  expect(copied.view.buffer).toBe(copied.buffer); expect(copied.buffer).not.toBe(buffer)
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
  const cycle = nativeClone(cyclic); expect(cycle.self).toBe(cycle)
  expect(() => nativeClone(() => 1)).toThrow("cannot be structured-cloned")
  expect(() => nativeClone(Symbol())).toThrow("cannot be structured-cloned")
})
