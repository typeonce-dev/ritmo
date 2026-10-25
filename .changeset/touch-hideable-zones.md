---
"@typeonce/ritmo-browser": minor
---

`Touch.actions` infers which controls the layout function can hide, so `view().layout` has no `null` zone for a control it never hides. `Layout`, `View`, and `Actions` take a third parameter, the hideable names, which defaults to every name: an annotated `Touch.Actions<"dash", "move">` is unchanged and still accepts the inferred value.

```diff
 const touch = Touch.actions(canvas, window, ({ width, height }) => ({
   sticks: { move: { region: { left: 0, top: 0, width: width / 2, height }, radius: 56 } },
   buttons: { dash: { center: { x: width - 84, y: height - 150 }, radius: 36 } }
 }))
-const dash = touch.view().layout.buttons.dash
-if (dash !== null) drawButton(dash.center)
+drawButton(touch.view().layout.buttons.dash.center)
```

A test that compared `Touch.actions(...)` to `Touch.Actions<B, V>` with `toBe` compares it to `Touch.Actions<B, V, never>` (or the names it hides).
