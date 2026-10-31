/**
 * The `rig` commands: the skeleton lab for agents. A character is code (a
 * rig module and a module per clip draft), and the same runner poses and
 * draws it everywhere. Every command prints JSON and exits with a code that
 * says what to do next:
 *
 * - 0: clean (warnings are listed, and are the agent's call)
 * - 2: a usage problem, a missing file, a broken bank
 * - 3: errors: the rig or a draft does not load, throws, keys the wrong motion, or is not repeatable; fix its module
 */
import { Effect, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { toGif } from "../../pixel/core/gif.ts"
import { atlasOf, spritesheetJson } from "../../pixel/core/spritesheet.ts"
import { encodePng } from "../../pixel/cli/png.ts"
import { Exit } from "../../pixel/cli/commands.ts"
import { encodeBank, encodeReview, openComments, resolveComments, reviewPath, reviewSummary, usedDraft, type Bank } from "../core/bank.ts"
import { checkClip, type Checked, type Issue } from "../core/check.ts"
import { runClip } from "../core/clip.ts"
import { artOf, framePictures, gifFramesOf, lookSheet, sheetOf } from "../core/export.ts"
import type { Rig } from "../core/rig.ts"
import { CliFailure, loadClip, loadRig, printJson, readBank, readReview, readText, writeBytes, writeText } from "./io.ts"

const exitWith = (code: number): Effect.Effect<void, Exit> => (code === 0 ? Effect.void : Effect.fail(new Exit({ code })))

const bankArgument = Argument.String("bank").pipe(Argument.withDescription("A rig bank: a JSON file naming the rig module and each clip's drafts."))
const names = Argument.String("names").pipe(Argument.withDescription("Only these clips (default: every clip in the bank)."), Argument.variadic())
const positionsFlag = Flag.String("positions").pipe(
  Flag.withDescription("Bones to report the world place of on every frame, comma-separated (handNear,sword): where each starts, its tip, and its angle, in world units (y up, the origin on the ground under the character)."),
  Flag.optional
)

/** The named clips, failing on a name the bank does not have. */
const pick = (bank: Bank, chosen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, CliFailure> => {
  const all = Object.keys(bank.clips)
  if (chosen.length === 0) return Effect.succeed(all)
  const missing = chosen.filter((name) => !all.includes(name))
  return missing.length === 0 ? Effect.succeed(chosen) : Effect.fail(new CliFailure({ message: `no clip named ${missing.join(", ")}`, details: { clips: all } }))
}

/** The bones `--positions` names, failing on one the rig does not have. */
const positionsOf = (rig: Rig, flag: Option.Option<string>): Effect.Effect<ReadonlyArray<string>, CliFailure> => {
  const bones = Option.match(flag, { onNone: () => [], onSome: (text) => text.split(",").map((name) => name.trim()).filter((name) => name !== "") })
  const missing = bones.filter((bone) => !(bone in rig.bones))
  return missing.length === 0 ? Effect.succeed(bones) : Effect.fail(new CliFailure({ message: `no bone named ${missing.join(", ")}`, details: { bones: Object.keys(rig.bones) } }))
}

/** A rig that does not load or is broken: the CLI fails on it, `check` reports it. */
const requireRig = Effect.fn("requireRig")(function* (bankFile: string, bank: Bank) {
  const loaded = yield* loadRig(bankFile, bank)
  if (!loaded.ok) return yield* new CliFailure({ message: loaded.error.split("; ")[0]!, details: { file: loaded.file, problems: loaded.error.split("; ") } })
  return loaded.rig
})

type Verdict = "errors" | "warnings" | "clean"
const verdictOf = (issues: ReadonlyArray<Pick<Issue, "level">>): Verdict => (issues.some((issue) => issue.level === "error") ? "errors" : issues.length > 0 ? "warnings" : "clean")
const worst = (verdicts: ReadonlyArray<Verdict>): Verdict => (verdicts.includes("errors") ? "errors" : verdicts.includes("warnings") ? "warnings" : "clean")

/** Each joint's bend range in words, for `check` (the per-frame bends are in `look`). */
const jointRanges = (checked: Checked): Record<string, string> =>
  Object.fromEntries(Object.entries(checked.joints).map(([name, joint]) => [name, `${joint.joint} ${joint.min.deg}° (frame ${joint.min.frames[0]}) to ${joint.max.deg}° (frame ${joint.max.frames[0]})`]))

const check = Command.make(
  "check",
  { bank: bankArgument, names, positions: positionsFlag },
  Effect.fn("check")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    const chosen = yield* pick(bank, flags.names)
    const loadedRig = yield* loadRig(flags.bank, bank)
    if (!loadedRig.ok) {
      yield* printJson({ file: flags.bank, verdict: "errors", rig: { file: bank.rig, issues: loadedRig.error.split("; ").map((message) => ({ level: "error", code: "load", message })) }, clips: [], drafts: [] })
      return yield* exitWith(3)
    }
    const rig = loadedRig.rig
    const positions = yield* positionsOf(rig, flags.positions)
    const results: Array<Record<string, unknown>> = []
    const clips: Array<Record<string, unknown>> = []
    for (const name of chosen) {
      const entry = bank.clips[name]!
      const use = usedDraft(entry)
      const verdicts: Record<string, Verdict> = {}
      for (const [id, draft] of Object.entries(entry.drafts)) {
        const loaded = yield* loadClip(flags.bank, draft, rig)
        if (!loaded.ok) {
          verdicts[id] = "errors"
          results.push({ clip: name, draft: id, file: draft.file, used: id === use, verdict: "errors", issues: [{ level: "error", code: "load", message: loaded.error }] })
          continue
        }
        const checked = checkClip(rig, loaded.clip, { seed: draft.seed, tune: draft.tune, accept: draft.accept, name: `${name} (draft ${id})`, positions })
        verdicts[id] = verdictOf(checked.issues)
        results.push({
          clip: name,
          draft: id,
          label: loaded.clip.label,
          file: draft.file,
          used: id === use,
          verdict: verdicts[id],
          ...checked.measures,
          ...(Object.keys(checked.run.params).length === 0 ? {} : { params: checked.run.params }),
          issues: checked.issues,
          ...(checked.accepted.length === 0 ? {} : { accepted: checked.accepted.map((issue) => ({ code: issue.code, frames: issue.frames, where: issue.where, why: issue.why })) }),
          joints: jointRanges(checked),
          ...(checked.trail === undefined ? {} : { trail: { bone: checked.trail.bone, peak: checked.trail.peak, arc: checked.trail.arc, spacing: checked.trail.spacing } }),
          ...(positions.length === 0 ? {} : { positions: checked.positions })
        })
      }
      clips.push({ clip: name, verdict: worst(Object.values(verdicts)), use, drafts: verdicts })
    }
    const verdict = worst(clips.map((clip) => clip.verdict as Verdict))
    yield* printJson({ file: flags.bank, verdict, rig: { file: bank.rig, size: [rig.width, rig.height], bones: rig.order.length, parts: rig.parts.length, chains: Object.keys(rig.chains), props: Object.keys(rig.props), stances: Object.keys(rig.stances) }, clips, drafts: results })
    yield* exitWith(verdict === "errors" ? 3 : 0)
  })
).pipe(
  Command.withDescription(
    "Poses every draft of every clip (or the named ones) twice and measures it: frames, length, the box it fills, each joint's bend, the trail bone's spacing, speed, and arc. Lists what breaks the rules, with the frames and the bones or parts: a module that does not load or throws, keys that key the wrong motion (two on one frame for one channel), a pose naming what the rig does not have, randomness that is not the seed's; parts off the frame or under the ground, planted feet that slide, float, or sink, goals out of reach, far-side parts peeking behind the back, joints locked or bent the wrong way, sudden changes of speed, loops that stop or jump, parts that change draw order, and a first or last frame off the clip's stance. Each clip has its own verdict."
  )
)

