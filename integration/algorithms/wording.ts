/**
 * How a language words what the simulation says as data: the Ritmo skill's
 * `references/wording.ts`, copied into the game as its note says (a game
 * keeps it in its languages folder, beside its catalogs).
 *
 * The simulation names what happened as a tagged union (`{ _tag: "fire",
 * street }`); a language holds one function for each tag, and `say` picks
 * it. A table is checked with `satisfies Wording<Event>`, so a new thing the
 * simulation can say fails to compile in every language until each has put
 * it into words, and each function is given its own tag's fields.
 */

/** Anything the simulation says as data: a tag, and what goes with it. */
export interface Tagged {
  readonly _tag: string
}

/** A union by its tags: each tag's own member. */
type Members<M extends Tagged> = { readonly [T in M["_tag"]]: Extract<M, { readonly _tag: T }> }

/** A language's words for a union: for each tag, what that member says (`Out`: a line, or a line with more to it). */
export type Wording<M extends Tagged, Out = string> = { readonly [T in M["_tag"]]: (said: Members<M>[T]) => Out }

/** The entry for a tag takes that tag's member: indexing both by the same `T` is what lets the compiler see it. */
const worded = <M extends Tagged, T extends M["_tag"], Out>(wording: Wording<M, Out>, tag: T, said: Members<M>[T]): Out => wording[tag](said)

/**
 * What the simulation said, in the language's words: `say(t.news, event)`.
 *
 * The second signature is the body's own and no caller sees it: it reads
 * `said` as the member its tag names, which is what a value of a tagged
 * union is, and what the compiler cannot work out for a union it does not
 * know yet.
 */
export function say<M extends Tagged, Out>(wording: Wording<M, Out>, said: M): Out
export function say<M extends Tagged, Out>(wording: Wording<M, Out>, said: Members<M>[M["_tag"]]): Out {
  return worded<M, M["_tag"], Out>(wording, said._tag, said)
}
