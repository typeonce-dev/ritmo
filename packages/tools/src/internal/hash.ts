/**
 * FNV-1a, the hash an approval keeps: what the person approved, small enough
 * to sit in a review file, so a later change to it shows. Not for security:
 * it tells an accidental change from no change, and it runs the same in Node
 * and the browser.
 */

const OFFSET = 0x811c9dc5
const PRIME = 0x01000193

export interface Hash {
  readonly mix: (byte: number) => void
  /** The hash of what was mixed so far, as eight hex digits. */
  readonly done: () => string
}

export const makeHash = (): Hash => {
  let hash = OFFSET
  return {
    mix: (byte) => {
      hash = Math.imul(hash ^ (byte & 255), PRIME)
    },
    done: () => (hash >>> 0).toString(16).padStart(8, "0")
  }
}

export const hashBytes = (bytes: Uint8Array): string => {
  const hash = makeHash()
  for (const byte of bytes) hash.mix(byte)
  return hash.done()
}

export const hashText = (text: string): string => hashBytes(new TextEncoder().encode(text))
