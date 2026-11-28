---
"@typeonce/ritmo-browser": minor
---

**Analog actions: a value from 0 to 1, for a pedal, a charge, or a variable-strength press.** `Controls.actions` takes `analogs` next to `buttons` and `vectors`, and every device snapshot, merge, and player slot reports them in `analogs`:

```ts
const Driving = Controls.actions({ buttons: ["pause"], vectors: ["steer"], analogs: ["gas", "brake"] })
const pad = Gamepad.actions(window, { gas: Gamepad.analog(["rightTrigger", "south"]), brake: Gamepad.analog(["leftTrigger"]), steer: Gamepad.vector({ stick: "left" }), pause: ["start"] })
const keys = Keyboard.actions(window, { gas: Keyboard.analog(["w"]), brake: Keyboard.analog(["s"]), steer: Keyboard.vector({ up: ["i"], down: ["k"], left: ["a"], right: ["d"] }), pause: ["Escape"] })
const throttle = Driving.merge({ keyboard: keys, gamepad: pad }).snapshot().analogs.gas // 0.5 on a half pull
```

- `Gamepad.analog(buttons)`: a trigger gives how far it is pulled (1 while pressed on a pad without the standard mapping, or in a timeline that only presses it), any other button 1 while held. `triggerThreshold` still decides only a button action's `held`.
- `Keyboard.analog(keys)`: 1 while one of the keys is held. Keyboard timelines press and release an analog action by name.
- `Touch.actions(target, window, layout, { analogs: ["gas"] })`: those layout buttons are pedals, 1 while a finger is on them, reported in `analogs` instead of `actions` (`Touch.idle` and `Touch.scripted` take the same `analogs` list).
- A merge reports the highest value any device gives. A device that binds an analog action as a button or a vector, or the other way round, does not compile, and the error names the fix (`gamepad binds gas as a button, but it is an analog action: bind it with analog(...)`). `rebind` and `parseRebinding` take analog bindings (`{ buttons }` for a pad, `{ keys }` for a keyboard, as the constructors save), `join: "any"` also joins on an analog pushed past half way, and `random` draws analogs from 0 to 1.

A snapshot written by hand (a test double for `Keyboard.Snapshot`, a custom `Controls.Device`) now needs the `analogs` field, `{}` when it binds none:

```diff
- { actions: { jump: idle }, vectors: {}, used: false }
+ { actions: { jump: idle }, vectors: {}, analogs: {}, used: false }
```
