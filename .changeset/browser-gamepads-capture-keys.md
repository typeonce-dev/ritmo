---
"@typeonce/ritmo-browser": minor
---

**Breaking: a gamepad without the standard mapping is read by its buttons only.** Its axes cannot be mapped (many such pads report their triggers as axes resting at -1), so before, nobody touching an Xbox 360 pad on such a browser read as `lastUsed: "gamepad"` with the right stick pinned left, and `join: "any"` seated it by itself. For a pad whose `mapping` is not `"standard"`, the sticks and analog triggers now read as rest (`left`/`right` `{ x: 0, y: 0 }`, vector actions 0, `leftTrigger`/`rightTrigger` 0) and its axes never count toward `used`, `lastUsed`, or a join. Its buttons are read by index as before, a press still counts as use, and an action bound to `"rightTrigger"` follows the button at that index. The snapshot gains `standard: boolean`, `false` for such a pad (`true` for a standard pad, with no pad, and for `scripted` pads), so a game can tell the player the sticks are not supported and offer button bindings:

```ts
const pad = input.snapshot().devices.gamepad
if (pad.connected && !pad.standard) showNotice("This controller's sticks are not supported: bind its buttons in Controls")
```

A `Gamepad.Snapshot` built by hand needs the new field; `Gamepad.idle(bindings)` has it:

```diff
-const neutral = { ...rest, used: false, connected: false, id: null }
+const neutral = { ...rest, used: false, standard: true, connected: false, id: null }
```

`Pointer.actions` releases the pointer capture whenever it lets go of every button: a window blur, a `pointercancel`, leaving the pointer lock, and `dispose()` now call `releasePointerCapture` for the pointer the first press captured, where before only the last button's `pointerup` did. A pointer the browser no longer captures (after a cancel) is skipped instead of throwing.

`Keyboard.actions` treats keys that type the same character as one key for a character binding. `run: ["Shift"]` stays held while either Shift key is down, with one press when the first goes down and one release when the last comes up; the same holds for both Ctrl and Alt keys and for a digit on the row and on the numpad. Before, letting go of left Shift released `run` while right Shift was still down. Bind `Keyboard.code("ShiftLeft")` to tell them apart. A host that sends no `code` behaves as before.

A new press of a key whose keyup the page never saw (and no blur or Cmd release cleared) now matches its release by the character it types now, and lets go of the one it typed before. Before, W pressed again as "∑" with Option held kept the old "w" for its release, so an action bound to "∑" stayed held until a blur. Repeats are unchanged: a repeat presses a key only if it is neither held nor known to be down.
