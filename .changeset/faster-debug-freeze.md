---
"@typeonce/ritmo": patch
"@typeonce/ritmo-browser": patch
"@typeonce/ritmo-devtools": patch
---

A debug runtime freezes what it is handed about twice as fast. The freeze walks arrays by index and objects by their enumerable keys and own symbols, and no longer calls `Reflect.ownKeys` on every value: in a top-down shooter's crowd scene a debug step went from 0.40 ms to 0.25 ms (0.18 ms without `debug`), and in a stress scene of 2000 projectiles from 13.5 ms to 7.5 ms. What is frozen is unchanged for plain data; an own non-enumerable property is no longer walked.

The docs say what `debug` costs: it freezes every value written to the world, with or without a listener. The `BrowserHostClock` example attaches the handle in development only (`import.meta.env.DEV ? { hostClock } : undefined`), and `Debug.Option` notes that the clock times trace events only, so a headless runtime shared by tests and long bot runs takes `debug` as a choice.