/** `--frames a-b` (or one frame) as the frames it names, failing outside the clip. */
const framesOf = (flag: Option.Option<string>, count: number): Effect.Effect<ReadonlyArray<number>, CliFailure> => {
  if (Option.isNone(flag)) return Effect.succeed(Array.from({ length: count }, (_, f) => f))
  const match = /^(\d+)(?:-(\d+))?$/.exec(flag.value.trim())
  const from = match === null ? Number.NaN : Number(match[1])
  const to = match === null ? Number.NaN : Number(match[2] ?? match[1])
  if (!(from <= to) || to >= count) return Effect.fail(new CliFailure({ message: `--frames takes from-to inside the clip, like --frames 5-10 (it has frames 0 to ${count - 1})` }))
  return Effect.succeed(Array.from({ length: to - from + 1 }, (_, i) => from + i))
}

const look = Command.make(
  "look",
  {
    bank: bankArgument,
    name: Argument.String("name").pipe(Argument.withDescription("The clip to look at.")),
    draft: Flag.String("draft").pipe(Flag.withDescription("Only this draft (default: every draft)."), Flag.optional),
    frames: Flag.String("frames").pipe(Flag.withDescription("Only these frames, from-to (5-10) or one (7): bigger and easier to read than the whole clip."), Flag.optional),
    scale: Flag.Int("scale").pipe(Flag.withDescription("Pixels per world unit: 2 draws the frames twice as big."), Flag.withDefault(1)),
    columns: Flag.Int("columns").pipe(Flag.withDescription("Frames per row (default: as many as fit in 2000 pixels)."), Flag.optional),
    art: Flag.Boolean("art").pipe(Flag.withDescription("The art only: leave out the row of bones under each row of frames."), Flag.withDefault(false)),
    each: Flag.Boolean("each").pipe(Flag.withDescription("One picture per frame instead of one sheet."), Flag.withDefault(false)),
    onion: Flag.Boolean("onion").pipe(Flag.withDescription("Draw the frame before, faint, under each frame: to see spacing."), Flag.withDefault(false)),
    positions: positionsFlag,
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("The folder to write to (default: <bank>.look/ next to the bank)."), Flag.optional)
  },
  Effect.fn("look")(function* (flags) {
    const path = yield* Path.Path
    const bank = yield* readBank(flags.bank)
    yield* pick(bank, [flags.name])
    const entry = bank.clips[flags.name]!
    const ids = Option.match(flags.draft, { onNone: () => Object.keys(entry.drafts), onSome: (id) => [id] })
    const folder = Option.getOrElse(flags.out, () => flags.bank.replace(/\.json$/, "") + ".look")
    const rig = yield* requireRig(flags.bank, bank)
    const positions = yield* positionsOf(rig, flags.positions)
    const review = yield* readReview(flags.bank)
    const files: Array<string> = []
    const ringed: Array<Record<string, unknown>> = []
    const joints: Record<string, unknown> = {}
    const where: Record<string, unknown> = {}
    let shown: ReadonlyArray<number> = []
    for (const id of ids) {
      const draft = entry.drafts[id]
      if (draft === undefined) return yield* new CliFailure({ message: `${flags.name} has no draft ${id}`, details: { drafts: Object.keys(entry.drafts) } })
      const loaded = yield* loadClip(flags.bank, draft, rig)
      if (!loaded.ok) return yield* new CliFailure({ message: loaded.error })
      const clip = loaded.clip
      const run = runClip(rig, clip, { seed: draft.seed, tune: draft.tune })
      if (run.errors.length > 0) return yield* new CliFailure({ message: `${flags.name} (draft ${id}) does not pose cleanly: ${run.errors.map((error) => error.message).join("; ")}` })
      shown = yield* framesOf(flags.frames, clip.frames)
      const comments = openComments(review, flags.name, id)
      for (const comment of comments) ringed.push({ ...comment })
      const options = {
        scale: flags.scale,
        columns: Option.getOrUndefined(flags.columns),
        frames: shown,
        bones: !flags.art,
        onion: flags.onion,
        comments,
        title: `${flags.name} ${id} - ${clip.frames} frames at ${clip.fps} fps, ${clip.loop ? "loop" : "once"}${comments.length > 0 ? ` - ${comments.length} open comments` : ""}`
      }
      if (flags.each) {
        const pad = String(clip.frames - 1).length
        for (const { frame, image } of framePictures(rig, clip, run, options)) files.push(yield* writeBytes(path.join(folder, `${flags.name}.${id}.${String(frame).padStart(pad, "0")}.png`), encodePng(image)))
      } else files.push(yield* writeBytes(path.join(folder, `${flags.name}.${id}.png`), encodePng(lookSheet(rig, clip, run, options))))
      const checked = checkClip(rig, clip, { seed: draft.seed, tune: draft.tune, positions })
      joints[id] = Object.fromEntries(Object.entries(checked.joints).map(([name, joint]) => [name, { joint: joint.joint, min: joint.min, max: joint.max, bend: joint.bend }]))
      if (positions.length > 0) where[id] = checked.positions
    }
    yield* printJson({
      clip: flags.name,
      files,
      frames: shown.length === 0 ? undefined : `${shown[0]}-${shown[shown.length - 1]}`,
      ringed,
      joints,
      ...(positions.length === 0 ? {} : { positions: where }),
      next: "Read each picture: frames left to right, top to bottom, each numbered with its phase (fast ones in amber); under each row, the same frames with their bones (yellow), joints (red), and the trail bone's path (green). Magenta rings are the person's pixel comments, magenta frames their span comments, numbered as `rig notes` lists them. Judge the silhouette, the spacing, and the arcs before showing the person."
    })
  })
).pipe(
  Command.withDescription(
    "Writes a contact sheet per draft of a clip, as a PNG to look at: every frame (or --frames a-b) numbered with its phase, in rows no wider than 2000 pixels, each row with the same frames' bones under it (--art leaves them out), the person's open comments ringed; --each writes one picture per frame, --onion shows the frame before faintly, --scale draws them bigger. Prints every joint's bend on every frame, and with --positions the world place of the bones named."
  )
)

