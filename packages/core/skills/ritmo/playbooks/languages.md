# Languages

**Goal:** the game reads in each language it ships, the compiler lists what a language has left to say, and the simulation holds no words.

**Principles:** intents in, plain data out; each fact has one home; make the next mistake fail loudly.

1. Take the words out of the simulation first; no later step works until this one is done. What it reports is a tagged value ([`mechanic.md`](mechanic.md), step 4), and a content table holds ids and numbers, never a title. A sentence already saved needs a migration ([`state-and-upgrades.md`](state-and-upgrades.md), step 3) that keeps each old line under a tag of its own, as it was written. UI code that reads a meaning back out of a sentence (a pattern that finds a price to draw a coin) takes the value instead.
2. A language is one plain object, the catalog: no i18n library and no string keys. The language the game was written in gives the shape, and every other language must satisfy it:

   ```ts
   export const en = {
     locale: "en", // a BCP 47 tag, for `<html lang>` and this language's `Intl`
     panel: { pause: "Pause work" },
     clock: (paused: boolean): string => (paused ? "Resume" : "Pause"),
     built: (kind: KindId, n: number) => `Built ${count(n, kinds[kind])}`
   }
   export type Catalog = typeof en

   // A missing message, or one that takes the wrong ids, does not compile.
   export const it = { locale: "it", /* ... */ } satisfies Catalog
   ```

   A message is a string, or a function of numbers and of ids from the game's closed sets. Annotate `: string` on a message that returns one of several literals: its inferred type is those very sentences, which no other language can return.
3. Names are tables over the closed sets, one in each language (`satisfies Record<KindId, Noun>`), so a new id fails to compile until every language names it ([`content.md`](content.md), step 1).
4. Grammar is one file in each language, and none of it is shared: each has its own noun (English keeps two forms, Italian adds a gender, Japanese keeps one form and the counter its number takes) and its own helpers (a count, an article, a list), and the catalog says whole phrases with them. Make each `Intl` formatter (`PluralRules`, `NumberFormat`, `ListFormat`) once in that file, never inside a message: a message runs every frame, and making a formatter is the slow part. Where a sentence needs an agreement the language cannot know from the data, turn the sentence so it needs none.
5. A phrase leaves the catalog whole. UI code never joins two worded pieces with a space, a colon, or a letter of its own (Japanese and Chinese put no space there): one message takes both and says them together. A fraction, or a number past 999, that the player reads is written by the language's `NumberFormat`, in UI code too: `${n}` writes "0.25" where Italian writes "0,25".
6. Word what the simulation says through one table for each union: copy [`../references/wording.ts`](../references/wording.ts) into the languages folder, give each language a table that `satisfies Wording<Event>`, and call `say(t.news, event)`. A new tag then fails to compile in every language until each has worded it.
7. The catalog in use is host state: a service that holds `{ current: Catalog }`, requested by the projection's systems and handed to UI code, never by a system of the simulation. It is not a resource: the language is not saved, replayed, or sent to another player. The languages folder is host code too: keep it out of the simulation lint override, and extend the import lint ([`ui-and-render.md`](ui-and-render.md), step 6) so the simulation cannot import it.
8. Host code picks the language: the one the player chose before, else the first of `navigator.languages` the game speaks (by its whole tag, then by its language alone), else the game's own. Keep each language's own name beside its loader (`() => import("./it/index.ts")`), so a menu lists every language without loading one; bundle only the game's own, load the chosen catalog before the first frame, and set `<html lang>` to its `locale`.
9. When the language changes, text worded each frame follows `current` on the next frame; text set once (a control's label, [`ui-and-render.md`](ui-and-render.md), step 7) keeps the old language. Set those again from the new catalog, or save and reload the page.
10. Give the language what a second one always moves: capitals (no `text-transform: capitalize`; English alone capitalises each word of a heading), every word the renderer draws, a save's title (data, worded when it is listed), and room (a translation runs longer or shorter; check each screen in each language, and widen a control for the languages that need it with one `:lang(...)` rule that lists them).

**Check:** the simulation's headless tests pass with no catalog loaded; a test puts a value of every tag through `say` in every language and finds words each time (not empty, no `undefined`, `NaN`, or `[object Object]`); a test that measures the words holds in every script (it counts no letters, and looks for no "." or capital); a test finds the same keys in every language's catalog (`satisfies` reports a missing key, but not an extra one in a catalog put together by spreading its parts); a browser check that finds a control by its words opens the page in a language it names (Playwright's `locale`), since the page otherwise opens in the machine's own; the game's check passes.
