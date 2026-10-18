import { Decode, Descriptor, Schema } from "@typeonce/ritmo"
import { NativeHost } from "@typeonce/ritmo-native"
const Position = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number, y: Decode.number }))("Stress/Position")
const Velocity = Descriptor.ConstructedComponent(Decode.struct({ x: Decode.number, y: Decode.number }))("Stress/Velocity")
const Delta = Descriptor.ConstructedResource(Decode.number)("Stress/Delta")
const Game = Schema.bind(Schema.fragment({ components: { Position, Velocity }, resources: { Delta } }))
const Moving = Game.Query({ selection: { position: Game.Query.write(Position), velocity: Game.Query.read(Velocity) } })
const Setup = Game.System("Stress/Setup", { commands: Game.System.commands(Game.System.spawns(Position, Velocity)) }, ({ commands }) => {
  for (let i = 0; i < 5000; i++) commands.spawn(Game.Command.spawn([Position, { x: i, y: -i }], [Velocity, { x: 1, y: -2 }]))
})
export const Move = Game.System("Stress/Move", { queries: { moving: Moving }, resources: { dt: Game.System.readResource(Delta) } }, ({ queries, resources }) => {
  const dt = resources.dt.get()
  for (const { data } of queries.moving.each()) {
    const p = data.position.get(), v = data.velocity.get()
    data.position.set({ x: p.x + v.x * dt, y: p.y + v.y * dt })
  }
})
const update = Game.Schedule(Move)
export default NativeHost.main((host) => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Delta: 1 / 60 } })
  if (!made.ok) return host.fail("initial resources failed")
  const runtime = made.value
  if (!runtime.tick(Game.Schedule(Setup, Game.Schedule.applyDeferred())).ok) return host.fail("setup failed")
  host.snapshots(() => runtime.snapshot())
  return host.frames.subscribe(() => { const ticked = runtime.tick(update); if (!ticked.ok) host.fail("movement failed") })
})