/** The sheet's JSON with `meta.loop`: whether the animation plays again from the start (an idle) or once (an attack), which the hash format has no field for. */
const withLoop = (json: string, name: string, loop: boolean): string => {
  const sheet = JSON.parse(json) as { meta: Record<string, unknown> }
  sheet.meta.loop = { [name]: loop }
  return JSON.stringify(sheet, null, 2) + "\n"
}

const bake = Command.make(
  "bake",
  {
    bank: bankArgument,
    names,
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDescription("The folder to write to (default: <bank>.out/ next to the bank)."), Flag.optional),
    scale: Flag.Int("scale").pipe(Flag.withDescription("Pixels per world unit in the sheet and the GIF."), Flag.withDefault(1))
  },
  Effect.fn("bake")(function* (flags) {
    const path = yield* Path.Path
    const bank = yield* readBank(flags.bank)
    const chosen = yield* pick(bank, flags.names)
    const rig = yield* requireRig(flags.bank, bank)
    const folder = Option.getOrElse(flags.out, () => flags.bank.replace(/\.json$/, "") + ".out")
    const scale = Math.max(1, flags.scale)
    const written: Array<Record<string, unknown>> = []
    for (const name of chosen) {
      const entry = bank.clips[name]!
      const id = usedDraft(entry)!
      const draft = entry.drafts[id]!
      const loaded = yield* loadClip(flags.bank, draft, rig)
      if (!loaded.ok) return yield* new CliFailure({ message: loaded.error })
      const clip = loaded.clip
      const run = runClip(rig, clip, { seed: draft.seed, tune: draft.tune })
      if (run.errors.length > 0) return yield* new CliFailure({ message: `${name} (draft ${id}) does not pose cleanly: ${run.errors.map((error) => error.message).join("; ")}` })
      const art = artOf(rig, run, scale)
      const gifFrames = gifFramesOf(rig, art, scale)
      // The hash format reads an anchor as a pixel (its middle across, its foot down); the rig's anchor is the corner the ground meets, so it goes in half a pixel left and one up.
      const atlasClip = { name, frames: gifFrames, anchor: { x: rig.anchor[0] * scale - 0.5, y: rig.anchor[1] * scale - 1 }, fps: clip.fps, loop: "forward" as const }
      const atlas = atlasOf([atlasClip], { columns: gifFrames.length, spacing: 0 })
      const files = [
        yield* writeBytes(path.join(folder, `${name}.png`), encodePng(sheetOf(art, atlas.rects, atlas.art.width, atlas.art.height))),
        yield* writeText(path.join(folder, `${name}.json`), withLoop(spritesheetJson({ image: `${name}.png`, clips: [atlasClip], atlas, scale: 1 }), name, clip.loop)),
        yield* writeBytes(path.join(folder, `${name}.gif`), toGif(gifFrames, { scale: 1, delay: 1000 / clip.fps }))
      ]
      written.push({ clip: name, draft: id, loop: clip.loop, frames: clip.frames, fps: clip.fps, size: [rig.width * scale, rig.height * scale], anchor: [rig.anchor[0] * scale, rig.anchor[1] * scale], files })
    }
    yield* printJson({ file: flags.bank, clips: written })
  })
).pipe(
  Command.withDescription(
    "Writes each clip's chosen draft (its `use`, or its first) for the game: a sprite sheet PNG of its frames in one row (anti-aliased, on transparency), its JSON (the hash format Pixi, Phaser, and Aseprite read: each frame's rectangle, duration, and anchor from the rig's `anchor`, the animation and its fps, and `meta.loop`: whether it loops or plays once), and a GIF on the rig's backdrop to share."
  )
)

