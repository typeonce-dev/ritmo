/**
 * The town without a browser: scripted keys drive the same schedules the
 * page runs, and the run fails loudly when a rule breaks.
 *
 *   node --import tsx website/src/demos/town/check.ts
 *
 * Frame N is the N-th update. A key pressed at frame N is held from that
 * update on; pressed and released in one frame is a tap. p1 plays the
 * arrows, seated at setup: it appears at frame 0, whose input is idle, so
 * the scripted play starts at frame 2.
 */
import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Invariant, Session } from "@typeonce/ritmo-devtools"

import { isOpenGround, sameCell } from "./map.ts"
import type { Cell } from "./map.ts"
import { createTownSimulation } from "./runtime.ts"
import { Facing, Game, leftKeys, Look, Patrol, Player, rightKeys, Solid, Stride, Talkable, Tile, Villager } from "./schema.ts"
import { setupSchedule, updateSchedule } from "./schedules.ts"
import { ReadPlayers, ReadScreen } from "./view.ts"

type Timeline = Keyboard.Timeline<typeof rightKeys>
/** The update the scripted play starts at: p1 appears at frame 0 (2 keeps the clock's even steps where they were). */
const PLAY = 2
const tap = (frame: number, key: "up" | "down" | "left" | "right" | "action"): Timeline => [{ frame: frame + PLAY, press: [key], release: [key] }]
const hold = (frame: number, until: number, key: "up" | "down" | "left" | "right"): Timeline => [
  { frame: frame + PLAY, press: [key] },
  { frame: until + PLAY, release: [key] }
]
// Read the house sign, walk around, bump the house, then talk to Ito.
const script: Timeline = [
  // Start facing the sign at the door: read it, turn its two pages, close it.
  ...tap(0, "action"),
  ...[10, 20, 30, 40].flatMap((frame) => tap(frame, "action")),
  // A tap in a new direction only turns; the next tap walks one tile.
  ...tap(50, "down"),
  ...tap(62, "down"),
  // Hold up: turn, one tile back, then bump the house wall.
  ...hold(80, 130, "up"),
  // Two tiles down, eight right, one down: above Ito.
  ...hold(170, 193, "down"),
  ...hold(210, 329, "right"),
  ...hold(350, 357, "down"),
  // Talk to Ito, try to walk away mid-conversation, then read all three pages.
  ...tap(380, "action"),
  ...hold(385, 420, "right"),
  ...[430, 440, 450, 460, 470, 480].flatMap((frame) => tap(frame, "action")),
  // Turn to face Kit's route.
  ...tap(485, "right")
]

const hostClock = HostClock.test()
const start = (timeline: Timeline) => {
  const made = createTownSimulation({ right: Keyboard.scripted(rightKeys, timeline), hostClock })
  if (!made.ok) throw new Error("The town's runtime could not start.")
  return made.value
}

const ReadWalker = Game.Inspector("Town/ReadWalker", {
  queries: { walker: Game.Query({ selection: { tile: Game.Query.read(Tile), facing: Game.Query.read(Facing), stride: Game.Query.read(Stride) }, with: [Patrol] }) }
}, ({ queries }) => {
  const match = queries.walker.single()
  return match.ok ? { tile: match.value.data.tile.get(), facing: match.value.data.facing.get(), stride: match.value.data.stride.get().kind } : undefined
})

const ReadVillagerFacing = Game.Inspector("Town/ReadVillagerFacing", {
  queries: { villagers: Game.Query({ selection: { look: Game.Query.read(Look), facing: Game.Query.read(Facing) }, with: [Villager] }) }
}, ({ queries }) => Object.fromEntries(queries.villagers.each().map(({ data }) => [data.look.get().character, data.facing.get()])))

