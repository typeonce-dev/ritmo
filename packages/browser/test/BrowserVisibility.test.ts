import { describe, expect, it } from "vitest"

import { BrowserVisibility } from "@typeonce/ritmo-browser"

const fakeDocument = () => {
  const listeners = new Set<() => void>()
  const host = {
    visibilityState: "visible",
    addEventListener: (_type: "visibilitychange", listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: "visibilitychange", listener: () => void) => {
      listeners.delete(listener)
    }
  }
  return {
    host,
    listeners,
    set(state: "visible" | "hidden") {
      host.visibilityState = state
      for (const listener of [...listeners]) listener()
    }
  }
}

describe("BrowserVisibility.make", () => {
  it("reads visibilityState and reports each change until unsubscribed", () => {
    const page = fakeDocument()
    const visibility = BrowserVisibility.make(page.host)
    const seen: Array<boolean> = []
    const unsubscribe = visibility.subscribe((hidden) => seen.push(hidden))
    expect(visibility.hidden()).toBe(false)
    page.set("hidden")
    expect(visibility.hidden()).toBe(true)
    page.set("visible")
    unsubscribe()
    page.set("hidden")
    expect(seen).toEqual([true, false])
    expect(page.listeners.size).toBe(0)
  })
})