const notes = Command.make(
  "notes",
  { bank: bankArgument },
  Effect.fn("notes")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    const review = yield* readReview(flags.bank)
    yield* printJson({ file: flags.bank, review: reviewPath(flags.bank), ...reviewSummary(bank, review) })
  })
).pipe(
  Command.withDescription(
    "What the person said in the review: each clip's status (new, approved, changes asked), note, open comments (each numbered, on a draft and a frame's pixel with the part, bone, and phase there, or on a span of frames, with where it is in words), chosen draft, and tune, the changes first."
  )
)

const resolve = Command.make(
  "resolve",
  {
    bank: bankArgument,
    clip: Argument.String("clip").pipe(Argument.withDescription("The clip the comments are on.")),
    numbers: Argument.Int("numbers").pipe(Argument.withDescription("The comments' numbers, as `rig notes` lists them."), Argument.atLeast(1)),
    reply: Flag.String("reply").pipe(Flag.withDescription("What you changed, in a few words: the person reads it beside their comment."), Flag.withDefault(""))
  },
  Effect.fn("resolve")(function* (flags) {
    const bank = yield* readBank(flags.bank)
    yield* pick(bank, [flags.clip])
    const resolved = resolveComments(yield* readReview(flags.bank), flags.clip, flags.numbers, flags.reply)
    if (!resolved.ok) return yield* new CliFailure({ message: resolved.error })
    const file = yield* writeText(reviewPath(flags.bank), encodeReview(resolved.value))
    yield* printJson({ review: file, clip: flags.clip, resolved: flags.numbers, reply: flags.reply === "" ? undefined : flags.reply })
  })
).pipe(
  Command.withDescription(
    "Marks the person's comments on a clip as resolved, by the numbers `rig notes` gives, with a reply saying what changed. `rig notes` and `rig look` stop showing them."
  )
)

