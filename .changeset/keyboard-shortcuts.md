---
"@typeonce/ritmo-browser": minor
---

**Breaking: `Keyboard.actions` leaves browser shortcuts to the browser.** A key pressed with Cmd, or with Ctrl, is no longer `preventDefault`-ed and presses no action, so Ctrl+R / Cmd+R reload the page instead of firing a `restart` bound to `"r"`, and Ctrl+F, Ctrl+L, and Cmd+A work on bound keys. AltGr reports Ctrl and Alt together and types characters on many layouts, so a key pressed with both still presses its action. A game that binds Control or Meta to an action (`"Control"`, `"Meta"`, `Keyboard.code("ControlLeft")`, ...) keeps every key pressed with them, as before, for as long as its bindings hold one. `Keyboard.presses(...)` skips shortcuts too, so Ctrl+R on a settings screen binds nothing; Control pressed alone is still offered.

`KeyEvent` gains optional `ctrlKey`, `metaKey`, and `altKey`, which a real `KeyboardEvent` has. A test host that sends none behaves as before.

Two fixes for keys whose release the page never sees. macOS sends no keyup for a key released while Cmd is down, so the action stayed held until a blur: Cmd's own keyup now lets go of every held key but the modifiers. And a key still down after that, or after a window blur, is pressed again at its next auto-repeat, where before it stayed released until pressed again. A repeat of a held key is still no new press, and neither is one of a key that went down in a form field, as a shortcut, or before a rebind bound it.

A game whose players press bound keys with Ctrl held (a sneak or modifier key on Ctrl, read alongside other actions) binds Control as an action, which keeps every key pressed with it the game's:

```diff
-const keys = { jump: [" "], fire: ["f"] } as const
+const keys = { jump: [" "], fire: ["f"], sneak: ["Control"] } as const
```
