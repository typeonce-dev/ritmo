# @typeonce/ritmo-browser

## 0.17.0

### Minor Changes

- d322191: `Touch.actions` stops a held thumb from selecting the page on iOS. Holding a stick or button for a moment selected the canvas and the text around it, because iOS Safari does not treat `preventDefault()` on `pointerdown` as a reason to skip long-press selection. While attached, the module now sets `user-select: none`, `-webkit-user-select: none`, and `-webkit-touch-callout: none` on the element next to `touch-action: none`, and cancels the context menu a long press opens while a tracked finger is down (a mouse right-click keeps its menu). `dispose()` restores all four styles, and removes the ones the element did not have.

  **Breaking: `Touch.TouchTarget` also listens for `contextmenu`, and its `style` is read and written through `getPropertyValue` and `setProperty` instead of `touchAction`.** A DOM element still fits unchanged. A hand-written target (a test fake) adds `contextmenu` to its listeners and replaces `style: { touchAction }` with:

  ```ts
  const styles = new Map<string, string>();
  const style = {
    getPropertyValue: (property: string) => styles.get(property) ?? "",
    setProperty: (property: string, value: string) => {
      if (value === "") styles.delete(property);
      else styles.set(property, value);
    },
  };
  ```

### Patch Changes

- 15c55ac: Less garbage every frame, with no API change. A system run that queues no commands and writes no resource or machine now allocates nothing; before, it allocated about 400 bytes, because V8 allocates a new table on every `Map`/`Set` `clear()`, even of an empty one. A schedule of 100 small systems runs about 2.5× faster, and the top-down example game makes about 27% less garbage per frame. A frame that requests no state transition skips sorting the empty queue. `Keyboard`, `Gamepad`, and `Pointer` snapshots share one idle state object for every action not in use, as `Controls` already did.
- 9346953: The `@typeonce/oxlint-plugin-ritmo` README lists built-in oxlint rules that pair well with Ritmo, each with the Ritmo mistake it catches: a `Result` checked with `if` instead of `.ok`, a switch over a closed set that misses a new member, an asset load or upload that is never awaited, `[object Object]` in HUD text, and oxlint's default `correctness` rules. The type-aware ones need `oxlint-tsgolint` and `oxlint --type-aware`.

  The packages' sources pass these rules: unnecessary type assertions and default type arguments are gone, unused imports are removed, and switches over closed sets name every member. The published types are the same types, written without their default arguments.