const STARTER_BANK: Bank = {
  rig: "rig/figure.mjs",
  clips: { idle: { about: "Standing, breathing: the stance the other clips start and end on.", drafts: { a: { file: "rig/idle.a.mjs" } } } }
}

const STARTER_RIG = `// A small figure seen from the side, facing right (+x): y is up, the origin is the ground under it, angles are degrees counter-clockwise from +x.
// Parts are drawn in the setup pose (standing straight, arms hanging); a point can be [x, y] or on a bone: { bone, along, across }.
const skin = "#f1c09a"
const tunic = "#3f7fb8"
const far = "#2b5784"
const boot = "#6e4b3a"

export default {
  size: [64, 96],
  anchor: [30, 90], // the pixel the ground under the character sits on
  outline: "#16121d",
  line: 1.2,
  back: "torso", // the peek check measures far-side parts against it
  bones: {
    hips: { y: 34, rotation: 90, length: 4 },
    torso: { parent: "hips", length: 22 },
    head: { parent: "torso", x: 23, length: 14 },
    upperArm: { parent: "torso", x: 20, rotation: 180, length: 12 },
    forearm: { parent: "upperArm", x: 12, length: 11 },
    hand: { parent: "forearm", x: 11, length: 3 },
    thighFar: { parent: "hips", rotation: 180, length: 16 },
    shinFar: { parent: "thighFar", x: 16, length: 15 },
    footFar: { parent: "shinFar", x: 15, rotation: 90, length: 6 },
    thighNear: { parent: "hips", rotation: 180, length: 16 },
    shinNear: { parent: "thighNear", x: 16, length: 15 },
    footNear: { parent: "shinNear", x: 15, rotation: 90, length: 6 }
  },
  parts: {
    thighFar: { bone: "thighFar", z: 1, far: true, fill: far, shape: { kind: "capsule", r: 3.4, r2: 2.8 } },
    shinFar: { bone: "shinFar", z: 2, far: true, fill: far, shape: { kind: "capsule", r: 2.8, r2: 2.2 } },
    footFar: { bone: "footFar", z: 3, far: true, fill: boot, shape: { kind: "capsule", a: { along: -1 }, b: { along: 6 }, r: 1.8 } },
    torso: { bone: "torso", z: 10, fill: tunic, shape: { kind: "capsule", a: { along: 1 }, b: { along: 20 }, r: 6, r2: 6.5 } },
    head: { bone: "head", z: 11, fill: skin, shape: { kind: "ellipse", c: { along: 7, across: -1 }, rx: 6.5 } },
    thighNear: { bone: "thighNear", z: 20, fill: tunic, shape: { kind: "capsule", r: 3.5, r2: 2.9 } },
    shinNear: { bone: "shinNear", z: 21, fill: tunic, shape: { kind: "capsule", r: 2.9, r2: 2.3 } },
    footNear: { bone: "footNear", z: 22, fill: boot, shape: { kind: "capsule", a: { along: -1 }, b: { along: 6 }, r: 1.8 } },
    upperArm: { bone: "upperArm", z: 30, fill: tunic, shape: { kind: "capsule", r: 2.8, r2: 2.4 } },
    forearm: { bone: "forearm", z: 31, fill: skin, shape: { kind: "capsule", r: 2.3, r2: 2 } },
    hand: { bone: "hand", z: 32, fill: skin, shape: { kind: "ellipse", c: { along: 1.5 }, rx: 2.4 } }
  },
  chains: {
    legNear: { upper: "thighNear", lower: "shinNear", end: "footNear", bend: 1, foot: true },
    legFar: { upper: "thighFar", lower: "shinFar", end: "footFar", bend: 1, foot: true },
    arm: { upper: "upperArm", lower: "forearm", end: "hand", bend: -1 }
  },
  stances: {
    // Feet apart, knees soft, the hand loose in front: clips start and end here.
    stand: {
      bones: { hips: { y: -2 }, torso: -4, head: 4 },
      reach: { legNear: { x: 6, y: 2 }, legFar: { x: -6, y: 2 }, arm: { bone: "torso", along: 20, dx: 7, dy: -15 } }
    }
  }
}
`

