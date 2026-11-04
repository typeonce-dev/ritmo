import { describe, expect, it } from "vitest"

import { hashBytes, hashText, makeHash } from "@typeonce/ritmo-tools/internal/hash.ts"

describe("the hash an approval keeps", () => {
  it("is FNV-1a: reviews already written must go on matching", () => {
    expect(hashText("")).toBe("811c9dc5")
    expect(hashText("a")).toBe("e40c292c")
    expect(hashText("foobar")).toBe("bf9cf968")
  })

  it("reads text as UTF-8 and bytes as they are, the same either way", () => {
    expect(hashText("é")).toBe(hashBytes(new Uint8Array([0xc3, 0xa9])))
    const hash = makeHash()
    for (const byte of [0xc3, 0xa9]) hash.mix(byte)
    expect(hash.done()).toBe(hashText("é"))
  })
})
