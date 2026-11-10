---
"@typeonce/oxlint-plugin-ritmo": minor
---

`ritmo/no-infinity-in-simulation-data` reports Infinity and NaN in more of the data a world stores, and no longer reports local scratch.

Newly reported, with the message saying to use `null` and a nullable number schema:

- `1 / 0` and `Math.min()` / `Math.max()` of nothing: `{ since: 1 / 0 }`, `{ since: Math.min() }`;
- an element of an array literal: `data.range.set(entity, [0, Infinity])`;
- a call given one, whose result is stored: `{ dash: make(Infinity) }` (`Math.*` and `Number.*` calls are not reported);
- a `const` declared as one: `const LIMIT = Infinity`, then `{ max: LIMIT }`;
- a search seed stored unchecked: `{ distance: best }` after `let best = Infinity`. Store it checked: `{ distance: Number.isFinite(best) ? best : null }`. A comparison with `Infinity` or a `Number.isFinite(best)` anywhere in the file counts as the check.

No longer reported: a literal search seed in a `let` (`let nearest = { distance: Infinity, id: -1 }`), a fallback in a function whose fields are only compared (`const hit = sweep ?? { time: Infinity }; if (hit.time < limit) ...`), and values a `for...of` tries (`for (const size of [0, Infinity])`).