// Kit paces on its own clock. The run is deterministic (fixed steps, a
// seeded Rng), so a first run with the same keys finds when Kit next rests
// on (15,8), right beside the player, and the real run taps there.
const probe = start(script)
probe.tick(setupSchedule)
let kitBeside: number | undefined
for (let frame = 0; frame < 1200 && kitBeside === undefined; frame++) {
  probe.tick(updateSchedule)
  const walker = probe.inspect(ReadWalker)
  if (frame > 490 + PLAY && walker !== undefined && sameCell(walker.tile, { col: 15, row: 8 }) && walker.stride === "still") kitBeside = frame + 1 - PLAY
}
if (kitBeside === undefined) throw new Error("Kit never came back to (15,8).")
const talkToKit = kitBeside + 1

const runtime = start([
  ...script,
  ...tap(talkToKit, "action"),
  ...[10, 20, 30, 40].flatMap((offset) => tap(talkToKit + offset, "action"))
])

// Checked after every frame: every solid thing (the player, villagers,
// signs) holds its own tiles, including a tile an actor is still leaving,
// and nobody stands inside a tree, a wall, or water.
const NobodyOverlaps = Invariant.fromInspector(Game.Inspector("solid tiles are never shared", {
  queries: { solids: Game.Query({ selection: { tile: Game.Query.read(Tile), stride: Game.Query.optional(Stride), talkable: Game.Query.optional(Talkable) }, with: [Solid] }) }
}, ({ queries }) => {
  const claimed: Array<Cell> = []
  for (const { data } of queries.solids.each()) {
    const tile = data.tile.get()
    if (!isOpenGround(tile)) return `something solid inside the map's walls at (${tile.col}, ${tile.row})`
    const stride = data.stride?.get()
    const cells = stride?.kind === "walk" ? [tile, stride.from] : [tile]
    for (const cell of cells) {
      if (claimed.some((other) => sameCell(other, cell))) return `two solid things on (${cell.col}, ${cell.row})`
      claimed.push(cell)
    }
  }
  return undefined
}))

const session = Session.make(runtime, { hostClock, schedules: { setup: setupSchedule, update: updateSchedule }, invariants: [NobodyOverlaps] })

