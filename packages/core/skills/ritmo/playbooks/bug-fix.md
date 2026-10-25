# Bug fix

**Goal:** the wrong value is reproduced headless, explained, fixed in the system that wrote it, and kept fixed by a test.

**Principles:** prove it headless; make impossible states unrepresentable; make the next mistake fail loudly.

1. Reproduce headless before changing code: a runtime on a test host clock, scripted input, driven by a devtools `Session` (the `@typeonce/ritmo-devtools` README has the debugging loop). Read the lints at the top of `describe()` first; they often name the cause.
2. Encode the bug as an `Invariant` and run until it breaks. Explain the wrong value with `why` and `journal`, raising `depth` when the writer computed from a wrong input; step through one frame when the value goes wrong within it.
3. When the breaking input is unknown, fuzz it and keep the shrunk replay. When a script cannot reproduce it, record a play session. When it shows in one browser only, verify that replay across engines. The devtools README covers each.
4. Fix the system that writes the wrong value, never the symptom in UI or render code. When the value was an impossible combination (a grounded body moving up, hitstun outside a hit), fix the model so it cannot be written, not with a guard.
5. Turn the reproduction into a test next to the game. When the same class of bug could come back, also encode it as a type, a lint rule, or an invariant.

**Check:** the test fails without the fix and passes with it, and the game's check passes.
