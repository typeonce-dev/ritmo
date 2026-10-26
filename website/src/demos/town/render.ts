// What the town looks like: the tile map, one render system per kind of
// entity, the camera, and the dialogue box. Render code only reads the
// world; the simulation (schema.ts, systems.ts) names no renderer.
import { Clock, Descriptor } from "@typeonce/ritmo"
import { RenderSync } from "@typeonce/ritmo-render"
import type { NodeRegistry } from "@typeonce/ritmo-render"
import { Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, Texture } from "pixi.js"

import { cellPosition, MAP_COLUMNS, MAP_ROWS, playerStart, TILE_SIZE } from "./map.ts"
import type { Character, Direction } from "./map.ts"
import { BUMP, Facing, Game, Look, Player, Position, Signpost, Stride, TURN, WALK } from "./schema.ts"
import type { StrideValue } from "./schema.ts"
import { groundLayer, objectLayer, signArt, walkColumn } from "./tiles.ts"
import type { Placed, Region, Sheet } from "./tiles.ts"
import type { DialogueView } from "./view.ts"

/** The screen, in art pixels: 15 x 10 tiles, the handheld's view of the town. */
export const VIEW_WIDTH = 15 * TILE_SIZE
export const VIEW_HEIGHT = 10 * TILE_SIZE

/** Every image the town is drawn with, loaded by the host. */
export interface Images {
  readonly sheets: Readonly<Record<Sheet, Texture>>
  readonly walk: Readonly<Record<Character, Texture>>
  readonly shadow: Texture
  readonly dialogBox: Texture
}

/** Cut-out textures over the loaded images, made once and shared by every node. */
export interface TownArt {
  readonly region: (region: Region) => Texture
  /** A character's walk frame: `frame` 0 and 2 stand, 1 and 3 step. */
  readonly walk: (character: Character, facing: Direction, frame: number) => Texture
  readonly shadow: Texture
  readonly dialogBox: Texture
}

