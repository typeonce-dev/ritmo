/** A stand-in for `Ops` from `@typeonce/ritmo`, so the fixture resolves on its own: only operations that are exact on every engine. */
export const square = (x: number): number => x * x
export const sin = (x: number): number => x - (x * x * x) / 6 + (x ** 2 * x ** 2 * x) / 120
