/**
 * Keys a file must not have: every decoder of a file the agent writes (a
 * config, a recipe, a bank, a song, a model) lists a key it does not know,
 * with the nearest one it does, since a misspelt key would otherwise turn
 * its setting off without a word.
 */

/** How many single-character edits turn `a` into `b`. */
const distance = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1)))
    row = next
  }
  return row[b.length]!
}

/** The known key nearest to `key`. */
export const nearestKey = (key: string, known: ReadonlyArray<string>): string | undefined =>
  [...known].sort((a, b) => distance(key, a) - distance(key, b) || a.localeCompare(b))[0]

/**
 * A problem for each key of `value` that is not in `known`, in the
 * decoders' words: `unknown key maxColours: did you mean maxColors?`.
 * `where` names the object, as the decoder's other problems do
 * (`sounds.hit.`), and is put before the key.
 */
export const unknownKeys = (value: Readonly<Record<string, unknown>>, known: ReadonlyArray<string>, where = ""): Array<string> =>
  Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => {
      const near = nearestKey(key, known)
      return `unknown key ${where}${key}${near === undefined ? "" : `: did you mean ${where}${near}?`}`
    })