export const makeArt = (images: Images): TownArt => {
  const cache = new Map<string, Texture>()
  const cut = (source: Texture, x: number, y: number, width: number, height: number): Texture => {
    const key = `${source.uid}:${x},${y},${width},${height}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const texture = new Texture({ source: source.source, frame: new Rectangle(x, y, width, height) })
    cache.set(key, texture)
    return texture
  }
  return {
    region: (region) =>
      cut(images.sheets[region.sheet], region.col * TILE_SIZE, region.row * TILE_SIZE, region.columns * TILE_SIZE, region.rows * TILE_SIZE),
    walk: (character, facing, frame) => cut(images.walk[character], walkColumn[facing] * TILE_SIZE, frame * TILE_SIZE, TILE_SIZE, TILE_SIZE),
    shadow: images.shadow,
    dialogBox: images.dialogBox
  }
}

/** The town's art, provided by the host like any service. */
export const Art = Descriptor.Service<TownArt>()("Town/Art")

// ── The map ─────────────────────────────────────────────────────────────

const place = (art: TownArt, layer: Container, placed: ReadonlyArray<Placed>) => {
  for (const { region, cell } of placed) {
    const sprite = new Sprite(art.region(region))
    sprite.position.set(cell.col * TILE_SIZE, cell.row * TILE_SIZE)
    layer.addChild(sprite)
  }
}

/** The ground and everything standing on it. It never changes, so it is drawn once. */
export const drawMap = (art: TownArt): Container => {
  const map = new Container()
  place(art, map, groundLayer())
  place(art, map, objectLayer())
  return map
}

// ── Actors and props ────────────────────────────────────────────────────

/** An actor on screen: a shadow under a body sprite showing one walk frame. */
export class ActorNode extends Container {
  readonly body: Sprite
  constructor(art: TownArt) {
    super()
    const shadow = new Sprite(art.shadow)
    shadow.position.set((TILE_SIZE - art.shadow.width) / 2, TILE_SIZE - art.shadow.height + 1)
    this.body = new Sprite()
    this.addChild(shadow, this.body)
  }
}

export const ActorNodes = Descriptor.Service<NodeRegistry.NodeRegistry<ActorNode>>()("Town/ActorNodes")
export const PropNodes = Descriptor.Service<NodeRegistry.NodeRegistry<Sprite>>()("Town/PropNodes")

/** The walk frame for a stride: a foot forward for the first half of each step, turn, or bump, then standing. */
const frameOf = (stride: StrideValue | undefined): number => {
  if (stride === undefined || stride.kind === "still") return 0
  const length = Clock.steps(stride.kind === "walk" ? WALK : stride.kind === "turn" ? TURN : BUMP)
  if (stride.elapsed * 2 > length) return 0
  return stride.foot === "left" ? 1 : 3
}

// The players and the villagers. A villager standing in place has no stride: it only turns.
const RenderActors = RenderSync.system(Game, {
  name: "Town/RenderActors",
  renderable: Look,
  transform: Position,
  registry: ActorNodes,
  select: { facing: Game.Query.read(Facing), stride: Game.Query.optional(Stride) },
  redrawOn: [Facing, Stride],
  services: { art: Art },
  create: ({ services }) => new ActorNode(services.art),
  apply: (node, { renderable, transform, data, services }) => {
    node.position.set(transform.x, transform.y)
    node.body.texture = services.art.walk(renderable.character, data.facing.get(), frameOf(data.stride?.get()))
    node.body.tint = renderable.tint ?? 0xffffff
  }
})

const RenderSigns = RenderSync.system(Game, {
  name: "Town/RenderSigns",
  renderable: Signpost,
  transform: Position,
  registry: PropNodes,
  services: { art: Art },
  create: ({ services }) => new Sprite(services.art.region(signArt)),
  apply: (sprite, { transform }) => sprite.position.set(transform.x, transform.y)
})

// ── The camera ──────────────────────────────────────────────────────────

/** Where the view looks: it centers a point and stays inside the map. */
export interface CameraValue {
  readonly follow: (x: number, y: number) => void
}

export const Camera = Descriptor.Service<CameraValue>()("Town/Camera")

/** Scrolls `world` in whole art pixels so the view stays inside the map. */
export const makeCamera = (world: Container): CameraValue => ({
  follow: (x, y) => {
    const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max))
    world.position.set(
      -clamp(x - VIEW_WIDTH / 2, MAP_COLUMNS * TILE_SIZE - VIEW_WIDTH),
      -clamp(y - VIEW_HEIGHT / 2, MAP_ROWS * TILE_SIZE - VIEW_HEIGHT)
    )
  }
})

/** Frames every player: the point between them (the leash keeps both on screen), or the house door before anyone joins. */
const FollowPlayers = Game.System(
  "Town/FollowPlayers",
  {
    queries: { players: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Player] }) },
    services: { camera: Game.System.service(Camera) }
  },
  ({ queries, services }) => {
    const positions = queries.players.each().map(({ data }) => data.position.get())
    const points = positions.length > 0 ? positions : [cellPosition(playerStart.cell)]
    const x = points.reduce((sum, point) => sum + point.x, 0) / points.length
    const y = points.reduce((sum, point) => sum + point.y, 0) / points.length
    services.camera.follow(x + TILE_SIZE / 2, y + TILE_SIZE / 2)
  }
)

/** Ticked once per drawn frame, after the fixed updates. */
export const renderSchedule = Game.Schedule(RenderActors, RenderSigns, FollowPlayers)

// ── The dialogue box ────────────────────────────────────────────────────

/** The pack's pixel font. It is drawn 9 px tall: one font pixel per 9th of the size. */
export const FONT_FAMILY = "NinjaAdventure"
const FONT_PIXELS = 9
/** The font's space is one pixel wide; three of them make a readable gap between words. */
const spaced = (text: string) => text.replaceAll(" ", "   ")

/**
 * The box at the bottom of the screen: the speaker in its tab, the page
 * typing out, and a blinking arrow once the page has typed out.
 *
 * The box is art, scaled with the world. The text is drawn on its own
 * layer at the screen's resolution, with font pixels about three quarters
 * the size of art pixels: whole device pixels each, so it stays sharp, and
 * small enough to read like a page rather than a sign.
 */
export const makeDialogBox = (art: TownArt) => {
  const width = VIEW_WIDTH - 8
  const height = art.dialogBox.height
  const origin = { x: 4, y: VIEW_HEIGHT - height - 2 }
  const box = new Container()
  box.position.set(origin.x, origin.y)
  box.visible = false
  box.addChild(new NineSliceSprite({ texture: art.dialogBox, leftWidth: 72, topHeight: 16, rightWidth: 8, bottomHeight: 8, width, height }))
  const arrow = new Graphics().poly([0, 0, 6, 0, 3, 4]).fill(0xc0603a)
  arrow.position.set(width - 16, height - 13)
  box.addChild(arrow)

  const text = new Container()
  text.visible = false
  const speaker = new Text({ text: "", style: { fontFamily: FONT_FAMILY, fill: 0xf3e9d8 } })
  const body = new Text({ text: "", style: { fontFamily: FONT_FAMILY, fill: 0x3b2a26 } })
  text.addChild(speaker, body)
  let frames = 0

  return {
    /** The box, in art pixels: add it to the scaled screen. */
    node: box,
    /** The text, in CSS pixels: add it to the stage, unscaled. */
    text,
    /**
     * Places the text over the box. `scale` is device pixels per art pixel,
     * `ratio` device pixels per CSS pixel, and `screen` the screen's top-left
     * in CSS pixels.
     */
    layout: (scale: number, ratio: number, screen: { readonly x: number; readonly y: number }) => {
      const fontPixel = Math.max(1, Math.round((scale * 3) / 4))
      const line = 12 * fontPixel
      const snap = (value: number) => Math.round(value * ratio) / ratio
      const at = (artX: number, artY: number, deviceOffsetY: number) => ({
        x: snap(screen.x + ((origin.x + artX) * scale) / ratio),
        y: snap(screen.y + ((origin.y + artY) * scale + deviceOffsetY) / ratio)
      })
      for (const label of [speaker, body]) {
        label.resolution = ratio
        label.style.fontSize = (FONT_PIXELS * fontPixel) / ratio
        label.style.lineHeight = line / ratio
      }
      // The tab is 12 art pixels tall; the page area runs from 14 to 52.
      const tab = at(10, 0, (12 * scale - line) / 2)
      speaker.position.set(tab.x, tab.y)
      const page = at(12, 14, (38 * scale - 2 * line) / 2)
      body.position.set(page.x, page.y)
    },
    show: (view: DialogueView | null) => {
      box.visible = view !== null
      text.visible = view !== null
      if (view === null) return
      frames += 1
      const name = spaced(view.speaker)
      const page = spaced(view.text)
      if (speaker.text !== name) speaker.text = name
      if (body.text !== page) body.text = page
      arrow.visible = view.complete && Math.floor(frames / 24) % 2 === 0
    }
  }
}

/**
 * A one-line note in the top-left corner of the screen (who can join, how
 * to leave), on a dark band, in the dialogue's font.
 */
export const makeHint = () => {
  const node = new Container()
  node.visible = false
  const band = node.addChild(new Graphics())
  const label = node.addChild(new Text({ text: "", style: { fontFamily: FONT_FAMILY, fill: 0xf3e9d8 } }))
  const padding = { x: 3, y: 2 }
  let shown: string | null = null
  let place = { scale: 1, ratio: 1, screen: { x: 0, y: 0 } }

  const draw = () => {
    const { scale, ratio, screen } = place
    const fontPixel = Math.max(1, Math.round(scale / 2))
    label.resolution = ratio
    label.style.fontSize = (FONT_PIXELS * fontPixel) / ratio
    label.style.lineHeight = (12 * fontPixel) / ratio
    const snap = (value: number) => Math.round(value * ratio) / ratio
    const left = snap(screen.x + (2 * scale) / ratio)
    const top = snap(screen.y + (2 * scale) / ratio)
    label.position.set(left + (padding.x * scale) / ratio, top + (padding.y * scale) / ratio)
    band.clear()
      .rect(left, top, label.width + (2 * padding.x * scale) / ratio, label.height + (2 * padding.y * scale) / ratio)
      .fill({ color: 0x0e1013, alpha: 0.6 })
  }

  return {
    /** The note, in CSS pixels: add it to the stage, unscaled. */
    node,
    /** Places the note over the screen, as the dialogue box's `layout`. */
    layout: (scale: number, ratio: number, screen: { readonly x: number; readonly y: number }) => {
      place = { scale, ratio, screen: { x: screen.x, y: screen.y } }
      draw()
    },
    show: (text: string | null) => {
      node.visible = text !== null
      if (text === null || text === shown) return
      shown = text
      label.text = spaced(text)
      draw()
    }
  }
}
