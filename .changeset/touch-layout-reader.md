---
"@typeonce/ritmo-browser": patch
---

While attached, `Touch.actions` leaves a function on its target that returns the layout at the target's current size, under `Symbol.for("@typeonce/ritmo-browser/Touch.layout")`, so `ritmo-devtools layout` can check the buttons the canvas draws. `dispose()` removes it. Nothing changes for a game.
