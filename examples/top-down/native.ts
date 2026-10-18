import { FixedLoop } from "@typeonce/ritmo"
import { Keyboard, Touch } from "@typeonce/ritmo-browser"
import { NativeHost, NativeHostClock, NativeNodeRegistry, NativeTickSource } from "@typeonce/ritmo-native"
import { FIXED_STEP, MAX_FRAME_SECONDS, MAX_STEPS_PER_FRAME, WORLD_WIDTH, WORLD_HEIGHT } from "./constants.ts"
import { createTopDownSimulation } from "./simulation.ts"
import { Game, Position, Renderable, Camera, CurrentPlayerFrame, CollectedCount } from "./schema.ts"
import { inputBindings } from "./types.ts"

const Drawing = Game.Inspector("Native/Drawing", { resources: { camera: Game.System.readResource(Camera), frame: Game.System.readResource(CurrentPlayerFrame), count: Game.System.readResource(CollectedCount) }, queries: { actors: Game.Query({ selection: {
  position: Game.Query.read(Position), renderable: Game.Query.read(Renderable)
} }) } }, ({ queries, resources }) => ({ camera: resources.camera.get(), frame: resources.frame.get(), count: resources.count.get(), actors: queries.actors.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), renderable: m.data.renderable.get() })) }))

export default NativeHost.main((host) => {
  const parsed = Keyboard.parseTimeline(inputBindings, host.input)
  if (!parsed.ok) return host.fail(`input${parsed.error.path}: ${parsed.error.message}`)
  const live = Keyboard.actions(host.keyboard, inputBindings)
  const touch = Touch.track(host.pointer, host.blur, ({ width, height }) => ({
    stick: { region: { left: 0, top: 0, width: width / 2, height }, radius: 60 },
    buttons: { interact: { center: { x: width - 90, y: height - 90 }, radius: 48 } }
  }))
  let hasTouch = false
  const previous = { up: false, down: false, left: false, right: false, interact: false }
  const combined = {
    snapshot() {
      const keys = live.snapshot(), input = touch.snapshot()
      hasTouch ||= input.touched
      const merge = (name: keyof typeof previous, heldByTouch: boolean, edge?: Keyboard.ActionState): Keyboard.ActionState => {
        const held = keys[name].held || heldByTouch
        const result = { held, pressed: keys[name].pressed || !!edge?.pressed || held && !previous[name], released: !held && (keys[name].released || !!edge?.released || previous[name]) }
        previous[name] = held; return result
      }
      return { up: merge("up", input.stick.vector.y < -0.25), down: merge("down", input.stick.vector.y > 0.25),
        left: merge("left", input.stick.vector.x < -0.25), right: merge("right", input.stick.vector.x > 0.25),
        interact: merge("interact", input.buttons.interact.held, input.buttons.interact) }
    }, dispose() { live.dispose(); touch.dispose() }
  }
  const keyboard = host.headless ? Keyboard.scripted(inputBindings, parsed.value) : combined
  const simulation = createTopDownSimulation({ keyboard, hostClock: NativeHostClock.make(host) })
  if (!simulation.ok) return host.fail(simulation.error.message)
  const { runtime, setup, update } = simulation.value
  const initialized = runtime.tick(setup)
  if (!initialized.ok) return host.fail(JSON.stringify(initialized.error))
  host.snapshots(() => runtime.debug.dump())
  const backdrop = host.gfx.layer("world")
  const ground = backdrop.rect(WORLD_WIDTH, WORLD_HEIGHT, 0x22332e); backdrop.addChild(ground)
  const sheet = host.gfx.texture("spr_player.png")
  const layer = host.gfx.layer("actors")
  const registry = NativeNodeRegistry.make(layer)
  const hudLayer = host.gfx.layer("hud")
  const hud = hudLayer.text("RITMO NATIVE | WASD / arrows: move | E: collect", 0xf8e9c6); hud.x = 16; hud.y = 16; hudLayer.addChild(hud)
  const controls = host.gfx.layer("touch controls")
  const stick = controls.rect(120, 120, 0xf8e9c6), knob = controls.rect(24, 24, 0xffffff), button = controls.rect(96, 96, 0xf8e9c6)
  for (const node of [stick, knob, button]) { node.anchorX = node.anchorY = 0.5; node.alpha = 0.3; node.visible = false; controls.addChild(node) }
  const loop = FixedLoop.start({ source: NativeTickSource.make(host), step: FIXED_STEP,
    maxFrameSeconds: MAX_FRAME_SECONDS, maxStepsPerFrame: MAX_STEPS_PER_FRAME,
    update: () => runtime.tick(update),
    render: () => {
      const view = touch.view()
      stick.visible = knob.visible = view.stick !== null
      if (view.stick) { stick.x = view.stick.origin.x; stick.y = view.stick.origin.y; knob.x = view.stick.knob.x; knob.y = view.stick.knob.y }
      button.visible = hasTouch
      button.x = view.layout.buttons.interact.center.x; button.y = view.layout.buttons.interact.center.y
      const drawing = runtime.inspect(Drawing)
      layer.x = backdrop.x = host.gfx.width / 2 - drawing.camera.x
      layer.y = backdrop.y = host.gfx.height / 2 - drawing.camera.y
      hud.text = `RITMO NATIVE | WASD / arrows: move | E: collect | Collected: ${drawing.count}`
      const alive = new Set<number>()
      for (const actor of drawing.actors) {
        alive.add(actor.id)
        const n = registry.ensure(actor.id, () => actor.renderable.kind === "player" ? layer.sprite(sheet) : layer.rect(actor.renderable.width, actor.renderable.height, actor.renderable.color))
        n.anchorX = n.anchorY = 0.5; n.x = actor.position.x; n.y = actor.position.y
        if (actor.renderable.kind === "player") { n.width = actor.renderable.width; n.height = actor.renderable.height; n.frame = { x: drawing.frame.column * 16, y: drawing.frame.row * 16, width: 16, height: 16 } }
      }
      for (const [id] of registry.entries()) if (!alive.has(id)) registry.remove(id)
    }, onFailure: (failure) => host.fail(JSON.stringify(failure))
  })
  if (!loop.ok) return host.fail(JSON.stringify(loop.error))
  return { stop() { loop.value.stop(); keyboard.dispose(); if (host.headless) combined.dispose(); registry.clear(); backdrop.destroy(); layer.destroy(); hudLayer.destroy(); controls.destroy(); sheet.destroy() } }
})
