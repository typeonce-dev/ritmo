// The world read as plain data, for the page, the renderer, and the check.
import { Facing, Game, Mode, Player, Position, Seat, Stride, Tile } from "./schema.ts"
import type { SeatValue } from "./schema.ts"

/** The dialogue box: who speaks, the letters typed so far, and whether more follows. */
export interface DialogueView {
  readonly speaker: string
  readonly text: string
  /** The whole page has typed out. */
  readonly complete: boolean
  /** Another page follows this one. */
  readonly more: boolean
}

/** What the screen shows besides the map: the mode, the dialogue box while talking, and who plays. */
export const ReadScreen = Game.Inspector("Town/ReadScreen", {
  machines: { mode: Game.System.machine(Mode) },
  queries: { players: Game.Query({ selection: { seat: Game.Query.read(Seat) }, with: [Player] }) }
}, ({ machines, queries }) => {
  const mode = machines.mode.get()
  const page = mode._tag === "Talking" ? mode.pages[mode.page] ?? "" : ""
  const box: DialogueView | null = mode._tag === "Exploring"
    ? null
    : {
      speaker: mode.speaker,
      text: page.slice(0, mode.typed),
      complete: mode.typed >= page.length,
      more: mode.page + 1 < mode.pages.length
    }
  const seats: ReadonlyArray<SeatValue> = queries.players.each().map((entity) => queries.players.data.seat.get(entity))
  return { mode: mode._tag, dialogue: box, seats }
})

/** Each player's tile, pixel position, facing, and stride, by seat; a seat nobody holds is absent. */
export const ReadPlayers = Game.Inspector("Town/ReadPlayers", {
  queries: {
    players: Game.Query({
      selection: {
        seat: Game.Query.read(Seat),
        tile: Game.Query.read(Tile),
        position: Game.Query.read(Position),
        facing: Game.Query.read(Facing),
        stride: Game.Query.read(Stride)
      },
      with: [Player]
    })
  }
}, ({ queries }) => {
  const players: Partial<Record<SeatValue, { tile: { col: number; row: number }; position: { x: number; y: number }; facing: string; stride: string }>> = {}
  const { data } = queries.players
  for (const entity of queries.players.each()) {
    players[data.seat.get(entity)] = { tile: data.tile.get(entity), position: data.position.get(entity), facing: data.facing.get(entity), stride: data.stride.get(entity).kind }
  }
  return players
})
