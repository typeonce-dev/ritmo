---
"@typeonce/oxlint-plugin-ritmo": minor
---

New rule `ritmo/use-keyboard-for-game-keys`, for every file: reports a `keydown`, `keyup`, or `keypress` listener on `window`, `document`, `document.body`, or `document.documentElement` whose function calls `preventDefault()` on its event. Such a listener takes Enter, Space, and the arrows from a focused button, link, or open dialog, so the page's controls cannot be used by keyboard. Bind the keys with `Keyboard.actions(window, bindings)` and read their `pressed` edges (`Keyboard.presses(window)` for any key), or listen on the UI element the key is for. Turn it on in `.oxlintrc.json`:

```diff
   "rules": {
+    "ritmo/use-keyboard-for-game-keys": "error"
   }
```
