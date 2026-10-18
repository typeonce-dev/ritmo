/** Bundle-only wrapper. The native bootstrap injects the backend before the entry runs. */
const symbol = Symbol.for("@typeonce/ritmo/native@0.8")
interface Journal { commit(): void; rollback(): void; release(): void }
interface View { count: number; slots: Int32Array; columns: Float64Array[]; marks: Int32Array[]; layout: { slot: string; name: string; fields: readonly string[] | null; write: boolean }[]; tick: number; prepare(): void; journal(journal: Journal): void }
interface Metadata { id: number; name: string; hash: string; layouts: Record<string, string[] | null>; queries: { name: string; components: { slot: string; name: string; fields: string[] | null; write: boolean }[] }[]; resources: { name: string; fields: string[] | null; offset: number }[] }
export interface Backend { run(id: number, hash: string, queries: View[], resources: Float64Array, tick: number): Journal }
let backend: Backend | undefined
export const install = (value: Backend | undefined): void => { backend = value }
/** Erased only in generated code; original game calls are checked before this transform. */
export const system = (game: { System(name: string, spec: object, callback: (context: any) => any): unknown }, name: string, spec: object, original: (context: any) => any, metadata: Metadata): unknown => {
  const seam = (game as unknown as Record<symbol, { layouts(layouts: Metadata["layouts"]): void }>)[symbol]
  if (!seam) throw new Error(`${name}: native ABI differs from core; install matching @typeonce/ritmo packages`)
  seam.layouts(metadata.layouts)
  return game.System(name, spec, (context) => {
    if (!backend) return original(context)
    const views = metadata.queries.map((q) => context.queries[q.name][symbol]?.view() as View | undefined)
    if (views.some((view) => !view)) return original(context)
    const available = views as View[]
    available.forEach((view, i) => {
      const expected = metadata.queries[i]!.components.map(({ slot, name, fields, write }) => ({ slot, name, fields, write }))
      if (JSON.stringify(view.layout) !== JSON.stringify(expected)) throw new Error(`${name}: native query layout mismatch; rebuild the binary and bundle together`)
    })
    const resources: number[] = []
    for (const r of metadata.resources) {
      const value = context.resources[r.name].get() as number | Record<string, number>
      if (r.fields === null) resources.push(value as number)
      else for (const field of r.fields) resources.push((value as Record<string, number>)[field]!)
    }
    available.forEach((view) => view.prepare())
    const journal = backend.run(metadata.id, metadata.hash, available, Float64Array.from(resources), available[0]!.tick)
    // One world transaction owns every query view in a system.
    available[0]!.journal(journal)
  })
}
