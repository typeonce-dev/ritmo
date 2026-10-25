# Content

**Goal:** new items, kinds, levels, or tuning are data in an existing closed set, and the compiler lists everything they need.

**Principles:** each fact has one home; extend what exists before adding.

1. Add the id to the closed set it belongs to, then let the type check list every table that needs an entry, and fill each. Derive labels, menus, shortcuts, and lookups from the set; per-id overrides are `Partial<Record<Id, T>>` with one explicit default.
2. Content that reuses behaviour adds no system. Content that needs new behaviour is also a mechanic ([`mechanic.md`](mechanic.md)).
3. Give each number a designer tunes (speeds, damage, cooldowns) a unit and range in its descriptor's `meta`, so devtools warn when play leaves the range.
4. Content loaded at runtime (files, network) is decoded at the boundary, by the game's schema library or a constructed descriptor's raw input, so bad data fails on load instead of in play.

**Check:** the type check passes with no casts, and a headless test spawns the new content and asserts it behaves as its data says.
