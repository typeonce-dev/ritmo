---
"@typeonce/oxlint-plugin-ritmo": minor
---

`ritmo/handle-runtime-result` finds more dropped and misread results. Newly reported:

- a result an arrow returns to a caller that drops it: `updates.forEach((u) => runtime.tick(u))`, `requestAnimationFrame(() => runtime.tick(update))`, also `addEventListener`, `requestIdleCallback`, `setTimeout`, `setInterval`, `setImmediate`, and `queueMicrotask`. Check it in a block body, or write `() => void runtime.tick(update)` to ignore it on purpose;
- a result left out of a sequence's value: `runtime.tick(update), draw()`;
- a result tested as a condition, which is always true since a `Result` is an object: `if (!runtime.tick(update))`, `if (runtime.restore(save))`, `runtime.rewind(checkpoint) ? a : b`, the left of `&&` / `||`. Test `.ok` instead: `if (!runtime.tick(update).ok)`;
- a method destructured from a runtime: `const { tick } = runtime`, then `tick(update)`;
- a runtime of any name made in the same file: `made.value.tick(update)` and `game.tick(update)` after `const made = Game.Runtime.make(...)` and `const game = made.value`.