- db0804a: **A second skill for prototypes: `skills/ritmo-prototype`.** Ask the game's agent to prototype a mechanic, and it puts a playable toy in front of you every round instead of building the full verification for a game that may not survive the first playtest. You are the playtester: the agent checks only that the build compiles and the page loads, and ends each round with what changed and what to look for; you give the verdict in your own words. The game keeps Ritmo's shape (systems that read intents, a simulation separate from drawing) and every tuned number as named variants you switch with a key, so two feels compare in one play and the prototype can graduate without a rewrite. A bug you report that the code does not explain is shrunk with `Fuzz.run`.

  A `PROTOTYPE.md` at the game root turns the mode on. It holds the question the prototype answers and one line per round with your verdict. The skill gives principles for finding the fun rather than a script, so each prototype takes the shape its game needs. The `ritmo` skill routes to the prototype skill while that file exists, and `playbooks/graduate.md` turns the prototype into the game: schemas for saved state, tests, invariants and fuzzing, the setup's checks, and then the file is deleted.

  Existing projects link the new skill next to the `ritmo` one, as `SETUP.md` step 2 now shows:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-prototype .agents/skills/ritmo-prototype
  ```

  `ritmo-devtools lint` notes each shipped skill the project does not link, so a project set up before this release sees `note  skill-not-linked  ritmo-prototype` until it adds the link. The note names its skill (`note  skill-not-linked  ritmo`), and never changes the exit code.

  `SETUP.md` step 1 installs only `@typeonce/ritmo` and `@typeonce/ritmo-devtools`; step 3 installs `@typeonce/oxlint-plugin-ritmo` and `oxlint` with the lint setup, so a prototype installs the lint when it graduates. Nothing changes for a project that already has them. The `@typeonce/ritmo-devtools` README now says which optional peer each feature needs: none for `Session`, `Fuzz`, `Replay` and `ritmo-devtools lint`.

  The `BrowserTickSource` module header now shows the smallest whole game in one file (controls, a component, a system, schedules, an `Inspector`, `Runtime.make`, and the `FixedLoop` page), compiled with the other examples. The prototype skill starts from it instead of a list of modules to read.

  `ritmo-devtools lint` no longer notes `skill-copied` for a skill link that resolves to the project's own `node_modules/@typeonce/ritmo`, so a project depending on a local checkout (`link:`) passes. `Game.System.readEvent` has an example of reading events with `all()`.

- Updated dependencies [15c55ac]
- Updated dependencies [39aeaf4]
- Updated dependencies [9346953]
- Updated dependencies [db0804a]
- Updated dependencies [3d1f862]
  - @typeonce/ritmo@0.17.0

## 0.16.1

### Patch Changes

- @typeonce/ritmo@0.16.1

## 0.16.0

### Minor Changes

- be9af72: `Touch.actions` infers which controls the layout function can hide, so `view().layout` has no `null` zone for a control it never hides. `Layout`, `View`, and `Actions` take a third parameter, the hideable names, which defaults to every name: an annotated `Touch.Actions<"dash", "move">` is unchanged and still accepts the inferred value.

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

### Patch Changes

- 9b0379e: **Every JSDoc `@example` now compiles against the current API.** Examples are type-checked in CI as a game would import them, so they no longer cite exports that do not exist or call them with the wrong arguments. What changed in meaning:

  - `Game.Runtime.make(...)` with a constructed resource (a `Clock.resource`, a `Descriptor.ConstructedResource`) returns a `Result` that may fail: the examples check `ok` instead of reading `.value`.
  - A captured input resource is typed from its source: `Descriptor.TransientResource<InputCapture.SnapshotOf<typeof KeyboardInput>>()`, not `Keyboard.Snapshot<...>`.
  - `Netcode.seats(...)` returns a `Result`: check it instead of `.value!`.
  - `Lint.Target<typeof Game.schema, typeof Root>` takes the schema root second.
  - `NodeRegistry.make` infers the node type from `attach`'s parameter, with no explicit generic.

- 9290521: Docs from upgrading two games across several versions:

  - The skill's state-and-upgrades playbook lists the breaks that still compile, per version, and `SETUP.md` says a new lint rule is off until `.oxlintrc.json` lists it.
  - The 0.13 `Decode` entry has a table from each `Decode` codec to Zod and Effect; handle schemas use `z.unknown().refine(Entity.isHandle(...))`, not `z.custom`.
  - The `Snapshot.version` JSDoc says how to rewrite a format 2 save; `WorldSnapshot.relations` says targets are sorted by id while each target's sources keep their order.
  - `ritmo-devtools lint`'s `uncovered-simulation-module` message names the usual cause: a host module imported at the top of the lint entry instead of inside `lintTarget`. The README shows a debug script reusing `lintTarget`.
  - The `Replay` docs and the 0.15 changelog say how to keep a playtester's save button without the monitor: `recorder.save(reason)` from a key handler.
  - `Touch.Layout` shows how to draw a layout with no `null` zones, and `Pointer.Actions` says to build test doubles with `Pointer.scripted`.
  - The `use-ops-for-math` example uses `Angle.wrap` for a signed turn, and the spatial-grid reference defines its `made` helper.

- Updated dependencies [9b0379e]
- Updated dependencies [be9af72]
- Updated dependencies [9b0379e]
- Updated dependencies [9290521]
- Updated dependencies [9290521]
- Updated dependencies [1b55d21]
  - @typeonce/ritmo@0.16.0

## 0.15.0

### Minor Changes

- 4c867ef: **Browser input replays and fuzzes through the one descriptor the page reads.** A game that declared its input service as the whole `Controls` merge (or a device) could not be opened from a replay or fuzzed: `playback.source(...)` hands back a plain `snapshot()` source, which has no `rebind` or `dispose`. Declare the service as `InputCapture.SourceOf<...>` the merge, device, or pool (its `snapshot()` only, still marked as draining, so systems keep reading the captured resource). The live merge provides it in the page, scripted devices in tests, `playback.source(ControlsInput)` in a replay, and `Fuzz.input` in the fuzzer; the page keeps the merge to rebind and dispose it.

  ```ts
  const ControlsInput =
    Descriptor.Service<
      InputCapture.SourceOf<ReturnType<typeof makeControls>>
    >()("Game/Controls");
  const devices = { keyboard: Keyboard.idle(keys), gamepad: Gamepad.idle(pad) };
  const Fuzzed = Fuzz.input(ControlsInput, {
    generate: (random) => Actions.random(random, devices),
    neutral: Actions.idle(devices),
  });
  ```

  - `Controls.actions(...).random(random, devices)` draws a merged snapshot a real merge could report: each button idle, held, just pressed, tapped, or just released, and each vector zero, one of eight directions, or a tilt shorter than 1. Device data stays as given, every action is available, and no device is last used.
  - `Controls.players(...).random(random, frame, { devices, seats })` draws a pool's snapshot with the listed slots seated from frame 1 (reporting `event: "joined"` there, with idle input, as `pool.seat` in setup does) and their input drawn after. A pool is one source carrying every slot, because one `snapshot()` drains every pooled device and decides joins across them.
  - `Replay.Playback.source` and `Fuzz.input` take any `snapshot()`-only source service, including ones that mark `snapshot()` with `System.Consumes` (`InputCapture.SourceOf`, `Netcode.Source`). A service declared as the whole device is a compile error naming the fix: "has more than snapshot(), so a replay cannot provide it". `Replay.SourceData<Value>` names the data a source returns.

- c75daff: **Breaking: `Ops` and `Random` moved from `@typeonce/ritmo-math` into `@typeonce/ritmo`.** Determinism belongs to the runtime: every simulation needs same-bits math and a seeded generator, with or without the 2D helpers. The modules are unchanged; only the import path moves, and `@typeonce/ritmo-math` no longer exports them. The `Ops` header now states that its list is closed: the 22 functions engines may approximate and `**`; everything else on `Math` is already exact. `@typeonce/ritmo-devtools` and `@typeonce/ritmo-netcode` no longer depend on `@typeonce/ritmo-math`.

  ```diff
  - import { Ops, Random } from "@typeonce/ritmo-math"
  + import { Ops, Random } from "@typeonce/ritmo"
  - import * as Random from "@typeonce/ritmo-math/Random"
  + import * as Random from "@typeonce/ritmo/Random"
  - import * as Ops from "@typeonce/ritmo-math/Ops"
  + import * as Ops from "@typeonce/ritmo/Ops"
  ```

  `oxlint --fix` with `ritmo/use-ops-for-math` adds the new import where a `Math` call is rewritten; other imports need the path changed by hand.

- 6b0d73e: **Hidden tabs announce themselves instead of timing out.** A browser stops a hidden tab's frames, so its peer went silent and the match ended with `Disconnected { reason: "timeout" }`. Sessions take an optional `hidden` option: the session hears the moment its page hides, tells the others, and they apply the declared policy and show it in the new `status().hidden` (one boolean per seat):

  ```ts
  import { BrowserVisibility } from "@typeonce/ritmo-browser";

  const session = Netcode.rollback(runtime, {
    ...options,
    hidden: {
      visibility: BrowserVisibility.make(document),
      afterMS: 30_000,
      then: "resync-on-return",
    },
  });
  // HUD: session.status().hidden[seat] → "waiting for Ada"
  ```

  - `"stall"`: the others wait for the hidden seat; it goes on from where it stopped when it returns.
  - `"resync-on-return"`: the others play on with idle input for it; on return, seat 0 sends a save and it restores it (its `advance` is `Waiting` meanwhile). While seat 0 itself is hidden, the others wait.
  - A hidden seat that never returns still ends the session with `Disconnected`, at most `afterMS + timeoutMS` after it hid.

  New in netcode: `Visibility` (the contract), `MemoryVisibility` (a page a test hides and shows), `Netcode.HiddenPolicy`, `Netcode.HiddenOptions`. New in browser: `BrowserVisibility.make(document)` over the Page Visibility API.

  **Breaking:** the session protocol is now version 2, so peers on an older version end with `ProtocolMismatch`. Fix: update every peer to the same release.

### Patch Changes

- Updated dependencies [3a195b7]
- Updated dependencies [d01a735]
- Updated dependencies [45458dc]
- Updated dependencies [c75daff]
- Updated dependencies [b77b17d]
- Updated dependencies [c20f20b]
- Updated dependencies [01959dd]
- Updated dependencies [637fa1f]
- Updated dependencies [44e9b42]
  - @typeonce/ritmo@0.15.0

## 0.14.0

### Minor Changes

- 9831926: **A touch control the game hides is `null` in the layout, and lets go of its finger.** A finger kept the control it landed on until it lifted, and the layout was read only on a new touch, so a thumb resting on the walking stick when the game swapped in the driving buttons kept holding its direction: the car drove off on its own. The layout is now read on every snapshot and every new touch. A held control that turns `null` releases at once with `cancelled: true`, and its finger does nothing until it lifts; a `null` control takes no finger. Its name stays in `actions` and `vectors`, reported idle.

  ```ts
  Touch.actions(canvas, window, ({ width, height }) => ({
    sticks: {
      move: driving()
        ? null
        : { region: { left: 0, top: 0, width: width / 2, height }, radius: 56 },
    },
    buttons: {
      steerLeft: driving()
        ? { center: { x: 60, y: height - 60 }, radius: 40 }
        : null,
    },
  }));
  ```

  - **Breaking: `Layout.buttons` zones are `ButtonZone | null`, and `Layout.sticks` zones `StickZone | null`.** Code that reads zones from `view().layout` narrows them:

    ```diff
    -const dash = view.layout.buttons.dash
    -draw(dash.center, dash.radius)
    +const dash = view.layout.buttons.dash
    +if (dash !== null) draw(dash.center, dash.radius)
    ```

  - The layout function now runs once per `snapshot()` as well: keep it cheap.

- accd1d0: **Touch layouts have named sticks, so a twin-stick shooter moves on the left and aims on the right.** A stick's key is the vector it drives, as a button's key is the action it reports. Each stick floats under its own thumb, two thumbs drive two sticks at once, and each reports `vectors.<name>` with `active`. A finger goes to the button it lands on, otherwise to the first free stick (in key order) whose region contains it, otherwise the swipe area.

  ```ts
  Touch.actions(canvas, window, ({ width, height }) => ({
    sticks: {
      move: {
        region: { left: 0, top: 0, width: width / 2, height },
        radius: 56,
      },
      aim: {
        region: { left: width / 2, top: 0, width: width / 2, height },
        radius: 56,
      },
    },
    buttons: {
      dash: { center: { x: width - 84, y: height - 150 }, radius: 36 },
    },
  }));
  ```

  - **Breaking: `Layout.stick` (with `vector`) is `Layout.sticks`, keyed by the vector.** A buttons-only layout passes `sticks: {}`. A leftover `vector` field does not compile (`a stick drives the vector named by its key in sticks: remove vector`), and neither does a stick named like a button (`dash names both a stick and a button: give them different names`).

    ```diff
    -stick: { region, radius: 56, vector: "move" },
    +sticks: { move: { region, radius: 56 } },
    ```

  - **Breaking: `Snapshot.stick` and the `Stick` type are removed.** Each stick is in `vectors` as a `StickState`: a `Controls.Vector` plus `active` (a thumb is on it). `Controls` merges it as a plain vector.

    ```diff
    -if (snapshot.stick.active) walk(snapshot.stick.vector)
    +if (snapshot.vectors.move.active) walk(snapshot.vectors.move)
    ```

  - **Breaking: `View.stick` is `View.sticks`, by name** (each `{ origin, knob }` or `null`), and the radius is on `view.layout.sticks.<name>`.

    ```diff
    -if (view.stick !== null) draw(view.stick.origin, view.stick.knob, view.layout.stick.radius)
    +const stick = view.sticks.move
    +if (stick !== null) draw(stick.origin, stick.knob, view.layout.sticks.move.radius)
    ```

  - **Breaking: `Names.vector` is `Names.sticks`, required like `buttons`** (`[]` for buttons only), for `Touch.idle` and `Touch.scripted`.

    ```diff
    -Touch.idle({ buttons: ["dash"], vector: "move" })
    -Touch.idle({ buttons: ["jump"] })
    +Touch.idle({ buttons: ["dash"], sticks: ["move"] })
    +Touch.idle({ buttons: ["jump"], sticks: [] })
    ```

  - **Breaking: a timeline's `stick` is `sticks`, by name.** Naming a stick the names do not declare does not compile. `TimelineEntry` and `Timeline` take the stick names as a second type parameter.

    ```diff
    -{ frame: 0, stick: { x: 1, y: 0 } },
    -{ frame: 3, stick: null }
    +{ frame: 0, sticks: { move: { x: 1, y: 0 } } },
    +{ frame: 3, sticks: { move: null } }
    ```

  - `Controls` copies each merged vector, so a merged `vectors.move` is a plain `{ x, y }` whatever the device's vector carries.

### Patch Changes

- 9695562: **Keys typed into a form field are left to the field.** With `window` as the host, `Keyboard.actions` pressed bound actions and called `preventDefault()` for keys typed into an `<input>`, `<textarea>`, `<select>`, or contenteditable element, so typing "wasd" in a name field moved the player and the characters never reached the field. Now a keydown whose `target` is such a field presses no action and is not prevented, and `Keyboard.presses` skips it. Keyups are always processed, so a key held before focus moved into a field still releases. `KeyEvent` gains an optional `target` (a real `KeyboardEvent` fits as before). A game that wrapped `window` in a filtering `KeyboardHost` can pass `window` directly.
- Updated dependencies [c3719a5]
- Updated dependencies [70d054e]
- Updated dependencies [adb4066]
- Updated dependencies [97e95fb]
- Updated dependencies [dbfbd9d]
- Updated dependencies [343660e]
- Updated dependencies [d24258e]
- Updated dependencies [cfe332a]
- Updated dependencies [8aa1e85]
  - @typeonce/ritmo@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [791b52a]
- Updated dependencies [b3d6502]
- Updated dependencies [835f6ba]
  - @typeonce/ritmo@0.13.0

## 0.12.0

### Minor Changes

- 04a2ac7: **One home for the input types every device shares, and a checked pad count.**

  - **Breaking: `ActionState` and `Vector` are exported from `Controls` only.** They were declared or re-exported per device (`Keyboard.ActionState`, `Pointer.ActionState`, `Keyboard.Vector`, `Gamepad.Vector`, `Touch.Vector`), all with the same shape. Only the import changes:

    ```diff
    -import type { ActionState } from "@typeonce/ritmo-browser/Keyboard"
    -import type { Vector } from "@typeonce/ritmo-browser/Gamepad"
    +import type { ActionState, Vector } from "@typeonce/ritmo-browser/Controls"
    ```

  - **`Gamepad.pads(host, bindings, max)` takes a whole number literal of 1 or more.** `0`, `-2` and `2.5` do not compile (`max must be a whole number of pads, 1 or more`), and neither does a plain `number` (`max must be a number literal`). Correct calls are unchanged.
  - `Controls.Pads`, the pool entry `Gamepad.pads(...)` fills, is now marked with `System.Consumes<"snapshot">` like every other input source.
  - `Gamepad.scriptedPads` documents how it differs from live pads: every timeline is in the list from the first snapshot with its id, and a pad plugged in later is a timeline whose first entry comes later.

### Patch Changes

- Updated dependencies [04a2ac7]
  - @typeonce/ritmo@0.12.0

## 0.11.0

### Minor Changes

- 778301a: **Draining a service is declared, checked at compile time, and observed at run time.**

  - **`System.Consumes<"snapshot">`** marks the methods of a service type that drain it. A system that declares the service with `Game.System.service` sees those methods as a compile error naming the fix (`snapshot() drains Game/Controls: declare it with Game.System.consumeService, or read the resource its capture writes`); `Game.System.consumeService` calls them. Its other methods stay available through `service` (a settings screen can still `rebind`).
  - Every input source is marked: `Keyboard.Actions`, `Keyboard.Presses`, `Gamepad.Actions`, `Gamepad.Pads`, `Touch.Actions`, `Pointer.Actions`, `Controls.Device`, `Controls.Controls`, `Controls.Pool`, and `InputCapture.Source`. **Breaking:** a system that called `snapshot()` through `Game.System.service` no longer compiles; read the resource `InputCapture.system` writes instead (or, for a system that must drain the source itself, declare it with `Game.System.consumeService`).
  - `Game.System.service` returns `ServiceRead<D, false>` and `consumeService` returns `ServiceRead<D, true>`.
  - The `service-consumed-twice` lint also reports what a debug runtime saw: a consumed service whose consumers ran at more than one placement in the session, in unnamed schedules too (`Game/Drain (schedule#2, step 0, unnamed)`). Named schedules are reported once, by the static lint.

- 866bcff: **`Controls` merges several input devices into one source, every device snapshot shares one shape, and capturing input is checked at compile time and by `describe()`.**

  - **`Controls.actions({ buttons: [...] })`** declares the game's actions once. Its `merge({ keyboard, gamepad, touch })` builds one input source: an action is `held` while any device holds it, `pressed` when any device pressed it, and `released` when a device released it and none holds it now (the same rules as one device with all the bindings). Each device binds every declared action; a device that cannot is passed as `lacking(device, ["pause"])`, which must name exactly the actions it lacks (autocomplete offers them). A device binding an undeclared action, a device missing an action, and an action no device binds do not compile.
  - The merged snapshot has `actions`, `vectors`, `available` (whether the last used device binds each action, so a game can offer a lacking action another way), `devices` (each device's own snapshot, keyed by the merge names: sticks, triggers, touch aim), and `lastUsed` (`null` until a device is used). The merged source exposes `rebind.<device>` for devices that can rebind, and `dispose()`. `idle({ keyboard: Keyboard.idle(...), ... })` initializes the input resource. Reading an action on a device that lacks it does not compile.
  - **Breaking: `Keyboard.Snapshot` is `{ actions, vectors, used }`.** Read `input.actions.jump.pressed` instead of `input.jump.pressed`. Hand-written timelines and bindings are unchanged. Code that walks the snapshot still compiles and reads the wrong thing: `Object.values(snapshot)` now lists the three groups, so read `Object.values(snapshot.actions)`, or `snapshot.used` to tell whether the player touched this device.
  - **Breaking: `Touch.Snapshot` renames `buttons` to `actions`** (each still a `ButtonState` with `aim` and `cancelled`) **and replaces `touched` with `used`.** Read `input.actions.fire` instead of `input.buttons.fire`. `Layout.buttons` and `View.buttons` are unchanged.
  - Every device snapshot (`Keyboard`, `Gamepad`, `Pointer`, `Touch`) has `used`: something pressed in this window or held, or a stick or swipe in use. Releases do not count, so a blur or a disconnect does not change `lastUsed`.
  - **`Game.System.consumeService(Service)`** declares a service a system drains on each run (an input source's `snapshot()`, a message queue); it is the only way to call the draining methods (see `System.Consumes`). `describe()` warns with the new `service-consumed-twice` lint when a consumed service has more than one placement, for example the same input captured in a fixed and a render schedule, where each capture sees only the presses since the other ran. `SystemDescription.consumes` lists them.
  - **Breaking: `InputCapture.system` keeps its declared access**: it consumes the source and writes the resource, so a `Game.System.thisTick` reader of the resource placed before the capture no longer compiles (the error names both systems and the fix: place the reader after the capture), and capturing one source twice is reported by `describe()`. The exported `InputCapture.CaptureSystem` type is removed: let the system's type be inferred.
  - **`Debug.serviceLints`** lets a service value add findings to `describe()` lints, reported as `service-lint` with the service as subject; `Controls` uses it to list every device that lacks an action.

- deaed5a: **`Gamepad` reads controllers as named actions, and keyboard and gamepad bindings can change at runtime.**

  - **`Gamepad.actions(window, bindings, options)`** binds actions to buttons named by the browser's standard mapping (`"south"`, `"west"`, `"rightTrigger"`, `"dpadUp"`, `"start"`...). Each snapshot has `actions` (as `Keyboard`'s), every `buttons` state by name whatever the bindings (for menu navigation and for a settings screen waiting for the button to bind), the `left` and `right` sticks with a radial dead zone (`y` grows down, as `Touch`'s stick), how far each trigger is pulled, and the followed pad's `id`. It follows the pad used last and releases everything held when that pad disconnects. It reads the pads on every animation frame (and on every snapshot) until `dispose()`, so taps shorter than an update count with nothing to call; the lifecycle is `snapshot` / `rebind` / `dispose`, as for `Keyboard`. `Gamepad.idle`, `scripted`, `recording`, `parseTimeline`, and `isButton` match the other devices; timelines name buttons, so a replay follows the bindings, and an entry's `connected` records a disconnect or reconnect, so a replay drops and regains the pad on the same frames.
  - **`rebind(bindings)`** on `Keyboard.actions(...)` and `Gamepad.actions(...)` binds the same actions to new keys or buttons, for players who remap their controls. An action held only through a key it lost reports `released`; a key held across the rebind holds a newly bound action only after a fresh press, so an action never turns held without a press. It takes exactly the actions the source was made with: an extra action fails to compile with `<name> is not an action of these bindings`, even from an object not written inline. Scripted keyboard actions ignore it (their timeline names actions).
  - **`Keyboard.presses(window)`** reports every key that went down since the previous snapshot, bound or not, as `{ key, code }`, so a settings screen can wait for the key to bind (the gamepad equivalent is the snapshot's `buttons`).
  - **`Keyboard.parseRebinding(bindings, data)`** and **`Gamepad.parseRebinding(bindings, data)`** validate saved bindings (for example from `localStorage`) as a `Result` ready for `rebind`, with the offending `path` on failure.
  - **Timelines replay a release and press inside one update.** An action (keyboard) or button (gamepad) in both `press` and `release` of one entry is now a release then a new press when it was held, and still a tap when it was up, so `recording(...)` captures a quick double tap and the replay matches.
  - **Breaking: `InputCapture.system` requires the resource's value type to be exactly the source's snapshot type.** A resource that only matched both ways (for example one with an extra optional field) now fails with a message naming the fix: declare it as `Descriptor.TransientResource<InputCapture.SnapshotOf<typeof Source>>()`.
  - **Breaking for hand-written sources:** `Keyboard.Actions` now requires `rebind`. An object implementing it by hand adds `rebind() {}`.

- 57430bb: **Local multiplayer: players join slots by pressing a button on any pooled device.**

  - **`Controls.players(Actions, { slots, join, leave })`** declares the players: the slots (the most at once, in join order), the button action that joins (or `"any"` for any button), and the one that leaves while joining is open. A misspelled or vector action, no slot, a slot named `joining`, and a button action named `any` (it would read as `join: "any"`) do not compile.
  - **`pool(devices)`** on the declared players builds one input source from devices nobody holds yet. Pressing join on one gives it the first free slot; that snapshot reports `event: "joined"` with the player's input idle, so the press does nothing else (joining with the jump button does not jump). One device holds one slot; slots keep their names when another empties, and the next player fills the gap. Each pooled device binds every action (or is passed through `lacking`), and the join action always.
  - The snapshot has every slot by name (`input.p2`): `joined`, `device` (what it joined with), `connected`, `event` (`"joined"`, `"left"`, or `null`), and the player's `actions`, `vectors`, and `available`, idle while the slot is empty. A device's own snapshot is behind a check of `device` (`if (input.p2.device === "pads") input.p2.devices.pads.left`). The declared players' `idle(...)` initializes the resource.
  - Systems call `setJoining(open)` (closed at the start: open it on a join screen, or once for drop-in play), `seat(slot, device)` (a player in from the start, or picked on a menu: a pool name, or `{ pads: index }` for one pad; returns `{ ok: false, reason }` when the slot or device is taken), `leave(slot)` (a pause menu), and `rebind.<device>` through a plain service. Leaving by button works only while joining is open; otherwise `leave` is an ordinary action.
  - **`Gamepad.pads(host, bindings, max)`** reads every pad on its own, for a pool: each pad joins as its own player. An unplugged pad keeps its slot (`connected: false`) and returns to it when it comes back; two pads of one model share an id, so they are told apart by their place in the pad list. `Gamepad.scriptedPads(bindings, timelines)` drives one timeline per pad in tests.
  - `describe()` lints two keyboard devices that bind the same key, a device taken by two sources (a merge and a pool), and joining never opened.

- 97e39c5: **`Pointer` binds actions like `Keyboard` and `Gamepad` and merges into `Controls`, and `Controls.group` makes devices used together count as one.**

  - **Breaking: `Pointer.track(target, blurHost, options?)` is `Pointer.actions(target, blurHost, bindings, options?)`.** Bindings map actions to buttons (`{ fire: ["primary"] }`); a misspelled button or an empty list does not compile. Pass `{}` for position and raw buttons only. The `Pointer.Pointer` type is `Pointer.Actions<B>` and `TrackOptions` is `ActionsOptions`.
  - **Breaking: the snapshot is `{ actions, vectors, buttons, position, movement, wheel, over, locked, used }`.** Read `input.buttons.primary` (or a bound action) instead of `input.primary`. `used` is a press, a hold, or movement over the element; releases do not count. `movement`, `wheel`, and `locked` come with the wheel and the pointer lock.
  - **The `back` and `forward` side buttons** (`PointerEvent.button` 3 and 4) are reported and bindable. `Pointer.buttonNames` and `Pointer.isButton` list and check them.
  - `rebind(...)` swaps the buttons of the same actions; `Pointer.parseRebinding(bindings, data)` validates saved ones.
  - **Breaking: `Pointer.idle(bindings, position?)` and `Pointer.scripted(bindings, timeline, start?)`** take the bindings first. Timelines still name buttons, so a replay follows the bindings as live play does.
  - **`actions.group({ keyboard, mouse })`** groups devices into one merge entry: it binds what its devices bind between them, and `lastUsed` and `available` follow it as a whole, so walking with the keyboard while aiming with the mouse stays on one device. Grouped devices keep their own names in `devices`, `rebind`, and `idle`; `lastUsed` names the group. Pass the group to `lacking(...)` for actions none of its devices binds. A group of fewer than two devices, a `lacking` device or a group inside a group, a device binding an undeclared action, and a name used twice across devices and groups do not compile.

- bb371d4: **`Pointer` reads the wheel and the pointer lock, and `Touch.track` is `Touch.actions`, so every device is built the same way.**

  - **The wheel**, read two ways for two jobs. `wheel` is how far it scrolled since the previous snapshot, in CSS pixels (lines and pages are converted), for zoom. The `wheelUp`, `wheelDown`, `wheelLeft`, and `wheelRight` buttons pulse (pressed and released in one window) once per `Pointer.wheelStep` (100 px, one notch), so a stepping action binds them (`nextWeapon: ["wheelDown"]`) and merges with a gamepad bumper in `Controls`. The page does not scroll over the element unless `preventScroll: false`. `PointerTarget` gains the `wheel` listener.
  - **Mouse look:** `movement` is the raw motion since the previous snapshot (`movementX`/`movementY`), locked or not. With `lock: document`, a click on the element locks the pointer (the browser grants a lock only inside a click, so the module asks in its own listener); that click is not reported as a press. `locked` turns `false` when the player leaves with Escape, which releases what was held. `used` also counts motion and scrolling.
  - Timelines record and replay `wheel`, `movement`, and `locked`. Their `press`/`release` take `Pointer.PhysicalButton`s; wheel pulses come from `wheel`.
  - **Breaking: `Touch.track(target, blurHost, layout, options?)` is `Touch.actions(...)`, the `Touch.Touch<B>` type is `Touch.Actions<B>`, and `Touch.TrackOptions` is `Touch.ActionsOptions`,** matching `Keyboard.actions`, `Gamepad.actions`, and `Pointer.actions`. Arguments and behavior are unchanged.

- b3b16fd: **Movement is one vector action: declared once, bound per device, merged by `Controls`, and checked like every other action.**

  - **`Controls.actions({ buttons: [...], vectors: [...] })`** declares both kinds. A button action is pressed and held (jump); a vector action is a direction with length at most 1, `y` growing down (move). A name declared as both kinds does not compile. The declared names are listed in the set's `buttons` and `vectors`.
  - **`Keyboard.vector({ up, down, left, right })`** binds a vector to keys: opposite keys cancel and a diagonal has length 1. **`Gamepad.vector({ stick, up, down, left, right })`** binds it to a stick, the d-pad, or both (the longer wins). **A `Touch` layout's `stick.vector`** names the vector the stick drives. Every device snapshot has `vectors`; read `input.vectors.move` (`Pointer`'s is empty: it reports `position` and `movement`).
  - `Controls` merges a vector as the longest any device reports, so devices never add up past 1 or cancel each other. Vectors work with `lacking`, `available`, `idle`, and `lastUsed` (a vector in use counts as use). Binding a vector action as a button (or the reverse), missing a vector, and reading `actions.move` or `vectors.jump` do not compile, each with an error naming the fix.
  - `rebind` and `parseRebinding` take vector bindings (`Gamepad` can swap sticks).
  - Keyboard timelines name a vector by direction, `press: ["move.right"]`; `parseTimeline` validates it. Button actions are named as before.
  - **Breaking: `Touch.idle` and `Touch.scripted` take the names as an object**, `{ buttons, vector? }` (`vector` as the layout's `stick.vector`):

    ```diff
    -Touch.idle(["fire"])
    -Touch.scripted(["fire"], timeline)
    +Touch.idle({ buttons: ["fire"] })
    +Touch.scripted({ buttons: ["fire"] }, timeline)
    ```

  - Directions that step one tile at a time (a grid game reading taps) stay button actions.

### Patch Changes

- e46f284: **Documentation pass over every public module.** Every export has JSDoc saying what it is for and which neighbouring API to use instead; examples that no longer compiled (`Session.make` without `hostClock`, `Replay.session`, the `Pointer` rebind) are fixed; `Debug.Lint` lists every lint code the runtime emits. The `stale-target` lint's fix now names `queries.x.getHandle(handle)`.
- Updated dependencies [778301a]
- Updated dependencies [866bcff]
- Updated dependencies [e46f284]
  - @typeonce/ritmo@0.11.0

## 0.10.0

### Patch Changes

- 7002f4d: **Everything a game's agent needs now ships with the packages, and `ritmo-devtools lint` reports simulation modules the lint rules miss.**

  - **Breaking: `ritmo-devtools lint` fails on an uncovered simulation module.** Every module the entry loads that the `ritmo/keep-simulation-headless` override in `.oxlintrc.json` does not cover is reported as `uncovered-simulation-module`, and the command exits 1. Add the module (or its folder) to the simulation override's `"files"`, or stop importing values from it. Modules loaded only inside `lintTarget` are not checked. Requires Node 22.15 or newer (`engines.node` is now `>=22.15`).
  - **An agent skill ships with `@typeonce/ritmo`** in `skills/ritmo/SKILL.md`, for every change: where the docs are, and principles for where a game's code and state belong. Link it into the folder the game's agent reads skills from, for example `ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo`. `SETUP.md` in `@typeonce/ritmo` is the one-time setup: the base packages and checks every game uses, the add-ons, and linking the skill.
  - **Every package ships its `CHANGELOG.md`.** The upgrade notes for 0.8.0 and 0.9.0 are in the `@typeonce/ritmo` changelog.
  - **JSDoc corrections.** Examples no longer provide randomness or time as services (use the `Random` resource and `Clock`), the `Command` module example declares its commands, inspector docs state that `added`/`changed` reads report records since the inspector's previous evaluation, and every example uses prefixed names (`"Game/Position"`). Guidance that lived only in the repository's guides (spawn order, `ReadonlyValue` helpers, re-entering a state, `thisTick` and plugin systems, service effects and rollback) is now in the JSDoc.
  - Package READMEs link other packages' READMEs by GitHub URL, so the links work on npm.

- Updated dependencies [7002f4d]
- Updated dependencies [388a696]
  - @typeonce/ritmo@0.10.0

## 0.9.0

### Minor Changes

- 6c09482: **`FixedLoop` moves to core, so any host can drive it.** See Upgrading under 0.9.0 in the `@typeonce/ritmo` CHANGELOG.md.

  - **`FixedLoop` is now exported from `@typeonce/ritmo`** (`import { FixedLoop } from "@typeonce/ritmo"`). Its API is unchanged. `@typeonce/ritmo-browser` no longer exports it.
  - **`BrowserTickSource.make(window)`** in `@typeonce/ritmo-browser` replaces `FixedLoop.animationFrames(window)`. It is the browser's `TickSource`, named like `BrowserHostClock`. Native shells, desktop runtimes, and renderer tickers wrap their own frames with `FixedLoop.source(...)`.
  - **Package sources compile without DOM types.** Core, math, render, browser, and pixi reach no DOM global, and the compiler now rejects one. Published code is unchanged.

### Patch Changes

- 6cd9771: **`Ops`: math that returns the same bits on every engine.**

  JavaScript engines may approximate `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `tanh`, `pow`, `hypot`, and `a ** b`, and they do: V8 on macOS arm64 and on Linux x64, and JavaScriptCore (Safari, every iOS browser), return different last bits, and a simulation grows that bit into a different run. `Ops` from `@typeonce/ritmo-math` has the same functions as pure-JavaScript ports of fdlibm (musl libm), built only from operations every engine rounds exactly, so a run replays bit for bit on any device. Each is within 1 ulp of the exact value (`tanh` within 2, like the native one); `Ops.hypot` takes exactly two numbers and never overflows.

  ```ts
  import { Ops } from "@typeonce/ritmo-math";

  const heading = Ops.atan2(dy, dx);
  const step = { x: Ops.cos(heading) * speed, y: Ops.sin(heading) * speed };
  ```

  Use `Ops` in simulation code instead of those `Math` functions; `Math.abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `+ - * /`, and `x ** 2` are already exact everywhere.

  `Vec2.rotate`, `length`, `distance`, `normalizeOr`, `moveToward`, `clampLength`, `Collide2` corner normals, and `FlowField.way` now use `Ops`. Their results can differ from the previous version in the last bit, so a replay recorded on an earlier version may diverge. `Touch` (browser) measures stick and aim offsets with `Math.sqrt(x * x + y * y)` instead of `Math.hypot`, for the same reason.

- 886ba39: **Support package fixes from a second review.**

  - **Random state in a resource.** `Random` is now a validator for its own state (`Descriptor.ConstructedResource(Random)("Game/Rng")`, saved and checked like any constructed resource), `Random.seed(n)` is its starting value, and `Random.draw(resources.rng)` gives a generator over the system's write cell that writes every draw back, so a system no longer stores the state by hand and a failed run rolls its draws back. `Random.make(state)` stays for state kept outside the world.
  - **Preconditions are checked.** `Random.integer` throws unless both bounds are whole with `min < maxExclusive` (it drew outside both bounds), and `Random.range` throws when `min > max` or a bound is not finite (equal bounds still return `min`). `SpatialGrid.insert` / `forEachIn` throw on non-finite numbers (an infinite box never returned), and a box covering more cells than are occupied scans the occupied cells. `Random.weighted` calls `weight` once per item.
  - **Input edges.** `Touch`: a `pointerdown` for a pointer id still held (its up was lost) cancels what that id held first, instead of leaving a button held until blur. `Keyboard.scripted`: pressing an action that is already held is not a new press, as with a live keyboard.

- Updated dependencies [c2c32e0]
- Updated dependencies [9cca78b]
- Updated dependencies [6c09482]
- Updated dependencies [ecfd0f1]
- Updated dependencies [d47a4f9]
- Updated dependencies [330246e]
- Updated dependencies [7f2b2dd]
  - @typeonce/ritmo@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [0b22113]
- Updated dependencies [a0fac0a]
- Updated dependencies [a580c9c]
- Updated dependencies [a580c9c]
  - @typeonce/ritmo@0.8.0

## 0.7.0

### Minor Changes

- 84eac37: Add simulation time through `Clock.hz`, a validated `Clock.resource`, and a schedule built by `Clock.system`. A held clock sets `dt` to zero and preserves its step. Durations carry their rate, reject sub-step literals, and validate seconds from data through `durationRaw`. Restoring a clock saved at another rate fails validation.

  `FixedLoop.start` and `Replay.recorder` take `step: Clock.hz(...)` instead of `stepSeconds`, sharing one fixed step with the simulation. `HostClock` supplies host timing through an injected contract; browser hosts can use `BrowserHostClock.make(window)`. Debug runtimes use `debug: { hostClock }` and the monitor requires an explicit DOM host.

  Add `Determinism.check` over a factory of fresh headless debug runtimes and scripted inputs. It compares all component and resource values, including transient values, and reruns the first differing frame to name its system or schedule marker. Execution failures, defects, and reused runtimes fail explicitly. This checks repeatability on the current engine.

  New replay files and the lint CLI use the Ritmo name.

- 7ebd9af: One way to do each thing. Breaking changes, with no deprecated aliases:

  - **Systems fail with `Result.failure(error)`.** The `Fx` module is removed (`Fx.fail`, `succeed`, `sync`, `map`, `flatMap`, `access`, `accessService`, `provide`, `runSync`). A system returns nothing or a `Result`; returning `Result.failure(error)` rolls back its ECS writes, drops its commands and events, and types `error` into the tick result exactly like `Fx.fail` did. Replace `return Fx.fail(e)` with `return Result.failure(e)`; a returned lookup failure (`if (!found.ok) return found`) also works. `SystemDefinition` and `Schema.BoundSystem` lose their success type parameter: `SystemDefinition<Spec, E, Root, Name, Needs>`, `BoundSystem<S, Root, Spec, E, Name, Needs>`.
  - **`Feature` is removed** (`Schema.Feature.define` / `compose`). A plugin is a function `(Game, options) => System | Schedule`, like `RenderSync.system(Game, ...)`; list every fragment in one `Schema.bind(...)`.
  - **`Schema.merge` is removed**: use `Schema.bind(A, B, ...)`.
  - **A descriptor owns its validator.** `Definition` is removed: validate through the constructed descriptor (`Game.Command.entryRaw(Position, raw)`, for example in a draft built once at module load) or call the constructor (`Vector2.result(raw)`). `Command.entryResult` is removed: `entryRaw` is the one way to validate raw input at spawn. `setResult` / `updateResult` are removed from write cells: use `setRaw` / `updateRaw` on constructed descriptors. `Brand` is documented as a tool for packages that author validated value types.
  - **`Descriptor.State` is renamed `Descriptor.EntityState`** (per-entity state, not to be confused with the game-wide `Game.StateMachine`). Related names follow: `EntityStateDescriptor`, `EntityStateValue`, `EntityStateTransitions`, `isEntityState`, `EntityStateWriteCell`, and the transition failure `EntityStateMismatchError` with `_tag: "EntityStateMismatch"` and `component` (was `state`) naming the component.
  - **Silent failures are loud.** `RemovedReadView` and `DespawnedReadView` gain `lagged()`, like event readers. `describe()` reports a `relation-failure-never-read` warning for a relation that commands have related or reordered while no described system reads its failures.
  - **Devtools invariants are typed.** `Invariant.make(name, () => ...)` is replaced by `Invariant.fromInspector(Game.Inspector(name, access, check))`, where `check` returns a violation message or `undefined`. `Session.make` rejects at compile time an invariant that reads a resource, service, or machine the runtime does not provide. `Runtime.ValidateInspector` is exported for tools like this.
  - JSDoc now states when to use each of `EntityScope` / `Hierarchy`, `when` / `pauseWhen` (on a system and on `Schedule.when` / `Schedule.pauseWhen`), `tryTick` / `tick`, and `Game.StateMachine` / `Descriptor.EntityState`.
  - **`Game.System.thisTick(read)`**: wraps `readEvent(E)` or `readResource(R)` to require that every system writing it runs earlier in the same `runtime.tick(...)` call. `tick` checks it at compile time ("ApplyDamage needs Damage from this tick, but its writer UpdateFrostFields runs after it: move ..."), and calls whose order is not statically known (a read with no writer compiles); `tryTick` checks it at runtime (`TickOrderViolation`) and `describe()` reports `this-tick-order`. Schedule types gain a sixth parameter (`Order`); constraint positions accept any with `Schedule.AnyScheduleOrder`.
  - **Lint as a tool.** `ritmo-devtools lint <entry>` (and `Lint.run` in code) prints every lint of a game's schedules with its fix, and exits 1 on warnings (info does not fail). The entry module exports `lintTarget: () => { runtime, schedules, describe? }`. `Debug.Lint` gains `fix`, the change that resolves it.
  - **Replays.** `Replay.recorder(runtime, { schedule, name, keep, stepSeconds, sink, hostClock, saveOn? })` keeps the last seconds of one schedule's ticks (periodic snapshots, source-service values as changes, host sends) and saves them through a `Replay.Sink`: `Replay.memorySink`, `ReplayNodeSink` (files), `ReplayViteSink` with `ReplayVitePlugin` (dev server), and Monitor's new `replay` option ("Save replay" button). A recorded schedule whose services are not plain-data `snapshot()` sources or plain data is a compile error. `Replay.session`, `verify`, and `extract` replay a file headless. Core's `Debug.Handle` gains `observeHost` (tick start/end and sends, without tracing).
  - **`debug` takes a host clock: `debug: { hostClock }`** (`debug: true` is removed). Core and devtools read no platform clock or globals: the new core `HostClock` module is the injected contract (`HostClock.standard` is `Date.now`, `HostClock.test()` is a manual clock at 0 with `adjust(ms)` returning a `Result`, `HostClock.elapsed` clamps negative durations), and `BrowserHostClock.make(window)` in the browser package reads `window.performance`. A value that may be `undefined` (`debug: import.meta.env.DEV ? { hostClock } : undefined`) gives an optional `debug` handle that code must check, so a dev-only debug runtime needs no second runtime type; omitting `debug` attaches nothing. Devtools take the clock and host explicitly: `Session.make(runtime, { ..., hostClock })`, `Replay.recorder(runtime, { ..., hostClock })`, a replay target returns `hostClock`, and `Monitor.attach(runtime, { ..., host: window })`. With `HostClock.test()` every timing is 0, so session and replay text is identical across runs.
  - **Lookups go through declared queries.** `lookup.get(id, Q)`, `lookup.getHandle(h, Q)`, `lookup.childMatches(id, R, Q)`, and `lookup.descendantMatches(id, R, Q)` are removed: they let a system read or write components it never declared. Use `queries.x.get(id)`, `queries.x.getHandle(h)` (same intent proof), `queries.x.children(id, R)`, and `queries.x.descendants(id, R, options)` on a query in the spec. `lookup` keeps the id-returning helpers (`related`, `relatedSources`, `parent`, `ancestors`, `descendants`, `root`).
  - **Systems declare their commands.** A system has `commands` only when its spec declares them: `commands: Game.System.commands(Game.System.spawns(Position, Enemy), Game.System.inserts(Stunned), Game.System.removes(Stunned), Game.System.despawns(Enemy), Game.System.despawnsScope(Level), Game.System.relates(ChildOf))`. Each method exists only with its permission, and only for what it lists; errors name the fix ("Noise is not declared in this system's commands: add it to Game.System.spawns(...)"). Drafts built from spread arrays or conditional entries are checked over every component they may hold. `despawn` takes `match.entity` from a query proving one of the `despawns` components, or the `SpawnedId` that `spawn` / `spawnIn` returned in the same run, never a raw id. The draft builder `Game.Command.insert` is renamed `Game.Command.extend` (it clashed with `commands.insert`). Spawn-time relations in a draft (`Game.Command.relate(draft, ...)`) are part of the spawn and need no `relates`.
  - **`Game.System.thisTick(query)`**: a query that needs this tick's command changes. Its writers are systems whose declared commands can change what it matches (`spawns` covering every component it requires, or `inserts` / `removes` of any component it names, optional slots, `with`, `without`, and filters included; `despawns` never count). `runtime.tick(...)` rejects a writer that runs after the reader, and one before it with no `applyDeferred()` in between ("AimAtNewest needs this tick's commands for queries.enemies, but SpawnWave queues them with no applyDeferred() in between: add Game.Schedule.applyDeferred() after SpawnWave"). Transition bundles count at their `applyStateTransitions(...)` step (which applies queued commands first), as if every schedule in them runs, markers inside included; this now also holds for event and resource reads. `tryTick` and the `this-tick-order` lint check the same at runtime (`OrderIssue.kind` gains `"unflushedWriter"`); `tryTick` checks each schedule once. Transition schedules and bundles carry their order (a sixth / seventh type parameter, defaulting to any order).
  - **Fix: a `Game.Query(...)` written inline in a spec keeps omitted lists empty.** Without `with` (or `without`, `filters`, relation lists) an inline query in `queries: { ... }` took the spec's widened list type (every component), so it proved every component to `despawn` and `getHandle`. Omitted lists are now `[]` wherever the query is written.
  - **Devtools read declared command permissions.** `describe()` lists each system's permissions (`SystemDescription.commands`) and indexes `spawns` / `inserts` / `removes` as component writers, so `component-never-read` covers components only commands write. `relation-failure-never-read` also fires for a declared `relates` before any command ran. New `command-permission-unused` lint (info): on a debug runtime, "X may insert C but never did in this session" for systems that ran. `session.why(entity, Component)` names the systems whose `spawns` could have spawned the entity.
  - **Ignored tick failures are reported (debug only).** A failed `tick` / `tryTick` result whose `ok` nobody read is reported as a `failure.ignored` trace and host event (`frame`, `schedule`, `system`, `error`, `skipped`: the systems that did not run, `when: "next-tick" | "session-end"`) at the start of the next tick, or by the new `debug.checkIgnoredFailures()`. Core emits only. Devtools: `Session.run` stops with `reason: "ignored-failure"`, `report()` / `journal()` show "tick failure ignored: Load failed with "level file missing"; 2 later systems did not run (not read before the next tick)", the replay recorder saves on it (`saveOn.failure`), and the monitor raises an alert.

### Patch Changes

- 358401a: Link the bevy-ts migration guide from each published package README.
- Updated dependencies [84eac37]
- Updated dependencies [7ebd9af]
- Updated dependencies [358401a]
  - @typeonce/ritmo@0.7.0

## 0.6.0

### Minor Changes

- 130cb6e: Rename the package family from `@typeonce/bevy-ts*` to `@typeonce/ritmo*`.
  Update imports, workspace dependencies, type identity markers, examples, and
  documentation together. There are no compatibility aliases; use the matching
  Ritmo package for each previous Bevy TS package. The separate release preparation
  change coordinates the repository rename and retirement of the generated
  documentation site.
  Use "The agent-first type safe ECS runtime" in package metadata,
  documentation, and brand assets.

### Patch Changes

- a8e0473: Retire the generated documentation site and point package homepages, source links,
  and issue links to the Ritmo repository in the Typeonce GitHub organization.
  Keep source JSDoc and repository guides, including the Pixi walkthrough in its
  example README.
- Updated dependencies [a8e0473]
- Updated dependencies [130cb6e]
- Updated dependencies [a1f18a8]
  - @typeonce/ritmo@0.6.0

## 0.5.0

### Patch Changes

- @typeonce/bevy-ts@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [e2b2275]
  - @typeonce/bevy-ts@0.4.0

## 0.3.0

### Minor Changes

- 421a727: Add `Touch`: on-screen touch controls over an element.

  - A floating stick that appears where the thumb lands in its region, with a dead zone and a tilt of length 0 to 1.
  - Buttons with `held`/`pressed`/`released` edges that survive taps shorter than a frame. Buttons with an `aimRadius` aim by dragging (Brawl Stars style), and the aim is reported on the release. A cancelled touch (system gesture, window blur) releases with `cancelled: true`.
  - Each finger belongs to one control, so moving and attacking work at the same time. The layout is a function of the element's size.
  - `view()` returns live positions for drawing the controls, and `scripted(buttons, timeline)` plays timelines for tests.
  - Sets `touch-action: none` on the element while tracking.

  `Pointer.track` now ignores touch pointers by default (new `pointerTypes` option, default `["mouse", "pen"]`), so a finger on an on-screen control is not also a click.

- f196f48: `Touch` layouts take an optional `swipe` area: a finger landing there, and not on a button or the stick, reports how far it moved since the previous snapshot (`snapshot().swipe.delta`, in CSS pixels). This enables Genshin Impact-style controls: move with the stick on the left, and swipe anywhere else to turn or look around. Scripted timelines take `swipe` deltas per frame.

### Patch Changes

- 2b0fb7e: Add `Game.Condition.check(name, access, predicate)` (types in `@typeonce/bevy-ts/Condition`): a run condition computed by ordinary code, so conditions need no growing set of combinators. A check declares its reads like a system and receives them read-only. It may read resources, machines, and queries with no write slots and no `added`/`changed` filters; events, transition events, removed/despawned reads, relation failures, and services are compile errors, as are other games' descriptors and non-boolean predicates. Its reads become requirements of whatever it gates, through `not`/`and`/`or`, a system's `when`, and `Schedule.when`. Checks are evaluated before each gated system against committed values, so they see writes from earlier systems in the same run, and they never advance the world tick or a reader cursor. A throwing predicate propagates like a throwing system. Devtools render checks as `check(name)` and count their reads as the gated system's reads.

  Conditions now carry their requirements in one type-level field, read with `ConditionNeeds` / `ConditionNeedsFromConditions`. `MachineNeedsFromCondition(s)` remain and extract only the machines. `InputCapture.system` and `RenderSync` (`system`, `interpolate`) pass a check's requirements through their `when` option.

- Updated dependencies [2b0fb7e]
- Updated dependencies [c4d1add]
- Updated dependencies [bd9bdd5]
- Updated dependencies [bd9bdd5]
- Updated dependencies [94bdc32]
- Updated dependencies [bd9bdd5]
  - @typeonce/bevy-ts@0.3.0

## 0.2.0

### Minor Changes

- 4b3a312: Add `Pointer`: mouse and pen input over one element, with element-relative position, whether the pointer is over the element, and `primary`/`secondary`/`middle` button states with press/release edges that survive clicks shorter than a frame. It captures the pointer while a button is held, suppresses the context menu by default, and releases buttons on window blur. `Pointer.scripted`, `Pointer.recording`, and `Pointer.parseTimeline` mirror the keyboard timeline helpers for tests and replays.
- 4b3a312: Keyboard bindings can match physical keys: `Keyboard.code("KeyW")` binds by `KeyboardEvent.code`, so a position stays fixed across layouts (WASD on AZERTY) and modifiers cannot change the match (Option+W typing "∑" on macOS, Shift+1 typing "!"). Character and physical bindings mix freely on one action. Character bindings are also more robust: a key released while a modifier changed its character (W pressed, then Option, then W released as "∑") now releases its action instead of staying held. `KeyEvent` gains an optional `code`; the module docs list browser-reserved shortcuts (Ctrl/Cmd+W) that pages cannot block.
- 4b3a312: `InputCapture.system(...)` and `RenderSync.system(...)` accept `when`, run conditions like a system's own. A gated capture takes no snapshots meanwhile, so presses stay in the device until it resumes (pauses, hit-stop); a gated render sync catches up on additions, changes, and removals when it runs again. The machines the conditions read are requirements of the generated system.

### Patch Changes

- Updated dependencies [4b3a312]
- Updated dependencies [4b3a312]
- Updated dependencies [4b3a312]
  - @typeonce/bevy-ts@0.2.0

## 0.1.1

### Patch Changes

- c95a102: First release published from CI through npm trusted publishing, with provenance attestations. Declarations are now verified against consumers on both TypeScript 7 and TypeScript 6. No API or output changes.
- Updated dependencies [c95a102]
  - @typeonce/bevy-ts@0.1.1
