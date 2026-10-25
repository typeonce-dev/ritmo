---
"@typeonce/oxlint-plugin-ritmo": patch
"@typeonce/ritmo": patch
---

`ritmo/no-float-timers` says what to do with a timer that must stop while the world clock runs (hit-stop, a menu over gameplay): measure it against a second clock that holds, `Clock.resource` advanced by `Clock.system(Game, { name, resource, hold })`, so its deadlines wait with it. Only time scaled by a fraction is a real float, kept with a disable comment that gives the reason. The README and the `Clock.system` JSDoc show the pattern.
