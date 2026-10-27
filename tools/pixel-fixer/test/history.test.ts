import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { makeHistory } from "../src/ui/history.ts"

describe("history", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    let value = "a"
    const history = makeHistory(
      () => value,
      (snapshot) => {
        value = snapshot
      },
      () => {}
    )
    const set = (next: string): void => {
      value = next
      history.schedule()
    }
    history.schedule()
    vi.runAllTimers()
    return { history, set, get: () => value }
  }

  it("undoes and redoes settled changes, one step each", () => {
    const { history, set, get } = setup()
    expect(history.canUndo()).toBe(false)
    set("b")
    vi.runAllTimers()
    set("c")
    vi.runAllTimers()
    history.undo()
    expect(get()).toBe("b")
    history.undo()
    expect(get()).toBe("a")
    expect(history.canUndo()).toBe(false)
    history.redo()
    history.redo()
    expect(get()).toBe("c")
    expect(history.canRedo()).toBe(false)
  })

  it("makes a burst of changes one step, and records it before undoing", () => {
    const { history, set, get } = setup()
    set("b")
    set("c")
    set("d")
    history.undo()
    expect(get()).toBe("a")
  })

  it("drops the redo steps when a new change comes in", () => {
    const { history, set, get } = setup()
    set("b")
    vi.runAllTimers()
    history.undo()
    set("x")
    vi.runAllTimers()
    expect(history.canRedo()).toBe(false)
    history.undo()
    expect(get()).toBe("a")
  })

  it("starts over on reset", () => {
    const { history, set } = setup()
    set("b")
    vi.runAllTimers()
    history.reset()
    set("c")
    vi.runAllTimers()
    expect(history.canUndo()).toBe(false)
  })
})