const STARTER_CLIP = `// A draft of the "idle" clip: the stand stance, breathing. The hips sink and rise, the torso and head sway, the hand drifts.
export default {
  label: "breathing",
  frames: 16,
  fps: 12,
  loop: true,
  stance: "stand", // frame 0 must be the rig's stand stance: every layer below is 0 there
  params: { breath: { min: 0, max: 3, value: 1.5 } },
  pose(rig, t, p) {
    const breath = (p.breath * (1 - Math.cos(2 * Math.PI * t))) / 2 // 0 at the top of the breath (frame 0), p.breath at the bottom
    const sway = Math.sin(2 * Math.PI * t)
    return rig.add(rig.stances.stand, {
      bones: { hips: { y: -breath }, torso: 1.5 * sway, head: -1.5 * sway },
      reach: { arm: { bone: "torso", along: 20, dx: 7 + sway, dy: -15 - breath } }
    })
  }
}
`

const init = Command.make(
  "init",
  {
    bank: Argument.String("bank").pipe(Argument.withDescription("Where to write the new bank."), Argument.withDefault("game.rig.json")),
    force: Flag.Boolean("force").pipe(Flag.withDefault(false), Flag.withDescription("Replace existing files."))
  },
  Effect.fn("init")(function* (flags) {
    const path = yield* Path.Path
    const folder = path.dirname(flags.bank)
    const rigFile = path.join(folder, STARTER_BANK.rig)
    const clipFile = path.join(folder, STARTER_BANK.clips.idle!.drafts.a!.file)
    for (const file of [flags.bank, rigFile, clipFile]) {
      const existing = yield* readText(file).pipe(Effect.option)
      if (Option.isSome(existing) && !flags.force) return yield* new CliFailure({ message: `${file} already exists (--force replaces it)` })
    }
    yield* printJson({
      bank: yield* writeText(flags.bank, encodeBank(STARTER_BANK)),
      rig: yield* writeText(rigFile, STARTER_RIG),
      drafts: [yield* writeText(clipFile, STARTER_CLIP)],
      clips: Object.keys(STARTER_BANK.clips)
    })
  })
).pipe(Command.withDescription("Writes a starting bank with a small figure's rig module (bones, parts, leg and arm chains, a stance) and one clip, an idle, and its first draft module to build from."))

/** The `rig` command and its subcommands, registered in `ritmo-tools` next to `fx`. */
export const rig = Command.make("rig").pipe(
  Command.withDescription(
    "Ritmo's skeleton lab: characters as code (a rig module of bones, parts, IK chains, props, and stances, and clip drafts that pose it), checked for motion craft, looked at as contact sheets, and baked as sprite sheets. Prints JSON; exit 0 clean, 2 usage error, 3 errors in the rig or a draft."
  ),
  Command.withSubcommands([check, look, bake, notes, resolve, init])
)