let frame = 0
let failures = 0
const walkerColumns = new Set<number>()
const check = (label: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} frame ${String(frame).padStart(3)}  ${label}${ok ? "" : `: ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}
/** Runs updates one by one until the scripted play reaches `until`, failing on a broken invariant or a failed tick. */
const runTo = (until: number) => {
  while (frame < until + PLAY) {
    const result = session.run("update", { frames: 1 })
    frame += 1
    if (!result.data.ok) {
      console.log(result)
      throw new Error(`update stopped at frame ${frame}: ${JSON.stringify(result.data.stop)}`)
    }
    const walker = runtime.inspect(ReadWalker)
    if (walker !== undefined) walkerColumns.add(walker.tile.col)
  }
}
const player = () => runtime.inspect(ReadPlayers).p1
const screen = () => runtime.inspect(ReadScreen)
const at = (col: number, row: number) => player()?.tile.col === col && player()?.tile.row === row

// Lints first: a warning here is often the whole answer. (Info lints say the
// render-only reads have no reader: the render schedule needs Pixi, so it is
// not described here.)
const lints = session.describe().data.lints
for (const lint of lints) if (lint.severity === "warning") console.log(`lint ${lint.code}: ${lint.message}`)
check("no lint warnings", lints.every((lint) => lint.severity !== "warning"), lints)

const setup = session.run("setup")
if (!setup.data.ok) throw new Error(`setup failed: ${JSON.stringify(setup.data.stop)}`)
check("setup seats p1 and spawns nobody yet", player() === undefined && screen().seats.length === 0, screen())
runTo(0)
check("p1 appears at (6,5) facing the sign, alone", at(6, 5) && player()?.facing === "Left" && screen().seats.join() === "p1", [player(), screen()])

runTo(1)
check("the house sign is readable", screen().mode === "Talking" && screen().dialogue?.speaker === "Sign", screen())
runTo(21)
check("its second page is the joke", screen().dialogue?.more === false && screen().mode === "Talking", screen().dialogue)
runTo(31)
check("the full joke", screen().dialogue?.text === "The door doesn't open.\nIt's a demo after all.", screen().dialogue)
runTo(41)
check("closing it goes back to exploring", screen().mode === "Exploring" && screen().dialogue === null, screen())

runTo(60)
check("a tap in a new direction only turns", at(6, 5) && player()?.facing === "Down", player())
runTo(70)
check("halfway through a step: tile taken, 8 pixels moved", at(6, 6) && player()?.position.y === 88, player())
runTo(78)
check("a tap walks exactly one tile", at(6, 6) && player()?.position.y === 96 && player()?.stride === "still", player())

runTo(110)
check("the wall: back on (6,5) and bumping", at(6, 5) && player()?.stride === "bump", player())
runTo(160)
check("the house at (6,4) stopped every step", at(6, 5) && player()?.position.y === 80 && player()?.stride === "still", player())

runTo(375)
check("walked to (14,8), above Ito", at(14, 8) && player()?.facing === "Down", player())
check("Kit paced to both ends of the route", walkerColumns.has(15) && walkerColumns.has(19), [...walkerColumns])

runTo(381)
check("the action button opens Ito's dialogue", screen().mode === "Talking" && screen().dialogue?.speaker === "Ito", screen())
check("Ito turns to the player", runtime.inspect(ReadVillagerFacing)["oldMan"] === "Up", runtime.inspect(ReadVillagerFacing))
const kitWhenTalking = runtime.inspect(ReadWalker)

runTo(425)
check("the player is frozen while talking", at(14, 8) && player()?.position.x === 224, player())
check("and so is Kit", JSON.stringify(runtime.inspect(ReadWalker)) === JSON.stringify(kitWhenTalking), [kitWhenTalking, runtime.inspect(ReadWalker)])
check("the text types out letter by letter", (screen().dialogue?.text.length ?? 0) > 0 && screen().dialogue?.complete === false, screen().dialogue)

runTo(431)
check("the action button shows the rest of a typing page", screen().dialogue?.complete === true && screen().dialogue?.more === true, screen().dialogue)
runTo(441)
check("then turns the page", screen().dialogue?.text === "" && screen().mode === "Talking", screen().dialogue)
runTo(481)
check("closing the last page goes back to exploring", screen().mode === "Exploring" && screen().dialogue === null, screen())

runTo(talkToKit + 1)
check(`Kit rests beside the player (frame ${kitBeside}) and talks`, screen().dialogue?.speaker === "Kit" && player()?.facing === "Right", [screen(), runtime.inspect(ReadWalker)])
check("Kit turns to the player", runtime.inspect(ReadWalker)?.facing === "Left", runtime.inspect(ReadWalker))
runTo(talkToKit + 41)
check("and Kit's pages close", screen().mode === "Exploring", screen())

runTo(talkToKit + 400)
check("Kit paces on and never steps into anyone (invariant held every frame)", at(14, 8) && walkerColumns.has(19), [...walkerColumns])

// ── Two players ────────────────────────────────────────────────────────
// p1 is on the arrows from the start; p2 joins on WASD and appears beside
// p1, turns to p1 and talks (p1 turns back; q does not leave mid-talk), then walks right as far as the
// leash lets it (both stay on one screen), and leaves with Q.
console.log("\nTwo players")
type WasdTimeline = Keyboard.Timeline<typeof leftKeys>
const wasd: WasdTimeline = [
  { frame: 5, press: ["right"], release: ["right"] },
  { frame: 10, press: ["up"], release: ["up"] },
  { frame: 30, press: ["action"], release: ["action"] },
  { frame: 50, press: ["back"], release: ["back"] },
  { frame: 80, press: ["action"], release: ["action"] },
  { frame: 170, press: ["action"], release: ["action"] },
  { frame: 200, press: ["right"] },
  { frame: 580, release: ["right"] },
  { frame: 600, press: ["back"], release: ["back"] }
]
const duo = createTownSimulation({ right: Keyboard.scripted(rightKeys, []), left: Keyboard.scripted(leftKeys, wasd), hostClock })
if (!duo.ok) throw new Error("The two-player town could not start.")
const together = Invariant.fromInspector(Game.Inspector("both players fit on one screen", {
  queries: { tiles: Game.Query({ selection: { tile: Game.Query.read(Tile) }, with: [Player] }) }
}, ({ queries }) => {
  const [first, second] = queries.tiles.each().map(({ data }) => data.tile.get())
  if (first === undefined || second === undefined) return undefined
  return Math.abs(first.col - second.col) > 13 || Math.abs(first.row - second.row) > 8
    ? `players ${JSON.stringify(first)} and ${JSON.stringify(second)} do not fit on one screen`
    : undefined
}))
const duoSession = Session.make(duo.value, { hostClock, schedules: { setup: setupSchedule, update: updateSchedule }, invariants: [NobodyOverlaps, together] })
duoSession.run("setup")
const duoPlayers = () => duo.value.inspect(ReadPlayers)
const duoScreen = () => duo.value.inspect(ReadScreen)
/** Runs the two-player town on until frame `until`, failing on a broken invariant or a failed tick. */
const duoRunTo = (until: number) => {
  const result = duoSession.run("update", { frames: until - frame })
  frame = until
  if (!result.data.ok) {
    console.log(result)
    throw new Error(`two-player update stopped: ${JSON.stringify(result.data.stop)}`)
  }
}
frame = 0
duoRunTo(6)
check("p2 joins on WASD beside p1", duoPlayers().p1 !== undefined && duoPlayers().p2 !== undefined &&
  Math.abs((duoPlayers().p2?.tile.col ?? 0) - (duoPlayers().p1?.tile.col ?? 0)) + Math.abs((duoPlayers().p2?.tile.row ?? 0) - (duoPlayers().p1?.tile.row ?? 0)) === 1, duoPlayers())
const startCol = duoPlayers().p2?.tile.col ?? 0
duoRunTo(31)
check("p2 faces p1 and talks to them", duoScreen().mode === "Talking" && duoScreen().dialogue?.speaker === "Player 2" && duoPlayers().p2?.facing === "Up", [duoScreen(), duoPlayers()])
check("p1 turns to p2", duoPlayers().p1?.facing === "Down", duoPlayers())
duoRunTo(52)
check("q mid-talk does not leave: p2 stays and the talk goes on", duoPlayers().p2 !== undefined && duoScreen().mode === "Talking", [duoScreen(), duoPlayers()])
duoRunTo(79)
check("Ah, it's player 1.", duoScreen().dialogue?.text === "Ah, it's player 1." && duoScreen().dialogue?.more === true, duoScreen().dialogue)
duoRunTo(169)
check("Ritmo supports multiplayer, of course!", duoScreen().dialogue?.text === "Ritmo supports multiplayer, of course!" && duoScreen().dialogue?.more === false, duoScreen().dialogue)
duoRunTo(171)
check("and the talk closes", duoScreen().mode === "Exploring" && duoScreen().dialogue === null, duoScreen())
duoRunTo(580)
check("p2 walks right until the leash stops it 13 tiles from p1, bumping, both on one screen",
  startCol === 6 && duoPlayers().p2?.tile.col === (duoPlayers().p1?.tile.col ?? 0) + 13 && duoPlayers().p2?.stride === "bump", duoPlayers())
duoRunTo(605)
check("Q leaves: p2 is gone, p1 stays", duoPlayers().p2 === undefined && duoPlayers().p1 !== undefined && duoScreen().seats.join() === "p1", duoPlayers())

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
if (failures > 0) process.exitCode = 1
