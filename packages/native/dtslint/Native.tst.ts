import { Clock, FixedLoop, HostClock } from "@typeonce/ritmo"
import { Keyboard, Pointer } from "@typeonce/ritmo-browser"
import { NodeRegistry } from "@typeonce/ritmo-render"
import { NativeGfx, NativeHost, NativeHostClock, NativeNodeRegistry, NativeTickSource } from "@typeonce/ritmo-native"
import { expect, it } from "tstyche"

it("injects the host, reuses structural input, and infers adapters", () => {
  const entry = NativeHost.main((host) => {
    expect(NativeHostClock.make(host)).type.toBe<HostClock.HostClock>()
    expect(NativeTickSource.make(host)).type.toBe<FixedLoop.TickSource>()
    const layer = host.gfx.layer("actors")
    expect(NativeNodeRegistry.make(layer)).type.toBe<NodeRegistry.NodeRegistry<NativeGfx.Node>>()
    expect(Keyboard.actions(host.keyboard, { jump: [" "] }).snapshot().jump.held).type.toBe<boolean>()
    expect(Pointer.track(host.pointer, host.blur).snapshot().position.x).type.toBe<number>()
    const rect = layer.rect(1, 2, 0xff0000)
    layer.addChild(rect); rect.frame = { x: 0, y: 0, width: 16, height: 16 }
    // @ts-expect-error Type 'string' is not assignable to type 'number'.
    rect.x = "3"
    // @ts-expect-error Argument of type 'number' is not assignable to parameter of type 'Texture'.
    layer.sprite(3)
    // @ts-expect-error Argument of type 'string' is not assignable to parameter of type 'Node'.
    layer.addChild("sprite")
    // @ts-expect-error Type 'string' is not assignable to type 'number'.
    rect.frame = { x: "0", y: 0, width: 16, height: 16 }
    // @ts-expect-error Argument of type 'number' is not assignable to parameter of type 'string'.
    host.fail(1)
  })
  expect(entry).type.toBe<(host: NativeHost.Host) => void>()
  NativeHostClock.make({ clock: { now: () => 0 } })
  // @ts-expect-error Property 'clock' is missing
  NativeHostClock.make({})
  NativeTickSource.make({ frames: { subscribe: () => ({ stop() {} }) } })
  // @ts-expect-error Property 'frames' is missing
  NativeTickSource.make({})
  // @ts-expect-error Type 'number' is not assignable to type 'void | { stop(): void; } | Promise<void | { stop(): void; }>'.
  NativeHost.main(() => 1)
  NativeHost.main(() => ({ stop() {} }))
})
