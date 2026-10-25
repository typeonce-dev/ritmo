import { BrowserVisibility } from "@typeonce/ritmo-browser"
import { describe, expect, it } from "tstyche"

describe("BrowserVisibility.make", () => {
  it("takes the document and returns hidden and subscribe", () => {
    expect(BrowserVisibility.make(document)).type.toBe<{
      readonly hidden: () => boolean
      readonly subscribe: (listener: (hidden: boolean) => void) => () => void
    }>()
  })

  it("rejects a host without visibilityState", () => {
    // @ts-expect-error Property 'visibilityState' is missing
    BrowserVisibility.make({ addEventListener: () => {}, removeEventListener: () => {} })
  })
})
