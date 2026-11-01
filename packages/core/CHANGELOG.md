# @typeonce/ritmo

## 0.20.0

### Minor Changes

- b5f78e7: `ritmo-tools fx`: pixel art effects as code. Each effect in a bank (`game.fx.json`) has a few drafts, each a small JavaScript module that draws one frame at a time with the palette's color names (`fx.px`, `fx.line`, `fx.disc`, `fx.ring`, `fx.ramp`, `fx.random()` from the draft's seed), and params the person can tune. Circles are drawn as pixel artists draw them: no doubles, even steps, and `fx.ring` takes a width with no pinholes.

  `fx check` runs every draft and lists what an agent cannot see by reading code, with the frames and pixels where: errors (a module that does not load or throws, nothing drawn, randomness not from the seed, colors outside the project's `pixel.config.json` palette or over its `maxColors`) and warnings (cut off at the canvas edge, a one-shot that starts late or does not end empty, a loop that jumps, blinking, lone-pixel noise, jaggies, doubles, pinholes, flicker, and an effect too faint on one of the game's backgrounds, listed in the bank's `backdrops`). A draft's `accept` records a warning judged deliberate, with why. `fx look` writes a contact sheet of every frame for the agent to look at, with the person's comments or a rule's spots ringed. `fx review` opens a local page where a person watches the drafts side by side, slowed down or frame by frame, picks one, tunes it, and clicks a pixel to pin a comment to it; `fx notes` reads it all back. `fx resolve` marks comments done with a reply the person sees. `fx render` writes the chosen draft as a sprite sheet PNG with its JSON (Pixi, Phaser, Aseprite; each frame's anchor from the draft's `anchor`, and `meta.loop`) and a GIF. The page also runs on the website with an example bank: https://ritmo.typeonce.dev/tools/fx/.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-fx`, with the pixel art craft the checks measure. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-fx .agents/skills/ritmo-fx
  ```

- b101512: **A skill for the first minute: `skills/ritmo-onboarding`.** When strangers are about to play a game (a playtest, a jam, a release), the agent reads it next to the `ritmo` skill. It says what teaches a game: the rule on screen in action before anything is asked, something at stake that the rule changes from the first seconds (a first contact that costs nothing, a second that is real), the rule told once in the game's own pieces at the player's pace and then the controls taught by doing, one thing per stretch of play, a lesson for what contradicts what a player of the genre expects, a lesson that cannot be passed by chance, a few words where the eyes are and never the only channel, a failure that names the rule, and the controls shown being done (a hand for a gesture, the key or button) with every input the game accepts given a result under the rule. It turns the strangers you watched into the game's checks: a bot per way of skipping the lesson (doing nothing, the obvious thing at full force, one input repeated, the input you did not mean) that must never clear a lesson or win what follows it, the rule's promise as a fuzzed invariant, and a playtest as a replay. After a playtest you tell the agent what the stranger did, not what they said; when rounds keep failing the same way it changes the lesson or the rule instead of the hints. `SETUP.md` step 2 links it; the `ritmo` skill points to it.

  `ritmo-devtools lint` notes `ritmo-onboarding` as well when the project does not link it (`note  skill-not-linked  ritmo-onboarding`), without changing the exit code, so a project set up before this release sees it until it adds the link.

- 72f2c40: **A skill for finishing a game: `skills/ritmo-polish`.** When a game is past its prototype and the user asks to polish it, make it feel better or more finished, add juice, or review its feedback, transitions, or UI, the agent reads it next to the `ritmo` skill. It says what polish is (every effect that changes what the player perceives without changing the simulation, so the headless tests and replays pass with the effects on or off), how to work (list what the game already has, walk the player's path, rank the gaps from the core verb out, let the human pick, one round at a time, never claim a touch feels good), and the principles that decide whether a touch reads right: every input gets an answer on the channel where the eyes are; the biggest answer goes to the rarest moment, scaled and capped; sound, visual and vibration for one event land on the same tick; motion says what it means; nothing reads as something else; each mode has its own language; the moments between play (death to retry at once, the results as the reward); never make the player wait for what they can skip; UI that holds still; shake, flash and vibration as the player's choice; and sound by the same rules. `SETUP.md` step 2 links it; the `ritmo` skill points to it.

  `ritmo-devtools lint` notes `ritmo-polish` as well when the project does not link it (`note  skill-not-linked  ritmo-polish`), without changing the exit code, so a project set up before this release sees it until it adds the link.

### Patch Changes

- 7b0dcd2: `ritmo-tools fx`: ramps, recolor, palette editing, a stand-in sprite, draft comparison, and reach across seeds.

  - A bank's `ramps` name fades through its palette (`"fire": ["white", "yellow", "orange", "red"]`), and drafts draw with them by name: `fx.ramp("fire", v)`. A draft's `recolor` draws one ramp with another's colors (`{"fire": "frost"}`), so a blue fire is the same file with one line in the bank; the review page's Tune section picks it too. A ramp the bank does not have is an error.
  - A bank's `standIn` is a PNG of one of the game's sprites with the pixel at its feet (`{"file": "art/hero.png", "anchor": [10, 45]}`). The page and `fx look` draw it behind every effect, so its size reads against a body. It stands on the effect's anchor, moved by the effect's `standIn` offset (`[0, 24]` for a hit's target), or not at all with `false`. `fx look --alone` and the page's Background section leave it out.
  - `fx look --compare` writes one picture of every draft of an effect, a row each, the same moments in each column, to weigh the drafts against each other.
  - `fx check` also runs each draft with seeds 2, 3, and 7, and warns (`clipped-seed`) when the draft's own seed keeps it inside the canvas only by luck.
  - The review page's Palette section lets the person change the bank's colors (picked from the project's `pixel.config.json` palette when it has one) and its ramps (steps picked, reordered, added, removed; new ramps), for every effect at once. `fx notes` lists the palette and ramps as they are now.
  - New shapes: `fx.oval` and `fx.ovalRing` (ellipses with clean steps, for pools and shock rings flat on the floor), `fx.sparkle` (a star glint), and `fx.streak` (a moving spark's trail along a ramp).

  The `ritmo-fx` skill adds the bank's stand-in and ramps to its loop, `--compare` before showing drafts, open-source effects to read for choreography, phases with a white hero frame, and a table of what you see and the usual fix.

- 7853fea: `ritmo-pixel-art` skill: the principles that make a game's pixel art read as one game, before the tool. One grid (the game's size in art pixels from the smallest detail, one pixel size, fitting the screen by a whole number, fractions kept in the simulation and rounded at the draw, text on the grid or on one layer), readability (what the player must notice is read first, gameplay signals in levels, silhouettes), one style (the characters set the rules, one palette of hue-shifted ramps, tiles that hide the grid unless the grid is the game, the pixel craft, one light), motion, and judging (in the game at display size on the target screen, references as named qualities, exceptions as written decisions). The `ritmo-tools pixel` part is unchanged under "The tool", and the `ritmo` skill's `ui-and-render` playbook points at the grid principles for camera, scaling, parallax, and text.

## 0.19.1

## 0.19.0

### Minor Changes

- 832169a: `ritmo-tools music`: game music as JSON songs (a tempo, a key, bars, and tracks of notes, each track one of sixteen synthesized instruments: piano, electric piano, acoustic and distorted guitar, bass guitar and a reese bass, strings, flute, marimba, bells, a pad, a supersaw lead, two chiptune voices, and a clean and a punchy drum kit; `"compressor": true` squeezes a rock or electronic song louder and punchier). `music listen <song> <audio.wav>` hears a hum, a whistle, a tapped beat, or a recording and writes its tempo, key, and melody into the song as its reference, for the agent to build the song around; a voice that sits off pitch the whole way is heard in tune. `music check` measures the song and lists what usually sounds wrong (clipping, notes outside the key or an instrument's range, a buried track, a melody that wandered from the reference); `music render` writes a seamless looping WAV, a MIDI file, and with `--stems` each track alone. `music review <song>` opens a local page where a person plays the song, records a hum from the microphone, edits notes on a grid, swaps instruments, and comments on bars; `music notes` gives the agent the comments and a list of the person's edits.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-music`. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-music .agents/skills/ritmo-music
  ```

- 818ad0b: `ritmo-tools sound`: game sounds as JSON recipes. Agents write sounds into one bank file, check them (`sound check`: length, loudness, clipping, a late start, a click at the end, much louder or quieter than their kind), make takes nudged one way (`sound vary --toward heavier`), and write WAV files (`sound render`). `sound review <bank>` opens a local page where a person listens, picks among takes, tunes with sliders, and approves or notes each sound; `sound notes` gives the agent the person's answers.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-sounds`. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-sounds .agents/skills/ritmo-sounds
  ```

### Patch Changes

- 6e69a51: `ritmo-tools pixel`: project PNGs. A project PNG is the source picture with its recipe stored inside (one uncompressed `iTXt` chunk, keyword `ritmo-pixel-recipe`; the pixels are untouched), so one file reopens a whole session. The web page exports one (Export → **Project PNG**, for pictures and animation sheets) and restores every setting when it opens one. `pixel fix --project` writes `<name>.project.png`, and `check`, `fix`, `sheet`, and `preview` run the recipe a project PNG holds (a `--recipe` file wins over it; the report says `"storedRecipe": true`). A project PNG is not a game asset: `exiftool -all=` or `oxipng --strip safe` turns it back into the plain picture.

  Grid detection finds cells that a screenshot or resize stretched a few percent on one axis, instead of falling back to a fraction of the cell (a sprite came out 25×68 instead of 28×32).

  The `ritmo-pixel-art` skill says when to hand a person a project PNG, and how to spot and strip one.

- 612c30a: `ritmo-tools pixel`: several animations on one sheet. Each row of frames is one animation by default (`animation-1`, ... in reading order; where two blocks sit side by side, a row across both is split where they meet). The page's **Animations** panel chooses which are exported (**In**/**Out**), plays, renames, and sets each one's speed and loop, and **Split here** (between two frames of the chosen animation) and **Join with** regroup them. Each animation gets its own canvas. The sheet PNG holds every exported animation, each from a new row; its JSON names each one under `animations` and `frameTags`, frames are named `<animation> 0`, ..., and `meta.fps` is a map from animation to frames per second. `pixel sheet` writes a GIF per animation (`<name>.<animation>.gif`) and frames under `.frames/<animation>/`, lists the animations in its report (`animation.animations`), and takes `--animations "walk=1-4;explode=5-14"` and `--only walk,explode`.

  Breaking, for recipes and code reading the sheet: `sheet.fps` and `sheet.loop` moved onto each animation (`sheet.animations[i].fps`, `.loop`). A recipe without `animations` still reads, as one animation of every frame at its `fps` and `loop`. The report's `animation.fps` and `animation.loop` are now per animation in `animation.animations`, and `output` is the size of the sheet written.

  The `ritmo-pixel-art` skill says how to name and pick animations with `--animations` and `--only`.

- 1a36354: Rollback sessions no longer end with `CheckpointLost` (`Released` for `"window"`) while every wrong guess is within `maxRollback`, when the runtime keeps no more checkpoints than that. A rollback rewinds to the checkpoint of its tick, which the runtime keeps, and the session then took a second checkpoint for the same tick: each rollback spent one slot of the window for nothing, so with several seats correcting guesses inside one window it covered fewer than `maxRollback` ticks (4 seats, `maxRollback: 12`, `checkpoints: 12`: lost at frame 25). The session now reuses the checkpoint it rewound to, as `RollbackOptions.maxRollback` already says: the runtime must keep at least `maxRollback` checkpoints.

  If you drive `runtime.checkpoint` and `runtime.rewind` yourself, do the same: a rewind keeps the checkpoint it went to, so take no new one for that tick when it runs again (the `Checkpoint` module's example shows it).

## 0.18.0

### Minor Changes

- 8322cd7: New package `@typeonce/ritmo-tools`: the `ritmo-tools` command, asset tools for agents. `ritmo-tools pixel` is the pixel fixer: it checks, fixes, and makes pixel art, and fixes animation sheets from image generators (`ritmo-tools pixel sheet`) onto one grid and palette, lined up, as a sprite sheet with its JSON (Pixi, Phaser, Aseprite) and a GIF. Run it with `npx @typeonce/ritmo-tools pixel <command>`, or add it as a dev dependency.

  `@typeonce/ritmo` ships a new skill, `skills/ritmo-pixel-art`, telling agents which `ritmo-tools pixel` command to run for each case. Link it next to the others:

  ```sh
  ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo-pixel-art .agents/skills/ritmo-pixel-art
  ```

## 0.17.0

### Minor Changes

- 39aeaf4: **Breaking: an optional query slot is the read cell, or `undefined` when the entity does not hold the component.** `Game.Query.optional(X)`, `Game.Query.optionalRelation(R)`, and `Game.Query.optionalRelated(R)` (and `select` slots of `RenderSync.system`) gave a slot that was always an object, so `if (data.hero !== undefined)` compiled and was always true, and there were two ways to read it (`present` then `get()`, or `value()`). The slot is now `ReadCell<T> | undefined`: reading it without a check does not compile (`'data.sprite' is possibly 'undefined'`). `present`, `value()`, and the `OptionalReadCell`, `PresentOptionalReadCell`, and `AbsentOptionalReadCell` types are removed. A component whose own value can be `undefined` stays unambiguous: an `undefined` slot means absent, and `get()` returning `undefined` means present.

  ```diff
  - burning: data.burning.present
  + burning: data.burning !== undefined
  - const parent = !data.parent.present ? undefined : data.parent.get()
  + const parent = data.parent?.get()
  - const stride = data.stride.value()
  + const stride = data.stride?.get()
  - if (data.sprite.present) draw(data.sprite.get())
  + if (data.sprite !== undefined) draw(data.sprite.get())
  - QueryTypes.OptionalReadCell<T>
  + QueryTypes.ReadCell<T> | undefined
  ```

  To match only entities that hold a component ("is this the player?"), list it in the query's `with: [Player]` filter instead of an optional slot.

  `@typeonce/oxlint-plugin-ritmo` removes `ritmo/use-cell-value`: with one way to read an optional slot there is nothing to steer between. Delete `"ritmo/use-cell-value"` from `.oxlintrc.json`: oxlint stops with `Rule 'use-cell-value' not found in plugin 'ritmo'` while the config names it.

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

### Patch Changes

- 15c55ac: Less garbage every frame, with no API change. A system run that queues no commands and writes no resource or machine now allocates nothing; before, it allocated about 400 bytes, because V8 allocates a new table on every `Map`/`Set` `clear()`, even of an empty one. A schedule of 100 small systems runs about 2.5× faster, and the top-down example game makes about 27% less garbage per frame. A frame that requests no state transition skips sorting the empty queue. `Keyboard`, `Gamepad`, and `Pointer` snapshots share one idle state object for every action not in use, as `Controls` already did.
- 9346953: The `@typeonce/oxlint-plugin-ritmo` README lists built-in oxlint rules that pair well with Ritmo, each with the Ritmo mistake it catches: a `Result` checked with `if` instead of `.ok`, a switch over a closed set that misses a new member, an asset load or upload that is never awaited, `[object Object]` in HUD text, and oxlint's default `correctness` rules. The type-aware ones need `oxlint-tsgolint` and `oxlint --type-aware`.

  The packages' sources pass these rules: unnecessary type assertions and default type arguments are gone, unused imports are removed, and switches over closed sets name every member. The published types are the same types, written without their default arguments.

- 3d1f862: `Scalar.spring(current, target, { frequencyHz, dampingRatio }, dt)` moves a damped spring toward a target: a value with momentum that overshoots and wobbles back, for squash and stretch, a wobble, or a pop. Its state is a `Scalar.Spring` record (`{ value, velocity }`) that passes straight back in. The motion is computed exactly, so it is the same at any step rate and a long frame cannot make it blow up. A vector springs one axis at a time.

  `Collide2.moveCircle` and `MoveResult.blocked` now say that `blocked` does not tell which wall was touched or whether the circle stands on one, with an example of a grounded check that probes with `sweepCircle`.

  The `ritmo` skill's rendering playbook now says that a part that is not an entity (a procedural limb, a trail) is render state, and that cosmetic randomness uses its own `Random.make` stream, never the world's random resource.

## 0.16.1

## 0.16.0

### Minor Changes

- 9b0379e: **Breaking: runtime-only helpers leave the public surface.** The relation error constructors `Relation.missingEntityError`, `missingRelationError`, `missingTargetEntityError`, `selfRelationNotAllowedError`, `hierarchyCycleError`, `missingChildEntityError`, `duplicateChildError`, `childNotRelatedToParentError`, `childSetMismatchError`, and `mutationFailure` are internal: only the runtime reports relation failures. `Runtime.ValidateSchedules` and `Runtime.AnyRequirements` are removed. A game reads relation failures as values and narrows on `_tag`; the failure types (`Relation.Relation.MissingEntityError`, ...) stay exported:

  ```diff
  - const failure = Relation.missingEntityError(id)
  + if (result.error._tag === "MissingEntity") { /* result.error.entityId */ }
  ```

  Every exported type helper of `@typeonce/ritmo` now has JSDoc.

### Patch Changes

- be9af72: `ritmo/no-float-timers` says what to do with a timer that must stop while the world clock runs (hit-stop, a menu over gameplay): measure it against a second clock that holds, `Clock.resource` advanced by `Clock.system(Game, { name, resource, hold })`, so its deadlines wait with it. Only time scaled by a fraction is a real float, kept with a disable comment that gives the reason. The README and the `Clock.system` JSDoc show the pattern.
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

- 9290521: A replay saved to disk verifies when the world holds `-0`. `runtime.checksum()` hashed `-0` apart from `0`, but JSON writes `-0` as `0`, so every replay read back from a file failed `Verify.acrossEngines` and `ritmo-devtools verify` ("DIVERGED at tick N") while the same replay verified in memory. `checksum()` now hashes `-0` as `0`, as a save writes it. Replays recorded before this fix with `-0` in the world still hold the old hashes: record them again.

  `Desync.compare` and every devtools printout write `-0` with its sign, so a `-0` / `0` difference no longer reads `0 -> 0`.

- 1b55d21: The skill is a front door: `SKILL.md` says where the docs are, routes each change to its playbook, and holds the principles (new: "Prove it headless"). Each playbook states its goal, the principles that apply, the steps whose order matters, and the check that proves the change; steps that only listed APIs now point to the JSDoc or README that documents them.

  Reference material moved to `skills/ritmo/references/`, loaded from the playbook step that needs it:

  - `references/schemas.md`: one schema library, guards and brands per library (was the skill's "Validating and saving values" and "Branded values").
  - `references/zod.md` and `references/effect.md`: the codec helpers (were `playbooks/zod.md` and `playbooks/effect.md`).
  - `references/third-party.md`: what `ritmo-devtools scan` cannot see (was the skill's "Third-party code").
  - `references/spatial-grid.ts`, with a note in `references/spatial-grid.md`: the broad phase to copy (was `playbooks/spatial-grid.md`). A game that copied the old module needs no change: the code is the same.

## 0.15.0

### Minor Changes

- 3a195b7: **Cooldowns and timers are deadlines: the step they end on, exact through saves and rollback.** A timer counted down by `dt` drifts by a rounded float every tick, and the float it saves means nothing once the fixed step changes. `Clock.Deadline<Hz>` is the absolute step a duration ends on, a plain number branded with the clock's rate:

  ```ts
  // ready: Clock.Deadline<60> | null, its schema narrowing with Clock.isDeadline(step)
  const Weapon = Descriptor.ConstructedComponent(
    z.object({ ready: z.unknown().refine(Clock.isDeadline(step)).nullable() })
  )("Game/Weapon");

  const time = resources.time.get();
  const { ready } = data.weapon.get();
  if (ready === null || Clock.reached(time, ready)) {
    fire();
    data.weapon.set({ ready: Clock.deadline(time, Clock.duration(step, 0.5)) });
  }
  ```

  - `Clock.deadline(time, duration)`, `Clock.reached(time, deadline)`, and `Clock.remaining(time, deadline)` (whole steps left, for a readout). A deadline of a 60 Hz clock does not compile against a 30 Hz `Time`, and a raw number is not a deadline.
  - `Clock.isDeadline(step)` is the guard for a game's schema, like `Entity.isHandle`: any whole number of steps, 0 or more.
  - New lint rule `ritmo/no-float-timers` for simulation files: reports `timer -= dt`, `cooldown - time.dt`, and the like, and names `Clock.deadline` / `Clock.reached`. `position.x += velocity.x * dt` is integration and is not reported. Turn it on in the simulation override of `.oxlintrc.json`: `"ritmo/no-float-timers": "error"`.

- d01a735: **Zod schemas work with Ritmo: the schema back to the saved form is under `"~encode"`, not `encode`.** Zod (from 4.1) gives every schema an `encode()` method, which Ritmo read as its encode schema: `Descriptor.ConstructedComponent(z.object(...))` did not compile, and with a cast `runtime.snapshot()` threw `Cannot read properties of undefined (reading 'validate')`. The key now starts with `~`, like Standard Schema's own `~standard`, so no library's methods collide with it. A Zod, Valibot, or ArkType schema of plain data passes as it is; Ritmo's tests now save and load a schema of each, and of Effect, through JSON.

  - **Breaking: a codec carries its encode schema as `"~encode"`.** The Effect helper from the skill's `references/effect.md` (or a hand-written codec) renames the key:

    ```diff
     return {
       "~standard": Schema.toStandardSchemaV1(json)["~standard"],
    -  encode: Schema.toStandardSchemaV1(Schema.flip(json))
    +  "~encode": Schema.toStandardSchemaV1(Schema.flip(json))
     }
    ```

    A transforming schema without it fails with `give it a ~encode schema back to the saved form`.

  - **Values that transform** (a `Date`, a `Map`) save through a `"~encode"` from any library. Zod's comes from the new `references/zod.md` helper, built on Zod's own `safeEncode`: `Descriptor.ConstructedComponent(codec(z.codec(z.iso.datetime(), z.date(), { decode, encode })))`. With Valibot, ArkType, or any other Standard Schema library, write the reverse schema by hand:

    ```ts
    const Born = Descriptor.ConstructedComponent({
      "~standard": v.pipe(
        v.string(),
        v.isoTimestamp(),
        v.transform((text) => new Date(text))
      )["~standard"],
      "~encode": v.pipe(
        v.date(),
        v.transform((date) => date.toISOString())
      ),
    })("Game/Born");
    ```

  - **Handles and deadlines inside a game's schema** are built from their guards with a schema that narrows to the guard's type: `z.unknown().refine(Entity.isHandle(Root))` in Zod, `v.pipe(v.unknown(), v.guard(...))` in Valibot, `type("unknown").narrow(...)` in ArkType, `Schema.declare(...)` in Effect. The docs said `z.custom(guard)`, which types the value as `unknown`.

- 45458dc: **A stream of the relation edges a target's despawn dropped.** When the target of a `Descriptor.Relation` despawns, the runtime removes every edge to it. A system now reads those edges once, with the same rules as `readRelationFailures`: each reader sees what was dropped since its own previous run, a reader gated by `when` drops what was published meanwhile, one under `pauseWhen` reads it later, a reader that fell behind by more than `Runtime.streamCapacity` records sees `lagged() === true`, and checkpoints rewind it.

  ```ts
  const DropTargets = Game.System(
    "Game/DropTargets",
    {
      droppedRelations: { lost: Game.System.readDroppedRelations(Targeting) },
      commands: Game.System.commands(Game.System.inserts(Idle)),
    },
    ({ droppedRelations, commands }) => {
      for (const { source } of droppedRelations.lost.all())
        commands.insert(source, [Idle, {}]);
    }
  );
  ```

  - Records are `Relation.Relation.Dropped`: `{ relation, source, target }` as entity ids. Only a target's despawn records an edge: `commands.unrelate`, relating the source elsewhere, and the source's own despawn record nothing. A `Descriptor.Hierarchy` records nothing, since its children despawn with their parent.
  - Inspectors can read `droppedRelations` too.
  - Debug traces carry a `relationDropped` effect on the despawn that dropped the edge, and devtools journals it as `Game/Targeting from e7 to e12 dropped: e12 despawned`. `describe()` lists a system's `droppedRelations` (`reads dropped relations: ...` in devtools), and `streams()` reports the `droppedRelation` streams.
  - **Breaking for code that switches over debug types:** `Debug.Effect` has a new `relationDropped` kind, `Debug.StreamStatus["kind"]` and `Debug.MissedRead["kind"]` have a new `droppedRelation` kind, and `Debug.SystemDescription` has a new `droppedRelations` field. Add the case to an exhaustive `switch`, and the field to a hand-built `SystemDescription`.

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

- b77b17d: **A library that keeps its own world (Rapier, Box2D) can run inside a rewound schedule: `Checkpoint.rewindable`.** `runtime.checkpoint(simulate)` refused any service that is not a `snapshot()` source or plain data, since a rewind would call it again for every tick run again. A rewindable service gives a typed `save` and `restore`: every checkpoint keeps its `save` output (freed when the checkpoint is released), and `runtime.rewind` restores it and makes the result `current`.

  ```ts
  const physics = Checkpoint.rewindable(world, {
    save: (world) => world.takeSnapshot(),
    restore: (bytes) => {
      const restored = RAPIER.World.restoreSnapshot(bytes);
      return restored === undefined
        ? Result.failure({ _tag: "CorruptSnapshot" as const })
        : Result.success(restored);
    },
  });
  const Physics = Descriptor.Service<typeof physics>()("Game/Physics");
  // Systems read `services.physics.current` each run; `runtime.checkpoint(simulate)` compiles.
  ```

  - Cost: one `save` per checkpoint for each rewindable service the runtime was given, one `restore` per rewind. A runtime without one pays nothing.
  - A failing `restore` fails the rewind with the new `RewindError` member `RestoreFailed { service, error }`, changing nothing. `runtime.rewind` types it by each service's name and `restore` error; a runtime without rewindable services never returns it. `RewindError` takes the failures as a parameter (`RewindError<never>` for none); bare `RewindError` covers every runtime. Netcode reports it as `CheckpointLost`.
  - Not in saves or checksums: `runtime.snapshot()` does not include a rewindable service, `runtime.restore(save)` (and a netcode resync) leaves it as it is, and `runtime.checksum()` does not cover it. Mirror what gameplay reads from the library into components.

  **Breaking (types only):** bare `Checkpoint.RewindError` (and so `Netcode.CheckpointLost["error"]`) now includes `RestoreFailed`. An exhaustive `switch` on its `_tag` adds the case; one over `runtime.rewind(...)`'s own result needs nothing for a runtime without rewindable services:

  ```diff
    switch (error._tag) {
      case "OtherRuntime": ...
      case "Released": ...
  +   case "RestoreFailed": console.error(error.service, error.error); break
    }
  ```

- c20f20b: **Descriptor metadata: a field's unit, range, and hint next to its schema.** Every component and resource constructor (`Component`, `ConstructedComponent`, `TransientComponent`, `Resource`, `ConstructedResource`, `TransientResource`) takes an optional `meta` option keyed by the value's top-level fields. Each field gets `unit?: string`, `range?: readonly [min, max]` (number fields only), and `hint?: string` (one sentence an agent reads).

  ```ts
  const Health = Descriptor.ConstructedComponent(z.object({ hp: z.number() }))(
    "Game/Health",
    {
      meta: {
        hp: {
          unit: "points",
          range: [0, 100],
          hint: "Hit points left; 0 despawns the entity.",
        },
      },
    }
  );
  const Tuning = Descriptor.Resource<{ speed: number }>()("Game/Tuning", {
    meta: { speed: { unit: "px/s", range: [0, 400] } },
  });
  ```

  - A key that is not a field of the value does not compile (`not a field of this value`, with the value's fields under `fields`); `range` on a non-number field does not compile (`` `range` is only for number fields``); a key other than `unit`, `range`, or `hint` does not compile. A malformed option from an unchecked caller throws, naming the descriptor.
  - Metadata never replaces validation: the schema still decides what is valid, and snapshots do not save it. It is checked once at the constructor, frozen, and listed by `runtime.debug.describe()` as `meta` on every `ComponentDescription` and `ResourceDescription` (`{}` when none).
  - Resource constructors now take an options argument (`ResourceOptions`); `ComponentOptions` gains `meta`. New types: `FieldMeta`, `MetaField`, `CheckedMeta`, `CheckedOptions`, `MetaInput`.
  - Devtools: `session.report()` raises an `out-of-range` warning for every write (system writes, resources, spawns, inserts) of a number outside its declared range: `e1 Game/Health.hp written as 120, declared range [0, 100] by Game/Heal at frame 42`. The scan runs only in debug sessions; production runtimes never read the metadata.
  - Devtools: `session.describe()` lists each field's metadata under its component or resource; `Format.fieldMeta(field, meta)` prints one field's line. The monitor's Entity tab shows units next to values and each field's unit, range, and hint in the value's tooltip.

- 01959dd: Step one frame a system at a time.

  - `session.step(name)` begins one frame of a named schedule and returns a `SteppedFrame`: `until(System)` runs the steps before that system and stops there, `next()` runs exactly one step (a system or a marker), `check()` asks the invariants mid-frame, and `finish()` runs the rest and returns the same `RunResult` as `run(name, { frames: 1 })`, with labels and invariants evaluated at the end of the frame. `until` takes the system value, and only a system the schedule runs as a step compiles. `journal`, `why`, and `dump` show the partial frame.
  - Core: `runtime.debug.beginFrame(schedule)` returns a `Debug.FrameCursor` (`next()`, `remaining()`) for the frame `tryTick(schedule)` would run, with the same commits, markers, reader cursors, and trace and host events. While a frame is open, `tick`, `tryTick`, `send`, `snapshot`, `checksum`, `restore`, `checkpoint`, `rewind`, and another `beginFrame` throw; `session.run` and `session.step` throw until `finish()`.
  - `Format.step` prints one schedule step.
  - `Session.Session` takes a third type parameter, the record of schedules, which `Session.make` infers.

### Patch Changes

- 637fa1f: **Adaptive input delay.** `inputDelay` is a fixed number of ticks, and the right value depends on a connection that changes during a match. Give `adaptiveDelay` instead and the session moves the delay within the bounds from the measured round trip:

  ```ts
  Netcode.rollback(runtime, { ...options, adaptiveDelay: { min: 1, max: 4 } });
  session.status().inputDelay; // the delay in use
  ```

  - The delay starts at `max` and moves to `ceil(roundTripMS / 2 / step ms)` for the slowest other seat (the smoothed round trip), clamped to the bounds, once that target held for 4 measurements in a row (one every 250 ms).
  - Each seat moves only its own delay. Every input message already names its tick, so a change needs no agreement and no protocol change; seats may run different delays. A rise leaves the ticks it skips idle (`seats.idle`); a fall drops the local input for as many frames (`Advanced.input` is `undefined`), so no tick gets two inputs.
  - Every peer must give the same `inputDelay`, or the same `adaptiveDelay.max`: after a save, that many ticks are idle for every seat.
  - Giving both `inputDelay` and `adaptiveDelay` does not compile (`give inputDelay or adaptiveDelay, not both`). Bounds that are not whole numbers with `0 <= min <= max` fail with `InvalidOptions` (`field: "adaptiveDelay"`).
  - `Status` gains `inputDelay` (the delay in use) and `delayChanges` (how many times it moved).
  - `MemoryNetworkLink` links gain `setLatency(ms)`, to change a peer's latency mid-match in tests.
  - The netcode playbook recommends `adaptiveDelay` for play over the internet.
  - **Breaking: `inputDelay` moved from `Netcode.Options` to the new `Netcode.Delay`.** Options passed inline to `rollback` and `lockstep` are unchanged. Where options are typed by hand, add the delay type:

    ```diff
    - const options: Netcode.Options<PlayerInput> = { seats, seat, links, hostClock, step, inputDelay: 3 }
    + const options: Netcode.Options<PlayerInput> & Netcode.Delay = { seats, seat, links, hostClock, step, inputDelay: 3 }
    ```

- 44e9b42: **Effects under rollback: `session.events(Event)` hands host code the simulation's events as confirmed, predicted, and withdrawn streams.** A rolled-back tick runs again and publishes its events again, so a sound played from an event played once per run, and every game de-duplicated events by confirmed tick by hand. A session now owns that: each `session.events(descriptor)` call is one host reader, pulled after the session advanced.

  ```ts
  const hits = session.events(Hit); // an event of the runtime's schema
  for (const { tick } of hits.withdrawn()) particles.cancel(tick); // a rollback undid this tick's hits
  for (const { tick, value } of hits.predicted())
    particles.burst(tick, value.at); // may still be undone
  for (const { value } of hits.confirmed()) sounds.play(value.kind); // exactly once per hit
  const lost = hits.lost(); // EventsLost when the reader fell more than Netcode.eventWindow ticks behind
  ```

  - `confirmed()` hands out each event once, when its tick can no longer run again (a lockstep session confirms every tick it runs). `predicted()` hands out events of ticks that may still be rolled back, stamped with the tick. A tick a rollback runs again keeps what was handed out when its events are the same (plain data, compared by value); otherwise `withdrawn()` names it and its new events are predicted again. A resync withdraws every predicted tick.
  - An event outside the runtime's schema does not compile. `Netcode.Session` takes the schema's events as a third type parameter (`never` by default): a session annotated as `Netcode.Session<Input, TickError>` reads none. Annotate it with the events to read, `Netcode.Session<Input, TickError, typeof Hit>`, or let `Netcode.rollback(...)` infer it.
  - New exports: `EventStreams`, `EventRecord`, `Withdrawn`, `EventsLost`, `eventWindow`.
  - Replaces acting on events once `status().confirmed` passed their tick: the `Checkpoint` docs and the netcode playbook now point to `session.events(...)`.

## 0.14.0

### Minor Changes

- 70d054e: **Rewind a runtime in memory, for rollback netcode and client prediction.** `runtime.checkpoint(simulate)` marks the world between ticks, and `runtime.rewind(checkpoint)` puts it back exactly: ticking `simulate` again gives the same results, bit for bit, as a runtime that never rewound (entity ids, values and their change ticks, relations, scopes, resources, machines, queued commands, unread events, and the read positions of `simulate`'s systems). See the `Checkpoint` module, and the skill's new `playbooks/netcode.md`.

  ```ts
  const history = new Map<number, Checkpoint.Checkpoint<typeof Root>>();
  history.set(tick, runtime.checkpoint(simulate));
  runtime.tick(simulate);

  // Real input for an earlier tick differs from the guess: go back and run again.
  const rewound = runtime.rewind(history.get(wrongTick)!);
  if (!rewound.ok) resync(rewound.error); // Released: older than the window
  ```

  - Taking a checkpoint copies only resources, machines, and queues; the first change to a page of values, an entity, a relation, or a scope after it keeps what it replaced. The runtime keeps the last `checkpoints` (a new option of `Game.Runtime.make`, `Checkpoint.defaultWindow` = 16 by default); an older one, one newer than a checkpoint rewound to, and every one taken before a `restore` fail with `Released`. A checkpoint of another runtime fails with `OtherRuntime`.
  - A schedule that would not rewind does not compile, and the error (`__fixCheckpoint__`) names the fix: a service that is neither an input source (`snapshot()`) nor plain data, a system with `local` state (in its state transitions too), or a schedule widened to a schedule type.
  - Systems and inspectors outside the rewound schedule, like renderers, see a rewind as ordinary changes. An entity the rewind took away and the ticks after it brought back under the same id is seen as changed, never as despawned and spawned again, so `RenderSync` keeps its node.
  - **`runtime.checksum()`**: a fingerprint of what `snapshot()` saves, as 16 hex digits, that does not depend on how the world was built (component order, object key order). Peers compare it to catch a desync; gated like `snapshot`, and returns a `Result`.
  - `Schedule.Source<Data>` and `Schedule.IsPlain<T>`: the input-source shape and the plain-data check that replays and checkpoints share. `Schedule.SystemsIn` is exported.

  **Devtools:**

  - **Breaking: `Replay.Source` and `Replay.IsPlain` moved to core**, as `Schedule.Source` and `Schedule.IsPlain`.

    ```diff
    -const Controls = Descriptor.Service<Replay.Source<Input>>()("Game/Controls")
    +import type * as Schedule from "@typeonce/ritmo/Schedule"
    +const Controls = Descriptor.Service<Schedule.Source<Input>>()("Game/Controls")
    ```

  - **Breaking: replay checkpoint hashes are `runtime.checksum()`.** Replays recorded with an earlier version report every checkpoint as diverged; record them again. A runtime passed to `Replay.recorder` or `Replay.session` needs `checksum`, which every runtime with `snapshot` has.

  **Lint:** `handle-tick-result` also reports a dropped `runtime.rewind(...)` result: a released checkpoint changes nothing, and the ticks meant to run again would run on top of the present.

- dbfbd9d: **New package: `@typeonce/ritmo-netcode`, online multiplayer.** A session per peer exchanges inputs over a `NetworkLink` and ticks the simulation with every seat's input: `Netcode.rollback` runs at once on guesses and rolls back with the runtime's checkpoints when real input contradicts one; `Netcode.lockstep` waits for every seat. Seat 0 starts the match and every resync from one save that every peer restores at the same tick; `session.rate` slows the peer that runs ahead; peers compare checksums of confirmed ticks, and a mismatch stops the session with `Desynced` until `resync()`.

  ```ts
  const seats = Netcode.seats(PlayerInput, { count: 2, idle })                       // the simulation's input source
  const session = Netcode.rollback(runtime, { simulate, seats: seats.value, seat, links: [WebSocketNetworkLink.make(socket)], hostClock, step })
  FixedLoop.start({ ..., rate: session.value.rate, update: session.value.update({ input: readInput, onHalted: report }) })
  ```

  - Transports: `WebSocketNetworkLink.make(socket)` (a relay; the browser's, Node's, Deno's, or Bun's WebSocket), `WebRtcNetworkLink.make(channel)` (between peers), `MemoryNetworkLink.make(...)` (seeded latency, jitter, and loss, for headless tests), or any `{ send, receive, status }`.
  - What does not compile: a rollback simulation that cannot be rewound, one whose requirements the runtime does not provide, and a runtime that cannot save. What fails at construction, as a typed `Result`: a seat out of range, seats another session took or the runtime does not provide, and a `maxRollback` beyond the checkpoints the runtime keeps.
  - The skill's `playbooks/netcode.md` now drives the package instead of a hand-written loop.

  **Core:**

  - `FixedLoop.start` takes `rate`, read once per frame, within `FixedLoop.rateRange` (0.9 to 1.1): how fast host time runs into the accumulator, for a networked session's pacing. A value outside the range stops the loop with an `InvalidRate` failure, a new member of `FixedLoop.Failure`.
  - **`runtime.restore` sets the next entity id to the save's**, where it used to keep the higher of the save's and the runtime's own. The same save restored in two runtimes now allocates the same ids afterwards, whatever each held before; peers of a networked game need it. A handle kept from before a restore may now name an entity spawned after it: drop handles across a restore, as their ids could already name restored entities.

  **Lint:** `keep-simulation-headless` reports `WebSocket`, `RTCPeerConnection`, and `RTCDataChannel` with their own message: online play runs the simulation under a netcode session, and remote input goes through `Netcode.seats`, never `runtime.send(...)`.

  **Devtools:** `Desync.compare(mine, theirs)` lists every difference between two saves of a tick, entities by id and values by path: the report for a `Desynced` session made with `keepSnapshots: true`.

- 8aa1e85: **Component values are stored per component, in pages of entity ids**, and a system's run keeps the old values of only the slots it writes. This is the storage layout unboxed numbers build on. Performance is about the same as before; queries, cells and snapshots keep their API.

  - **Breaking: `changed` means the value differs.** A write counts as a change only when the new value differs from the one before the system's run: a different number or string (`NaN` equals `NaN`), or a different object. Writing back the value you read, or an equal number, no longer counts. Inserting a component still counts as added and changed. The devtools journal records only these writes.

    ```diff
    -// re-set every frame to mark it changed
    -data.position.set(data.position.get())
    +// write a new value when it moves; keep writing back the same one when it does not
    +data.position.set({ x: position.x + velocity.x, y: position.y + velocity.y })
    ```

  - **Breaking: a query match is valid during the run that produced it.** Its cells throw when used later. This covers a match kept in `local` state, captured in a closure, or returned from an inspector: before, such a match kept reading the entity's current values, even after it left the query. Keep the id or a handle, and resolve it again.

    ```diff
    -local.target ??= queries.enemies.each()[0]
    -const at = local.target?.data.position.get()
    +local.target ??= queries.enemies.each()[0]?.entity.id
    +const found = local.target === undefined ? undefined : queries.enemies.get(local.target)
    +const at = found?.ok ? found.value.data.position.get() : undefined
    ```

  - **Breaking: `runtime.inspect(...)` throws while a schedule is running**, like `snapshot` and `restore`. Read the world from a system, or inspect between ticks.

### Patch Changes

- c3719a5: **Faster component writes and spawns, with the same semantics.** A write through a query cell now stamps its change tick as it happens, and committing a system run no longer replays its writes; a system still does not see its own writes in its `changed` filters, and a rolled-back run or transition phase still restores the values and their change ticks. An entity's storage is sized to the components it holds, not to every component in the schema. On the community ECS benchmark cases, iteration with writes is 1.3–1.8× faster and spawning and despawning 1.4× faster.
- adb4066: **An event the host sends with `runtime.send` reaches a reader that has not run yet.** A reader starts holding events on its first run, so until then a sent event was kept for only two `runtime.tick(...)` calls: a request sent before the first fixed step (a menu setting, a title card holding the clock) was dropped when the render schedule ticked first, with `lagged()` reporting nothing. A sent event now waits for the first reader of its stream to run, up to `Runtime.streamCapacity` entries, as the `runtime.send` docs promised. A game that placed its request handlers in `setup` too, only so they listen before the host sends, can keep them in `update` alone.

  - **Behaviour:** a run that sent an event before its reader first ran now delivers it. A recorded replay or fingerprint of such a run plays differently: re-record it with the upgrade.
  - Events systems emit are unchanged, and so is a second reader that first runs after the first reader read the event: it does not see it.

- 97e95fb: JSDoc: `QueryMatch` shows how to type a game helper that takes query matches (`QueryMatch<typeof Game.schema, typeof PlayerRead>`), and `each()` points to it. The `FixedLoop` module lists servers as a host and shows a server loop that wraps `setInterval` with `FixedLoop.source`, with no renderer.
- 343660e: **Numbers are stored unboxed.** A component value that is a number (a plain or branded number such as `Scalar.Finite`, a number literal union, an entity id) is kept in a typed array in its page. Reading one returns the number and writing one copies it in: nothing is allocated, and change detection and rollback compare plain numbers. Nothing to declare: the runtime stores each value by what it is, so a component whose value is sometimes a number (`number | { x: number }`) works too. Queries, cells, commands and snapshots keep their API. On the community ECS benchmark cases, iteration with number writes is about 1.4× faster than before, and reading object values through a query is about 25% faster.
- d24258e: **The `RuntimeServices` docs show how to pass services through a game's own function.** Bound it by `RuntimeServices`, not `RuntimeServices<any>`: every service set satisfies the bound, `const` keeps the exact one, and a missing service still fails at `tick`.

  ```ts
  export const makeRuntime = <const Services extends RuntimeServices>(
    services: Services
  ) => Game.Runtime.make({ services, resources: { Score: 0 } });
  ```

- cfe332a: **Skill and JSDoc: recognise flat mode records and same-run despawns.** The mechanic and state playbooks and the self-check name the symptoms of state that should be a machine: a system that returns early on a mode field (gate it with `Game.Condition.inState` in `when` on a `Game.StateMachine`), and a nullable or kind-only field next to a `kind` or `phase` field (split it into `Descriptor.EntityState` or `Game.StateMachine` states). `commands.despawn`'s JSDoc says the entity still matches this system's queries for the rest of its run, and to skip the ids it despawned with a local `Set`.

## 0.13.0

### Minor Changes

- 791b52a: **Each state of a `Descriptor.EntityState` carries its own fields, so a value can never pair a state with data from another one.**

  - **Breaking: `Descriptor.EntityState(name, states, options?)` takes a record of states**, each `{}` (no data) or one schema for all of its data. The value is a tagged union: `_tag` names the state, next to that state's fields. Snapshots and `setRaw` decode each state's data with its schema, and `_tag` is the only field Ritmo adds. The `transitions` graph is unchanged. Number states are gone: state names are the record's keys.

    ```diff
    -const Phase = Descriptor.EntityState("Game/Phase", ["ready", "windup"] as const, { transitions: { ready: ["windup"], windup: ["ready"] } })
    +const Phase = Descriptor.EntityState("Game/Phase", { ready: {}, windup: z.object({ frames: z.int() }) }, { transitions: { ready: ["windup"], windup: ["ready"] } })
    -Game.Command.spawn([Phase, "ready"])
    +Game.Command.spawn([Phase, { _tag: "ready" }])
    -if (data.phase.get() === "windup")
    +if (data.phase.get()._tag === "windup")
    ```

    A closed set of values with no moves between them (a team, a direction) is not an entity state: declare it with `Descriptor.ConstructedComponent(z.literal(["Down", "Up"]))("Game/Facing")`, with your schema library's literal schema.

  - **Breaking: the write cell moves with `transition({ from, to, data })`**, which takes all of `to`'s fields, so nothing carries over from `from`. A state without fields takes no `data`. With a union `from`, `to` must be a move every one of them allows.

    ```diff
    -data.phase.transition("ready", "windup")
    +data.phase.transition({ from: "ready", to: "windup", data: { frames: 12 } })
    ```

  - **`update({ state, data })`** changes the fields of the current state without leaving it: `data` maps the current value to the new fields, and a field the state does not have does not compile, spread or not. Like `transition`, it writes only while the entity is in `state`, and otherwise returns `EntityStateMismatch`. **Breaking:** it replaces the cell's `update(f)` and `updateRaw(f)`, which could write any state; `set(value)` and `setRaw(raw)` stay for resets. `EntityStateMismatchError`'s `expected` and `actual` are now state names.

  - **`Descriptor.EntityStateOf<typeof Contact, "air">`** is the value of one state (or, without the state, of the component), for game functions that take or return it. `EntityStateValue` is removed.

- b3d6502: **Each state of a `Game.StateMachine` carries its own fields, so a game-wide mode and the data only it has are one value: a dialogue with its pages, a game over with its winner.**

  - **Breaking: `Game.StateMachine(name, states, options?)` takes a record of states**, each `{}` (no data) or one schema for all of its data, the same way `Descriptor.EntityState` declares states. The value is a tagged union: `_tag` names the state, next to that state's fields. The array form and number states are gone.

    ```diff
    -const Flow = Game.StateMachine("Game/Flow", ["Menu", "Playing", "GameOver"])
    +const Flow = Game.StateMachine("Game/Flow", { Menu: {}, Playing: {}, GameOver: z.object({ winner: z.string() }) })
    -Game.Runtime.machine(Flow, "Menu")
    +Game.Runtime.machine(Flow, { _tag: "Menu" })
    -nextMachines.flow.set("GameOver")
    +nextMachines.flow.set({ _tag: "GameOver", winner: "Red" })
    -if (machines.flow.get() === "Playing")
    +if (machines.flow.is("Playing"))   // or machines.flow.get()._tag === "Playing"
    ```

    A machine kept next to a resource that must agree with it (`Mode` plus a `Dialogue` that is `null` while not talking) becomes one machine whose state holds the resource's data.

  - **Breaking: a queued move takes the target's full value.** `nextMachines.x.set(value)` and `setIfChanged(value)` take the state with all of its fields, and nothing carries over from the current state; the state and its fields commit together at `applyStateTransitions(...)`. `getPending()` returns the full value. `setIfChanged` skips only a value equal to the current one; the same state with other fields re-enters, like `set`.

  - **`Game.System.updateMachine(M)`**, declared in `machines`, reads the machine and changes the fields of its current state at once: `machines.x.update({ state, data })`, a compare-and-set like the entity-state `update` that returns `MachineStateMismatch` (and, for a sub-state without a value, `SubStateInactive`) instead of writing. A field the state does not have does not compile, spread or not. It never changes the state, runs no enter or exit schedules, and publishes no transition event; it is rolled back with a failed system or exit phase. The state name changes only at the commit; the current state's fields change immediately. Inspectors and `Condition.check` keep only `Game.System.machine(M)`, and a system declares one slot per machine.

    ```ts
    machines: {
      mode: Game.System.updateMachine(Mode);
    }
    machines.mode.update({
      state: "Talking",
      data: (talking) => ({ ...talking, typed: talking.typed + 1 }),
    });
    ```

  - **`Machine.StateOf<typeof Mode, "Talking">`** is the value of one state (or, without the state, of the machine), like `Descriptor.EntityStateOf`. Both build on the shared `Descriptor.StateFields`, `StateDefinitions`, `StateName`, and `StateValueOf`, which replace the `EntityState*` names of the same types.

  - **Unchanged, by state name:** `machines.x.is(state)`, `Game.Condition.inState(M, state)`, `stateChanged`, `onEnter` / `onExit` / `onTransition`, `despawnOnEnter` / `despawnOnExit`, and sub-states' `within: [Parent, state]`. Transition snapshots and events keep `from` and `to` as state names; read the entered state's fields with `machines.x.get()` (in `onExit`, it is still the state being left).

  - **Breaking: snapshots are format version 3.** A machine is saved as its tagged value and restored through its state codecs; `InvalidMachineState` carries the schema's issues (each `path` says which field), and `InactiveSubState.requires` is a state name. A version 2 save is rejected with `UnsupportedVersion`.

  - **Breaking, debug output:** `Debug.MachineDescription.current`, `MachineDump`, `NextStateWrite.value`, and `NextStateReplacement` values are machine values (`Machine.AnyValue`), and `TransitionEvent.from` / `to` are state names. `SystemEvent.machines` lists each `update` as a `Debug.MachineWrite`, and `SystemDescription.machines.updates` lists the machines a system updates. This fails only at run time: a test that compared `dump().machines["Game/Round"].current` to a state name now compares an object, so read `.current._tag` for the state name.

- 835f6ba: **Values are validated and saved through the game's own Standard Schemas. Ritmo ships no validators.** Any [Standard Schema](https://standardschema.dev) works (Zod, Valibot, ArkType, Effect through `Schema.toStandardSchemaV1`); a value that changes shape when saved takes a schema with an `encode` back to its saved form, `Descriptor.Codec<Type, Encoded>`.

  - **Breaking: `Decode` is removed.** Use the game's schema library. With Zod: `Decode.struct({ x: Decode.number })` becomes `z.object({ x: z.number() })`. With Effect, write the `codec` helper from the skill's `references/effect.md` once and pass every schema through it: `codec(Schema.Struct({ x: Schema.Finite }))`.

    ```diff
    -const Position = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number, y: Decode.number }))("Game/Position")
    +const Position = Descriptor.ConstructedComponent(z.object({ x: z.number(), y: z.number() }))("Game/Position")
    ```

    Each `Decode` codec and its replacement (Effect through the `codec` helper):

    | `Decode`               | Zod                                                 | Effect                                          |
    | ---------------------- | --------------------------------------------------- | ----------------------------------------------- |
    | `number` (finite)      | `z.number()`                                        | `Schema.Finite`                                 |
    | `integer`              | `z.int()`                                           | `Schema.Int`                                    |
    | `string`               | `z.string()`                                        | `Schema.String`                                 |
    | `boolean`              | `z.boolean()`                                       | `Schema.Boolean`                                |
    | `literal("a", "b")`    | `z.literal(["a", "b"])`                             | `Schema.Literals(["a", "b"])`                   |
    | `nullable(c)`          | `c.nullable()`                                      | `Schema.NullOr(c)`                              |
    | `array(c)`             | `z.array(c).readonly()`                             | `Schema.Array(c)`                               |
    | `struct({ ... })`      | `z.object({ ... })`                                 | `Schema.Struct({ ... })`                        |
    | `handle(Root, Intent)` | `z.unknown().refine(Entity.isHandle(Root, Intent))` | `Schema.declare(Entity.isHandle(Root, Intent))` |

  - **Breaking: `ConstructedComponent` and `ConstructedResource` take a schema**, not a `{ result }` constructor. `Descriptor.fromStandardSchema` is gone: pass the schema itself. Raw input (`setRaw`, `updateRaw`, `Game.Command.entryRaw`, raw values given to `Game.Runtime.make`) is in the schema's saved form. A schema whose value is not its saved form (a `Map`, an `Option`, a class) or whose saved form is not plain data does not compile, and the error says to give it an `encode`. Validation is synchronous: a schema that answers with a promise fails. Failures are `{ _tag: "SchemaIssues", issues }`, the library's own issues with their paths.

  - **Breaking: each state of `Descriptor.EntityState` and `Game.StateMachine` is `{}` or one object schema for all of its data**, instead of a record of field codecs. Ritmo adds only `_tag`. `set`, `update`, `get`, and `is` are unchanged.

    ```diff
    -Game.StateMachine("Game/Flow", { Menu: {}, GameOver: { winner: Decode.string } })
    +Game.StateMachine("Game/Flow", { Menu: {}, GameOver: z.object({ winner: z.string() }) })
    ```

  - **Breaking: `runtime.snapshot()` returns `Result<WorldSnapshot, SnapshotError>`.** It runs each schema's `encode`, and fails with `UnencodableComponent`, `UnencodableResource`, or `UnencodableMachineState` when one rejects a value. `restore` decodes with the same schemas. A descriptor without a schema makes `snapshot` uncallable, with `"<Name> needs a schema"`. The format stays at version 3. Fix: `const saved = runtime.snapshot(); if (saved.ok) store(saved.value)`.

  - **Breaking: `Entity.decodeHandle` and `InvalidHandle` are replaced by the guard `Entity.isHandle(Root, Intent?)`**, `(raw: unknown) => raw is Handle<Root, Intent>`. Build a handle schema from it with the library: `Schema.declare(Entity.isHandle(Root, Health))`, `z.unknown().refine(Entity.isHandle(Root, Health))` (`z.custom` would type the value as `unknown`).

  - **Breaking: `Brand.refine`, `Brand.all`, and `Brand.Constructor` are removed;** `Brand.Brand` and `Brand.Branded` stay. Brand values through the schema library (`z.number().brand(...)`, `Schema.brand(...)`).

  - **Breaking: `Clock.InvalidTime` is removed.** A time saved at another rate fails restore with `SchemaIssues` whose message names both rates.

## 0.12.0

### Minor Changes

- 04a2ac7: **Transition reads say when they are empty, and inspectors cannot drain input.**

  - **Breaking: `transitions.x.get()` returns `TransitionSnapshot | undefined`.** A system declaring `transitions: { x: Game.System.transition(M) }` reads the transition being applied, which exists only inside the machine's transition schedules (`onEnter` / `onExit` / `onTransition`). Anywhere else the runtime returned `undefined` while the type promised a value. Narrow it, or use `Game.System.readTransitionEvent(M)` from a regular schedule:

    ```diff
    -const { from, to } = transitions.app.get()
    +const transition = transitions.app.get()
    +if (transition === undefined) return
    +const { from, to } = transition
    ```

  - **An inspector that declares a drained service does not compile.** `Game.Inspector(..., { services: { input: Game.System.consumeService(Input) } }, ...)` reports `an inspector must not drain a service`: an inspector reading the world (devtools, the host's view) would steal the game's input for that tick. Declare the service with `Game.System.service`, and drain it in one system.

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
  - **Breaking: `Keyboard.Snapshot` is `{ actions, vectors, used }`.** Read `input.actions.jump.pressed` instead of `input.jump.pressed`. Hand-written timelines and bindings are unchanged.
  - **Breaking: `Touch.Snapshot` renames `buttons` to `actions`** (each still a `ButtonState` with `aim` and `cancelled`) **and replaces `touched` with `used`.** Read `input.actions.fire` instead of `input.buttons.fire`. `Layout.buttons` and `View.buttons` are unchanged.
  - Every device snapshot (`Keyboard`, `Gamepad`, `Pointer`, `Touch`) has `used`: something pressed in this window or held, or a stick or swipe in use. Releases do not count, so a blur or a disconnect does not change `lastUsed`.
  - **`Game.System.consumeService(Service)`** declares a service a system drains on each run (an input source's `snapshot()`, a message queue); it is the only way to call the draining methods (see `System.Consumes`). `describe()` warns with the new `service-consumed-twice` lint when a consumed service has more than one placement, for example the same input captured in a fixed and a render schedule, where each capture sees only the presses since the other ran. `SystemDescription.consumes` lists them.
  - **Breaking: `InputCapture.system` keeps its declared access**: it consumes the source and writes the resource, so a `Game.System.thisTick` reader of the resource placed before the capture no longer compiles (the error names both systems and the fix: place the reader after the capture), and capturing one source twice is reported by `describe()`. The exported `InputCapture.CaptureSystem` type is removed: let the system's type be inferred.
  - **`Debug.serviceLints`** lets a service value add findings to `describe()` lints, reported as `service-lint` with the service as subject; `Controls` uses it to list every device that lacks an action.

### Patch Changes

- e46f284: **Documentation pass over every public module.** Every export has JSDoc saying what it is for and which neighbouring API to use instead; examples that no longer compiled (`Session.make` without `hostClock`, `Replay.session`, the `Pointer` rebind) are fixed; `Debug.Lint` lists every lint code the runtime emits. The `stale-target` lint's fix now names `queries.x.getHandle(handle)`.

## 0.10.0

### Patch Changes

- 7002f4d: **Everything a game's agent needs now ships with the packages, and `ritmo-devtools lint` reports simulation modules the lint rules miss.**

  - **Breaking: `ritmo-devtools lint` fails on an uncovered simulation module.** Every module the entry loads that the `ritmo/keep-simulation-headless` override in `.oxlintrc.json` does not cover is reported as `uncovered-simulation-module`, and the command exits 1. Add the module (or its folder) to the simulation override's `"files"`, or stop importing values from it. Modules loaded only inside `lintTarget` are not checked. Requires Node 22.15 or newer (`engines.node` is now `>=22.15`).
  - **An agent skill ships with `@typeonce/ritmo`** in `skills/ritmo/SKILL.md`, for every change: where the docs are, and principles for where a game's code and state belong. Link it into the folder the game's agent reads skills from, for example `ln -s ../../node_modules/@typeonce/ritmo/skills/ritmo .agents/skills/ritmo`. `SETUP.md` in `@typeonce/ritmo` is the one-time setup: the base packages and checks every game uses, the add-ons, and linking the skill.
  - **Every package ships its `CHANGELOG.md`.** The upgrade notes for 0.8.0 and 0.9.0 are in the `@typeonce/ritmo` changelog.
  - **JSDoc corrections.** Examples no longer provide randomness or time as services (use the `Random` resource and `Clock`), the `Command` module example declares its commands, inspector docs state that `added`/`changed` reads report records since the inspector's previous evaluation, and every example uses prefixed names (`"Game/Position"`). Guidance that lived only in the repository's guides (spawn order, `ReadonlyValue` helpers, re-entering a state, `thisTick` and plugin systems, service effects and rollback) is now in the JSDoc.
  - Package READMEs link other packages' READMEs by GitHub URL, so the links work on npm.

- 388a696: **The Ritmo skill routes each change to a playbook, and simulation code names no renderer type.**

  - **Breaking: `ritmo/keep-simulation-headless` reports type-only renderer imports** (`import type { Container } from "pixi.js"`, `export type ... from "three"`) and subpath imports of `@typeonce/ritmo-render` and `@typeonce/ritmo-pixi`. A schema that names a renderer type ties the simulation to that renderer. Move the renderer service (a `Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()(...)`) and the systems that use it into render code; services are not registered in the schema, so nothing else changes:

    ```diff
    -// src/game/schema.ts
    -import type { Sprite } from "pixi.js"
    -export const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
    +// src/render/sprites.ts
    +import type { Sprite } from "pixi.js"
    +export const Sprites = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Game/Sprites")
    ```

  - **The skill in `skills/ritmo` now has playbooks**: one per kind of change (a mechanic, content, UI and rendering, a bug fix, a refactor, state and upgrades), each a short list of steps that ends with the check that proves it. `SKILL.md` routes to them and keeps the principles. A game that already links the skill folder gets them on upgrade.

## 0.9.0

### Upgrading

0.9.0 rejects several calls that compiled before but were always wrong.
Fix each error where it is reported; the messages name the fix.

- **`Runtime.make` always returns a `Result`.** When nothing provided can
  fail, its type is `Success`: read `.value`. When a constructed resource
  may be provided, check it as before.

  ```diff
  -const runtime = Game.Runtime.make({ services, resources: { Score: 0 } })
  +const runtime = Game.Runtime.make({ services, resources: { Score: 0 } }).value
  ```

- **A query match is valid only during its run.** Keeping a match in
  `local` and reading or writing it later throws once its entity was
  despawned or lost the component. Keep the entity id or a handle, and
  resolve it with `queries.x.get(id)` / `getHandle(handle)`.
- **A look-alike descriptor must behave like the registered one.** A
  descriptor built elsewhere with the same kind and name but different
  behaviour (an entity state, a constructor, `immutable`, transient) throws
  when its query first runs; use the descriptor the schema registers.
- **New lint `next-state-replaced`.** On a debug runtime, two systems
  queuing different next states for one machine before the same marker are
  reported. Decide in one system, or check `nextMachines.x.getPending()`
  before setting.

- **Draft relations need `relates`.** A system that spawns a draft built
  with `Game.Command.relate(...)` declares the relation:

  ```diff
  -commands: Game.System.commands(Game.System.spawns(Errand))
  +commands: Game.System.commands(Game.System.spawns(Errand), Game.System.relates(WalkerOf))
  ```

  The `relation-failure-never-read` lint then sees these relations: read
  their failures (`Game.System.readRelationFailures(WalkerOf)`) and handle
  them, for example by despawning a child whose parent was gone when it
  spawned.

- **A command target picked from several queries must be valid for each.**
  `commands.despawn(cond ? a.entity : b.entity)` needs both queries to prove
  a `despawns` component; resolve the entity through one query, or branch
  and call the command in each branch. A raw id is never a target, not even
  as one side of a conditional.
- **Conditional and spread entries count as maybe present.** A requirer a
  draft may hold needs its requirements surely held:
  `spawn(Game.Command.spawn(...parts))` with a widened array fails when a
  part requires another; list the required components as fixed entries.
- **`Runtime.make` names unknown resource keys.** Fix the spelling, or
  remove the key.
- **Queries that can never match fail to compile.** Remove the component
  from `without` or from the required side.
- **A bundle's transition schedules require their machine.** Provide it with
  `Game.Runtime.machine(...)`, or drop the schedule.
- **Registries take their own kind.** Move a resource out of `components`,
  and so on.
- **Type-level:** `EntityRef` / `EntityMut` `Proves` and `Lacks` parameters
  are contravariant and default to `never`; `EntityDraft` has a fourth
  parameter (`Relates`). Code that names these types with explicit
  arguments updates them; inferred code is unchanged.
- **Removed duplicates.** Use `Descriptor.Hierarchy` / `Descriptor.Relation`
  instead of `Relation.Hierarchy` / `Relation.Relation`, and
  `Schema.fragment({})` instead of `Schema.empty()`.
- **Permissions name at least one entry**, and a system declares one slot
  per resource (a write or changed view reads too).
- **Optional slots read with `value()`**: `cell.value()` replaces
  `cell.present ? cell.get() : undefined`.
- **A `SpawnedId` is valid only in the run that spawned it.** A `despawn`
  or `remove` given one kept from an earlier run is skipped and reported
  by the `stale-target` lint. Keep the entity id or a handle and resolve it
  through a query (`queries.x.get(id)`), then pass `match.entity`.
- **Descriptor values cannot be `any` or `never`.** Give the value a type;
  use `unknown` for a value no system reads, and `Descriptor.Tag` for a
  marker.
- **A saved component cannot require a transient one.** Make the requirer
  transient too, or give the required component a constructor.
- **Filtered queries have no lookups.** Resolve entities through a second
  query without `added` / `changed` filters:

  ```diff
  -Game.System("Follow", { queries: { moved: Moved } }, ({ queries }) => {
  -  const target = queries.moved.getHandle(handle)
  +Game.System("Follow", { queries: { moved: Moved, targets: Targets } }, ({ queries }) => {
  +  const target = queries.targets.getHandle(handle)
  ```

- **`onExit` / `onTransition` schedules cannot contain `applyDeferred()`.**
  Their commands are applied at the next `applyDeferred()` after the
  marker; a failure in the exit phase now undoes the whole phase.
- **Provide each service and machine once** in `Runtime.services(...)` /
  `Runtime.machines(...)`.
- **Snapshots carry `gameVersion`.** Saves without it restore as version 0. Code that builds a `Snapshot.WorldSnapshot` by hand adds
  `gameVersion: 0`. To change a game's save format, pass
  `saves: Snapshot.migrations(...)` to `Game.Runtime.make` instead of editing
  raw saves before `restore`.
- **Keep random state with `Random.draw`.** Declare the resource with
  `Descriptor.ConstructedResource(Random)`, start it with `Random.seed(n)`
  (the runtime is then made as a `Result`), and draw with
  `Random.draw(resources.rng)` instead of `Random.make(state)` plus a `set`.
  `Random.integer` / `range` now throw on bounds with nothing to draw, and
  `SpatialGrid` on non-finite input.
- **New lints `stale-target` and `stream-loss-unread`** on debug runtimes.
  For the second, check `lagged()` where a missed entry matters and rebuild
  from queries when it is true.
- **Behaviour:** `Collide2` now stops a circle that starts exactly touching
  a wall and moves into it. A game that fingerprints its simulation
  re-records the fingerprints with the upgrade.

- **`FixedLoop` moved to `@typeonce/ritmo`.** Import it from core. The
  browser's animation-frame source is now `BrowserTickSource.make(window)`;
  a source wrapped with `FixedLoop.source(...)` is unchanged.

  ```diff
  -import { FixedLoop } from "@typeonce/ritmo-browser"
  -const source = FixedLoop.animationFrames(window)
  +import { FixedLoop } from "@typeonce/ritmo"
  +import { BrowserTickSource } from "@typeonce/ritmo-browser"
  +const source = BrowserTickSource.make(window)
  ```

### Minor Changes

- c2c32e0: **API additions from a second review.**

  - **Writes take what reads return.** `set`, `update`, `emit`, `runtime.send`, `Command.entry`, and plain `[Descriptor, value]` entries accept `ReadonlyValue<T>`, so a value read from one cell (deeply readonly) can be written to another without a copy or a cast.
  - **`Clock.durationOfSteps(step, n)`** builds a duration from a whole number of steps, instead of a round trip through seconds and `durationRaw`. A literal zero, negative, or fractional count does not compile; a computed one throws.
  - **`Game.Entity.id(handle)`** returns the entity id a handle names, so games no longer store the id beside the handle.
  - **Save migrations.** `Game.Runtime.make({ saves: Snapshot.migrations(Snapshot.migration(1, ...), Snapshot.migration(2, ...)) })`: snapshots carry a `gameVersion` (the last step; 0 without migrations and for older saves), and `restore` runs every step after the save's version in order, checking the structure after each, before validating as usual. A save newer than the last step fails with `NewerGameVersion`. Steps must be numbered 1, 2, 3, ... in order (checked at compile time and at runtime).
  - **Docs** now state that a system does not see its own writes as changes (it does see its own events), how long `Condition.stateChanged` holds, that a sub-state value set at the marker its parent leaves is dropped, and that `restore` keeps a current resource the save lacks.

- 9cca78b: **One shape for `Runtime.make`, and runtime guards from a review of 0.8.0.** See Upgrading above.

  - **Breaking: `Runtime.make` always returns a `Result`.** It returned the bare runtime or a `Result` depending on the resource values present at runtime, while its type decided from the keys of the provided type, so resources typed `{ Score?: ... }` produced a bare runtime the type called a `Result`. The type is now `Success<Runtime>` when nothing provided can fail (read `.value`), and a `Result` to check when a constructed resource may be provided.
  - **`thisTick` checks a writer that shares its reader's display name.** Systems may share a display name; the static check skipped any writer named like the reader. It now tells the reader apart by its system type.
  - **New lint `next-state-replaced`** (warning, debug runtimes): a next state one system queued and another replaced with a different value before the same `applyStateTransitions(...)`, naming both. Observed lints (this one and `requirement-violated`) no longer need `nameSchedules` to appear. `Debug.NextStateReplacement` describes an entry.
  - **A query match used after its run throws a named error.** Reading through a match kept past its run (in `local`) returned the internal absent marker once the entity was despawned, and writing put a removed component back without the insert path.
  - **A query descriptor that behaves unlike the registered one throws**: a look-alike (same kind and name) that adds or drops entity-state transitions, a constructor, immutability, or transience. Look-alikes that behave the same keep working.
  - `Scalar.Finite` and the `Vector2` / `Scalar` arithmetic helpers document that results keep the brand without re-validating, finite while they stay within `±Number.MAX_VALUE`.

- 6c09482: **`FixedLoop` moves to core, so any host can drive it.** See Upgrading above.

  - **`FixedLoop` is now exported from `@typeonce/ritmo`** (`import { FixedLoop } from "@typeonce/ritmo"`). Its API is unchanged. `@typeonce/ritmo-browser` no longer exports it.
  - **`BrowserTickSource.make(window)`** in `@typeonce/ritmo-browser` replaces `FixedLoop.animationFrames(window)`. It is the browser's `TickSource`, named like `BrowserHostClock`. Native shells, desktop runtimes, and renderer tickers wrap their own frames with `FixedLoop.source(...)`.
  - **Package sources compile without DOM types.** Core, math, render, browser, and pixi reach no DOM global, and the compiler now rejects one. Published code is unchanged.

- ecfd0f1: **One way to do each thing, and docs that match the code.** See Upgrading above.

  - **Removed** `Relation.Hierarchy` / `Relation.Relation` (use `Descriptor.Hierarchy` / `Descriptor.Relation`), `Schema.empty()` (use `Schema.fragment({})`), and `Debug.MemberFor` (described the removed `debug: true`). `Relation.PairBrand` is now exported as a type.
  - **Command permissions need at least one entry**: `Game.System.spawns()` with nothing no longer compiles (it made `commands.spawn` say spawn is not declared).
  - **Redundant resource and event slots are rejected**: a `readResource` next to another slot of the same resource, or one resource or event twice in the same mode. A `changedResource` next to a `writeResource`, and reading the events a system emits, stay allowed.
  - **`value()` on optional query cells** returns the value, or `undefined` when the entity does not hold the component.
  - JSDoc now matches the code: `Game.Command.spawn` and `entryRaw` name `extend`, `Schedule.when` says bundle transition schedules are not gated, `Clock.every` is false on step 0, and `EntityStateWriteCell.transition` says when to use `set` instead.

- 330246e: **Safety follow-ups from a second review.** Each closes a way a game could go wrong silently; see Upgrading above.

  - **A `SpawnedId` is valid only in the run that spawned it.** Kept in a closure or resource and passed to `commands.despawn` / `commands.remove` in a later run, it could name an entity despawned meanwhile whose id was reused. Such a command is now skipped, traced as a `staleTarget` effect, and reported by the new `stale-target` lint (`Debug.StaleTarget`). Keep the entity id or a handle and resolve it through a query.
  - **`any` and `never` are not descriptor values.** `Descriptor.Component<any>()`, `Resource`, `Event`, `Service`, and the transient variants fail at the constructor: `any` turned off every check on the descriptor, and `never` erased the fragment listing it.
  - **A saved component cannot require a transient one.** `Schema.bind` rejects `Schema.requires(Ghost, Trail)` when only `Trail` is transient: a restore brought `Ghost` back without it. A transient requirer may still require a transient component.
  - **Queries with `added` / `changed` filters have no lookups.** `get`, `getHandle`, `single`, `children`, and `descendants` failed with `QueryMismatch` whenever the target had not changed since the system's previous run; they no longer compile there. Declare a second query without filters to resolve entities. `each()` and `singleOptional()` are unchanged. The handle types are now `QueryIteration` and `QueryLookups` (`QueryHandle` combines them).
  - **A transition's exit phase is one transaction.** When a system in `onExit` / `onTransition` fails, everything the phase did (component writes, resources, events, queued next states and commands, stream positions) is undone and the transition stays queued, so the retry starts from the same state instead of running the earlier exit systems twice. These schedules can no longer contain `applyDeferred()`.
  - **A service or machine provided twice does not compile.** `Runtime.services` / `Runtime.machines` kept the last of two provisions; the second now fails, naming it.
  - **`RenderSync` recovers from dropped removals.** After a pause longer than a stream keeps entries, the removals it missed left nodes on screen; when its removal stream reports `lagged()`, it now destroys every node whose entity no longer matches. Give each `RenderSync.system` its own registry.
  - **New lint `stream-loss-unread`.** On a debug runtime, a reader of events, transition events, removed, despawned, or relation failures that lost entries without checking `lagged()` is a warning, and one reading under `pauseWhen` without checking it is noted (`Debug.StreamLoss`).

- 7f2b2dd: **Stricter types from a review of 0.8.0.** Each change rejects code that was always wrong; see Upgrading above.

  - **A command target chosen from several queries is checked for every one of them.** `commands.despawn(cond ? a.entity : b.entity)`, `insert`, and `remove` compiled when either target was allowed, and a raw id joined with a match (`cond ? match.entity : match.entity.id`) passed as a match. `EntityRef` / `EntityMut` proof parameters are now contravariant (proving nothing is `never`), so a union of refs keeps only what all of them prove.
  - **Drafts and inserts check components they may hold.** A conditional or spread entry holding a component with requirements now needs those requirements surely present, in `commands.spawn` and `commands.insert`. Fixed entries before or after a spread count as held.
  - **Spawning a draft that stages relations needs `relates`.** `Game.Command.relate(draft, ChildOf, parent)` now requires `Game.System.relates(ChildOf)` on the spawning system, like `commands.relate`. `EntityDraft` gains a fourth type parameter, the relations it stages.
  - **`thisTick` counts components named inside `Query.anyOf`** at compile time, as `tryTick` already did.
  - **`Runtime.make` rejects an unknown resource key** next to known ones, naming it.
  - **A query that can never match is rejected:** a component in `without` that a read or write slot, `with`, or a plain `added` / `changed` filter requires.
  - **A plain `added` / `changed` filter proves its component** (`Query.Proven`, `ProvesComponent`): its matches hold it, so `despawn`, `insert`, and `getHandle` accept them. A `Query.anyOf` member proves nothing alone.
  - **A transition schedule requires its machine**: `applyStateTransitions(transitions(onEnter(M, ...)))` on a runtime without `M` fails with `Missing machine`, and `tryTick` reports it.
  - **A descriptor in the registry of another kind is rejected** (`components: { Score }` with a resource), naming where it belongs, at compile time and when an erased fragment is built.

### Patch Changes

- d47a4f9: **Runtime fixes from a review of 0.8.0.** No API changes; each fix restores what the docs already promised.

  - **Sub-states enter with their parent.** A sub-state now gets its entry value at the parent's commit, before any `onEnter` schedule runs. A failing `onEnter` of the parent no longer leaves it without a value (`inState` false and `set` failing with `SubStateInactive` until the parent came back), and its `despawnOnEnter` scopes no longer despawn what the parent's `onEnter` just spawned. The `onEnter` schedules still run parents first.
  - **A queued transition survives a transition schedule setting the same machine.** A value queued before `applyStateTransitions(...)` is committed there even when an `onEnter` / `onExit` of an earlier machine also calls `set` on it; that newer value waits for the next marker.
  - **`snapshot` and `restore` throw while a schedule is running**, like `send`. A restore from a system let its queued spawns overwrite restored entities, and a snapshot captured writes a failing system then rolled back. `tryTick` now sets the same guard, so `send` inside `tryTick` throws too.
  - **`restore` rejects an unknown scope name** with the new `UnknownScope` error, instead of putting entities in a scope nothing can name.
  - **`describe()` counts reads inside `Query.anyOf`**, so `component-never-read` no longer fires for a component read only through `anyOf`, and `read-before-write` sees it. A system placed directly and under `Schedule.when` / `pauseWhen` is one entry with both placements and the conditions of each.
  - **`Collide2` stops a circle that starts exactly touching a wall** and moves into it, instead of moving it through the wall: `sweepCircleBox` / `sweepCircleBoxes` now report a hit at time 0, and `moveCircle` blocks. This happens whenever a game places a body exactly at a wall without a skin (a snapped spawn point, or a projectile set to a sweep's contact point). Moving away from the wall or sliding along it is unchanged. A game that fingerprints its simulation will see fights that touched a wall this way play differently: re-record the fingerprints with the upgrade.
  - **Replays carry input into their window.** A replay saved after unchanged input (holding a direction longer than `keep`) had no input on its first ticks and handed systems `undefined` when played.
  - **`Session.run` stops with `invariant-threw`** when an invariant throws, naming the invariant and the error, instead of throwing out of `run` and losing the run's text.
  - The `Snapshot` docs now say that unread `runtime.send` events survive a restore, as they always did.

## 0.8.0

### Upgrading

0.8.0 adds component requirements (`Schema.requires`) and changes how
`commands.insert` and `commands.remove` take their target.

- **`remove` takes a query match, not a raw id.** Pass `match.entity` (or the
  id `commands.spawn` returned in the same run). With only a stored id,
  resolve it first.

  ```diff
  -for (const match of queries.marked.each()) commands.remove(match.entity.id, Marker)
  +for (const match of queries.marked.each()) commands.remove(match.entity, Marker)

  -commands.remove(storedId, Sprite)
  +const found = queries.sprites.get(storedId)
  +if (found.ok) commands.remove(found.value.entity, Sprite)
  ```

  A raw id fails with an error that first prints the id's type (the whole
  schema), then the fix: `remove needs an entity from a query (pass
match.entity) or the id spawn returned in this run, not a raw id`.

- **`remove` takes several components.** Removing a component together with
  the components that require it must happen in one call:
  `commands.remove(match.entity, Player, Velocity)`.
- **`insert` takes `match.entity` too.** A raw id still works for components
  that require nothing; a component with requirements needs a target whose
  query proves them, or the requirements inserted in the same call.
- **A query's `without` proves absence.** `remove(match.entity, Velocity)`
  compiles when every component that requires `Velocity` is excluded by the
  query (`without: [Player]`) or removed in the same call.
- **Hand-kept part lists can go.** Declare what always comes together in the
  schema, and give `spawns` the main component:

  ```diff
  -export const PlayerParts = [Position, Velocity, Collider, Player] as const
  -commands: Game.System.commands(Game.System.spawns(...PlayerParts))
  +Schema.fragment({ components: { ... }, requires: [Schema.requires(Player, Position, Velocity, Collider)] })
  +commands: Game.System.commands(Game.System.spawns(Player))
  ```

  - Put a requirement on the component that needs it, not on widely shared
    ones. If many components require `Position` or `Renderable`, every
    `remove` of those needs a query with `without` for each requirer.
  - Only `spawns(...)` expands requirements. `inserts(...)`, `removes(...)`,
    and `remove(...)` do not, so a list such as "every part of a body" stays a
    plain array: `removes(...BodyParts)` and `remove(match.entity, ...BodyParts)`.
  - Components a draft may hold that no requirement covers (optional parts)
    are still listed in `spawns(...)` next to the main component.

- **New optional descriptor option.** `{ immutable: true }` on a component
  makes `Game.Query.write` of it a compile error; replace it with `insert`.
- **Debug output.** `describe()` component entries gain `immutable` and
  `requires`; a new effect kind `requirementViolated` and lint
  `requirement-violated` report commands skipped at apply time. Replay schema
  hashes are unchanged.

### Minor Changes

- 0b22113: **Immutable components.** `Descriptor.Component`, `ConstructedComponent`, and `TransientComponent` take an optional `{ immutable: true }` for data that says what an entity is (a kind, a team, a tile). Queries can only read such a component: `Game.Query.write(Kind)` is a compile error naming the fix (`replace it with commands.insert(entity, Game.Command.entry(Kind, ...))`), and it throws the same message when an erased type reaches it. Replacing the component with `commands.insert` still marks it changed for `Game.Query.changed(Kind)`. Descriptors declared without the option keep their exact type.

  - `Descriptor.isImmutable(descriptor)` reports the option at runtime.
  - `describe()` component entries gain `immutable`, and the text report prints it.

- a0fac0a: **`Game.Query.anyOf`.** `anyOf(...filters)` takes two or more `added` / `changed` filters and matches an entity once when any of them passes since the reading system's previous run, for example to redraw when either the position or the sprite changed. Filters listed side by side in `filters: [...]` still all have to pass. `anyOf` does not nest, and `Game.Condition.check` rejects it like every other change filter.

  - `RenderSync.system` now builds one query per sync system (an `anyOf` of its added and changed filters) instead of one query per trigger plus deduplication.
  - `Debug.QueryDescription` gains `anyOf` (one entry per `anyOf` filter, with its `added` and `changed` components); code that builds a `QueryDescription` by hand must add it. The text report prints it as `any of (...)`, and Monitor counts its components as reads.

- 0b22113: **Breaking: required components; `insert` and `remove` take a query match.** See Upgrading above.

  A fragment declares what always comes together: `Schema.fragment({ components: { ... }, requires: [Schema.requires(Player, Position, Velocity)] })`. Requirements chain, may name components of other fragments of the same `Schema.bind` (checked there), and are never filled in with defaults.

  - `commands.spawn` / `spawnIn` reject a draft missing a required component, naming the requirer and the missing component. Drafts may be partial while they are built with `Game.Command.extend`.
  - `Game.System.spawns(Player)` also allows what `Player` requires, transitively, so hand-kept lists of a draft's components are no longer needed.
  - **Breaking:** `commands.remove` takes `match.entity` (or the id `commands.spawn` returned in this run), never a raw id, and removes several components in one call: `commands.remove(match.entity, Player, Velocity)`. Removing a required component compiles only when its requirers are removed in the same call or excluded by the query's `without`.
  - `commands.insert` takes `match.entity` (or a spawned id) as well as a raw id: the target's query proof plus the entries inserted together must cover what the inserted components require. A raw id still inserts components without requirements.
  - When commands are applied, a spawn, insert, or remove that would break a requirement (a query proof gone stale within one flush, erased types) is skipped whole, traced as a `requirementViolated` effect, and reported by the new `requirement-violated` lint.
  - `restore` rejects a saved entity missing a required component with the new `MissingRequiredComponent` error. Requirements on transient components are not checked there, since saves skip them.
  - `describe()` component entries gain `requires`. `Command.InternalWorld` now inserts and removes several components per call (`insertComponents`, `removeComponents`), and `spawnEntity` reports whether it spawned.

- a0fac0a: **Resource change detection.** `Game.System.changedResource(R)` declares a resource read whose view adds `changed()`: whether a committed write left a different value since this system's previous completed run. Use it for work worth doing only when a value moved, such as rewriting a HUD label, instead of keeping a "last value" in `local`.

  - A write of an equal value is not a change: primitives compare with `Object.is`, plain objects and arrays by their entries, other objects by reference. This differs from `Game.Query.changed`, where every component write counts.
  - The first run reports `true`. Writes rolled back by a failed system are not changes, a system does not see its own writes as changes, and a reader skipped by a run condition sees the change when it runs again.
  - `Game.Condition.check` rejects it ("changedResource consumes a per-reader cursor, which a check does not have: use Game.System.readResource here, and changedResource in the gated system"); writing a resource in a check now names `readResource` too.
  - `Game.System.thisTick(changedResource(R))` joins the compile-time and runtime order checks.
  - `describe()` lists these reads in `SystemDescription.resources.changed` (they stay in `reads`), the text report prints them as "reads resources when changed", and the new `resource-changed-never-written` lint warns when no described system writes a resource read with `changedResource`.

- a580c9c: **Scopes despawned by state changes.** `Game.EntityScope(name, { despawnOnExit: [Flow, "Playing"] })` (or `despawnOnEnter`) despawns every member of the scope when `applyStateTransitions(...)` commits that state change: after the `onExit` schedules, which still see the members, and before the `onEnter` schedules, so what they spawn survives. A restart no longer needs a despawn system, a `despawnsScope` permission, and an `applyDeferred()` placed between despawn and respawn. The despawn goes through the normal path (`readDespawned`, `RenderSync`, hierarchy cascades) and appears in the trace as `despawnScope <name>` from `onExit(<machine>=<state>)`.

  - Scopes register with the game when defined, so the runtime knows every trigger; scope names are now unique per game (`Duplicate entity scope name`).
  - A state that does not exist, or a machine of another game, fails to compile. `Game.Condition.inState` and `stateChanged` now reject another game's machine where the condition is built, with the message `<machine> is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)`.
  - New lint `scope-trigger-never-applied`: a trigger whose machine the runtime does not provide, whose next state no described system queues, or that no described schedule applies. `describe()` gains `scopes` (each with its triggers), printed in the text report.

- a580c9c: **Sub-states.** `Game.StateMachine(name, values, { within: [Parent, state] })` declares a machine that exists only while `Parent` is in `state`. Each time the parent enters that state, the sub-state enters the value given to `Game.Runtime.machine(...)`; when the parent leaves it, the sub-state's `onExit` schedules run before the parent's and it loses its value. `Game.Condition.inState(Sub, x)` therefore implies the parent's state, replacing an `and(inState(Parent, ...), inState(Sub, ...))` on every system and the `onExit` system that reset the second machine.

  - For sub-states only: `machines.x.get()` is `Value | undefined`, `nextMachines.x.set` / `setIfChanged` return a `Result` failing with `SubStateInactive` (nothing is queued) while the parent is elsewhere, and transition snapshots use `undefined` for the side where it does not exist. Top-level machines keep their exact types.
  - Snapshots leave out an inactive sub-state; `restore` rejects a saved sub-state value whose parent is elsewhere with the new `InactiveSubState` error, and enters the entry value when a save has the parent in its state but no sub-state value.
  - `describe()` machine entries gain `provided` and `within`; the text report and traces print a missing value as `(inactive)`. `Debug.TransitionEvent` `from` / `to` may be `undefined`.
  - The unused `Machine.MachineView`, `NextMachineView`, `TransitionView`, and `TransitionEventView` interfaces are removed; system views are `System.MachineReadView`, `NextMachineWriteView`, `TransitionReadView`, and `TransitionEventReadView`.

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
- a1f18a8: Two fixes:

  - **Snapshots keep entity scopes.** `snapshot()` now saves scope membership (`scopes`: per scope name, its members' ids) and `restore()` rebuilds it, so `despawnScope` finds restored entities. The format moves to version 2. Version 1 snapshots had no scopes and are rejected with `UnsupportedVersion` instead of being restored with every scoped entity loose. Invalid membership (an id that is not a saved entity, or one in two scopes) fails with `InvalidScope`.
  - **RenderSync follows membership.** A node now exists exactly while its entity has the renderable, the transform, and every required `select` slot. It is created whichever of them arrives last, and destroyed when any of them is removed (before, only the renderable's arrival and removal counted). The redundant despawn read is gone, because despawns are recorded as removals.

### Patch Changes

- a8e0473: Retire the generated documentation site and point package homepages, source links,
  and issue links to the Ritmo repository in the Typeonce GitHub organization.
  Keep source JSDoc and repository guides, including the Pixi walkthrough in its
  example README.

## 0.5.0

## 0.4.0

### Minor Changes

- e2b2275: New package `@typeonce/bevy-ts-render`: the renderer-agnostic part of `@typeonce/bevy-ts-pixi`, the entity-keyed node registry (`NodeRegistry.make`) and the render sync systems (`RenderSync.system`, `RenderSync.interpolate`), for games drawn with Three.js, the DOM, or any other renderer.

  **Breaking:** import `NodeRegistry` and `RenderSync` from `@typeonce/bevy-ts-render`. Pixi exports only `PixiNodeRegistry`, with `make(container)` replacing `NodeRegistry.inContainer(container)`. The platform-prefixed adapter implements the generic registry contract and is provided through the existing typed runtime service API. The old Pixi modules and re-exports are removed immediately. Pixi depends only on the render package, dropping its unused browser and core dependencies.

  This combines the four planned steps into one 0.4.0 release of the fixed package group.

  - `Game.Schedule.pauseWhen` retains event-reader cursors during a pause. Ordinary `when` gates still discard messages across mode changes and take precedence over pause gates in either nesting order. Stream capacity bounds retention, and debug traces expose whether a skipped run held messages.
  - A system's optional `local` factory owns scratch state per runtime, shared by gated copies. Locals are neither rolled back nor snapshotted and are rebuilt after successful restore. Debug descriptions show which systems declare them.
  - Optional and conditional local factories preserve `undefined` in the callback type. Factories allocate fresh scratch state without side effects; mode changes preserve locals, and values needing cleanup belong in host-managed services.
  - `runtime.send` immediately publishes a schema event from the host at a fresh tick. Calls during a tick or with unknown descriptors throw. Unread host messages survive restore without replaying to readers that already consumed them. Devtools trace sends and include external producers in event lints.
  - **Breaking:** `EntityId` and `Handle` are branded numbers. Replace `id.value` and `handle.value` with `id` and `handle`. Handles now compare by numeric identity and work as `Set` keys without allocating objects. `decodeHandle` and `Decode.handle` accept only positive integer numbers. Object-shaped handles are rejected, including inside snapshots; snapshots write numbers.
  - The guides cover fallible lookups, inspector machine reads, `Query.Cells`, shared access objects, simulation-owned time, and seeded random state. `Feature` remains supported and is documented in the package-authoring guide.

## 0.3.0

### Minor Changes

- 2b0fb7e: Add `Game.Condition.check(name, access, predicate)` (types in `@typeonce/bevy-ts/Condition`): a run condition computed by ordinary code, so conditions need no growing set of combinators. A check declares its reads like a system and receives them read-only. It may read resources, machines, and queries with no write slots and no `added`/`changed` filters; events, transition events, removed/despawned reads, relation failures, and services are compile errors, as are other games' descriptors and non-boolean predicates. Its reads become requirements of whatever it gates, through `not`/`and`/`or`, a system's `when`, and `Schedule.when`. Checks are evaluated before each gated system against committed values, so they see writes from earlier systems in the same run, and they never advance the world tick or a reader cursor. A throwing predicate propagates like a throwing system. Devtools render checks as `check(name)` and count their reads as the gated system's reads.

  Conditions now carry their requirements in one type-level field, read with `ConditionNeeds` / `ConditionNeedsFromConditions`. `MachineNeedsFromCondition(s)` remain and extract only the machines. `InputCapture.system` and `RenderSync` (`system`, `interpolate`) pass a check's requirements through their `when` option.

- c4d1add: Debug visibility for risks that types cannot rule out.

  - `Debug.Handle.population()` returns the live entity count and the number of entities per component. It is cheap enough to sample every frame.
  - A new info lint, `read-before-write`, names systems that read a component, resource, or event earlier in a schedule than the first system that writes it there, so they see the previous run's value (for events, one run late).
  - Devtools sessions warn with `non-finite-value` when any traced component write, resource write, event, spawn, or insert contains NaN or an infinity. The warning names the system, the entity, and the path.
  - Runs sample the population every frame. They return `entities` (start, peak, end) and `growing`, and warn with `population-growing` when a component's lowest count rises through every quarter of a run of at least 60 frames.
  - `run()` lists the warnings it raised, both as text and in `warnings`. `report()` ends with the current population.

- 94bdc32: Add `Descriptor.State(name, states, { transitions? })`: a component whose value is one of a closed set of states. It behaves like any other component (queries, change detection, rollback), and its constructor validates the value, so `setRaw` and snapshot restore reject unknown states. Its write cell adds `transition(from, to)`, a compare-and-set that writes `to` only while the state is still `from` and otherwise returns a `StateMismatch` failure (`Query.StateMismatchError`) without writing. With a `transitions` graph, which must list every state, a pair the graph does not allow is a compile error. Without a graph, any pair of states is accepted.

### Patch Changes

- bd9bdd5: `Result.all([a, b])` now infers a tuple, so the success value keeps each position's type (`readonly [number, string]` instead of `readonly (string | number)[]`).
- bd9bdd5: Fix spawn and insert entries accepting a value of the wrong component. In a schema with two or more components, `spawn([Health, "a name"])` compiled because entries were typed as "any schema descriptor with any schema value". Each descriptor is now paired with its own value type, so these entries are compile errors. Code that compiled only because of this hole now reports the mismatch.
- bd9bdd5: Declare the supported TypeScript range: an optional `typescript >=5.9` peer dependency. The type tests now run on every TypeScript version from 5.9 up.

## 0.2.0

### Minor Changes

- 4b3a312: Removed-component and despawned-entity records are now kept until every system that reads them has run, like events. A render schedule ticked once after several fixed updates sees every despawn instead of only those from the last two `tick(...)` calls, so renderer mirrors such as `RenderSync` no longer leak nodes when the simulation catches up. A system skipped by its run conditions keeps its position and sees the removals when it runs again, matching `added`/`changed`. Each log is capped at `Runtime.streamCapacity` entries; the debug trace reports a `missed` read only when entries were dropped at that cap.
- 4b3a312: Add `Game.Schedule.when(conditions, ...entries)` (and `Schedule.when`): a schedule whose systems run only while every condition passes, in addition to their own `when`. It gates a whole group, nested schedules included, so a game-wide mode (playing, paused, hit-stop) no longer has to be repeated on each system. Marker steps in the group still run. The machines the conditions read become requirements of the schedule, so a runtime without them is rejected at compile time. A gated system shares change detection and event cursors with the original (`SystemDefinition.base`), so it is still one reader.

### Patch Changes

- 4b3a312: Building a schedule with an entry that is not a system, a schedule, or a marker step (for example an import that is `undefined` at runtime) now throws `Schedule entry N is not a system, a schedule, or a marker step: got …` instead of failing deep inside with `Cannot read properties of undefined`. The docs also show typing helpers that receive `get()` values as `ReadonlyValue<T>`, so they need no casts.

## 0.1.1

### Patch Changes

- c95a102: First release published from CI through npm trusted publishing, with provenance attestations. Declarations are now verified against consumers on both TypeScript 7 and TypeScript 6. No API or output changes.
