---
"@typeonce/ritmo-browser": patch
---

**Keys typed into a form field are left to the field.** With `window` as the host, `Keyboard.actions` pressed bound actions and called `preventDefault()` for keys typed into an `<input>`, `<textarea>`, `<select>`, or contenteditable element, so typing "wasd" in a name field moved the player and the characters never reached the field. Now a keydown whose `target` is such a field presses no action and is not prevented, and `Keyboard.presses` skips it. Keyups are always processed, so a key held before focus moved into a field still releases. `KeyEvent` gains an optional `target` (a real `KeyboardEvent` fits as before). A game that wrapped `window` in a filtering `KeyboardHost` can pass `window` directly.
