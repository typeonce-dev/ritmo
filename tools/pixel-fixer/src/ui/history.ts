/**
 * Undo and redo over snapshots of the page's settings.
 *
 * Changes are recorded once they settle (`record` after a short quiet
 * moment), so a slider drag, a typed number, or a painted stroke is one step,
 * not one per frame. Undoing first records anything still pending.
 */
export interface History {
  /** Records the current settings once changes stop for a moment. */
  readonly schedule: () => void
  readonly undo: () => void
  readonly redo: () => void
  readonly canUndo: () => boolean
  readonly canRedo: () => boolean
  /** Forgets every step; the next record is the new starting point. */
  readonly reset: () => void
}

/** How long changes must stop before they are one step, in milliseconds. */
const SETTLE = 350
/** The most steps kept. */
const LIMIT = 200

export const makeHistory = (
  capture: () => string,
  restore: (snapshot: string) => void,
  changed: () => void
): History => {
  const past: Array<string> = []
  const future: Array<string> = []
  let current: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const record = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const next = capture()
    if (next === current) return
    if (current !== undefined) {
      past.push(current)
      if (past.length > LIMIT) past.shift()
      future.length = 0
    }
    current = next
    changed()
  }

  const step = (from: Array<string>, to: Array<string>): void => {
    record()
    const snapshot = from.pop()
    if (snapshot === undefined || current === undefined) return
    to.push(current)
    current = snapshot
    restore(snapshot)
    changed()
  }

  return {
    schedule: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(record, SETTLE)
    },
    undo: () => step(past, future),
    redo: () => step(future, past),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    reset: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      past.length = 0
      future.length = 0
      current = undefined
    }
  }
}
