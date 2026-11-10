---
"@typeonce/ritmo": patch
---

`Random` handles its edge cases, and every value a game drew before is drawn the same (replays and saves are unchanged):

- `integer(min, maxExclusive)` with a span wider than 2**32 returned only some integers (`integer(0, 2 ** 40)` gave only even numbers): such a span now takes two draws (now and then more) and every integer in it is equally likely. A span up to 2**32 still takes one draw and gives the same sequence. A span past `Number.MAX_SAFE_INTEGER` throws (`Random.integer needs a span of at most Number.MAX_SAFE_INTEGER`), as bad bounds already did.
- `range(min, max)` returned `Infinity` when `max - min` overflowed (`range(-1e308, 1e308)`); it now stays in range.
- `weighted` returned `undefined` when the usable weights added up past the largest number; it now throws (`Random.weighted needs usable weights that add up to a finite total`).
