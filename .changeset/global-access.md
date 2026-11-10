---
"@typeonce/oxlint-plugin-ritmo": minor
---

`ritmo/use-clock-for-time`, `ritmo/use-random-for-randomness`, `ritmo/use-ops-for-math`, and `ritmo/keep-simulation-headless` find a global however the file reaches it, so simulation code that passed before can now be reported. Newly reported, with the rule's existing message saying what to write instead:

- through a global object: `globalThis.Math.random()`, `globalThis.crypto.getRandomValues(bytes)`, `globalThis.Date.now()`, `globalThis.performance.now()`, `globalThis.setTimeout(...)`, `self.Math.sin(x)` (fixed to `Ops.sin(x)` like `Math.sin(x)`), `globalThis.localStorage`, `self.innerWidth`;
- through a `const` that holds the global: `const roll = Math; roll.random()`, `const wait = setTimeout; wait(f, 10)`, `const D = Date; new D()`;
- destructured: `const { random } = Math`, `const { randomUUID } = crypto`, `const { now } = Date`, `const { now } = performance`, `const { localStorage } = globalThis`, `const { Math: M } = globalThis` (an alias of Math, like `const M = Math`);
- by `use-clock-for-time`, globals it did not list: `setImmediate(...)`, `process.hrtime()` and `process.hrtime.bigint()`, `performance.timeOrigin`, `performance.mark(...)`, `Temporal.Now`, `Date()` called without `new`, and `getTimezoneOffset()`;
- by `keep-simulation-headless`, sound: `new Audio(...)` and `new AudioContext()`. Publish what happened as an event and play the sound from a render or host system that reads it (`Game.System.readEvent(Hit)`) and requests the game's audio as a service (`Game.System.service(Audio)`); under a netcode session, from `session.events(Hit)`.

Locals, parameters, and imports with these names, fields of other objects (`config.Date.now()`), and types are still not reported. Host code inside a simulation folder that reads one on purpose takes a disable comment with its reason: `// oxlint-disable-next-line ritmo/use-clock-for-time -- this test is the host`.
