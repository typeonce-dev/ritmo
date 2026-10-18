import { Clock, FixedLoop, Result } from "@typeonce/ritmo"
import { Keyboard, Pointer } from "@typeonce/ritmo-browser"
import { expect, it } from "vitest"
import { NativeHostClock, NativeNodeRegistry, NativeTickSource } from "@typeonce/ritmo-native"
import { encodeSnapshot, start } from "@typeonce/ritmo-native/internal/host.ts"

it("drives FixedLoop and existing input modules, then releases listeners and nodes", async () => {
  const calls: unknown[][] = []; let next = 0, updates = 0, pressed = false, pointerX = 0
  const control = await start((host) => {
    expect(NativeHostClock.make(host).now()).toBe(17)
    const keyboard = Keyboard.actions(host.keyboard, { move: ["a"] })
    const pointer = Pointer.track(host.pointer, host.blur)
    const layer = host.gfx.layer("actors"), nodes = NativeNodeRegistry.make(layer)
    const rect = nodes.ensure(1, () => layer.rect(20, 30, 0xff0000))
    expect(nodes.ensure(1, () => { throw new Error("duplicate") })).toBe(rect)
    rect.x = 9; rect.frame = { x: 1, y: 2, width: 3, height: 4 }
    const loop = FixedLoop.start({ source: NativeTickSource.make(host), step: Clock.hz(60), maxFrameSeconds: 0.1, maxStepsPerFrame: 5,
      update() { updates++; pressed ||= keyboard.snapshot().move.pressed; pointerX = pointer.snapshot().position.x; return Result.success(undefined) },
      render() {}, onFailure() { throw new Error("loop failed") } })
    if (!loop.ok) throw new Error("invalid loop")
    host.snapshots(() => ({ updates, pressed, pointerX }))
    return { stop() { loop.value.stop(); keyboard.dispose(); pointer.dispose(); nodes.clear(); layer.destroy() } }
  }, { call(...args) { calls.push(args); if (args[0] === "now") return 17; if (args[0] === "node") return next++; return undefined } }, { headless: true, input: [], width: 100, height: 100 })
  control.event({ type: "keydown", key: "a", repeat: false })
  control.event({ type: "pointermove", clientX: 12, clientY: 4, pointerId: 1, button: 0 })
  control.frame(1000 / 60)
  expect(updates).toBe(1); expect(pressed).toBe(true); expect(pointerX).toBe(12)
  expect(control.snapshot()).toBe(encodeSnapshot({ updates: 1, pressed: true, pointerX: 12 }))
  control.event({ type: "pause" }); control.frame(1000 / 60); expect(updates).toBe(1)
  control.event({ type: "resume" }); control.frame(30000); expect(updates).toBe(1)
  control.frame(1000 / 60); expect(updates).toBe(2)
  control.stop(); control.frame(1000 / 60); expect(updates).toBe(2)
  expect(calls.filter((a) => a[0] === "remove")).toHaveLength(2)
})

it("encodes signed zero, NaN, infinities and subnormals without JSON loss", () => {
  expect(encodeSnapshot([0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE])).toBe('[{"$f64":"0000000000000000"},{"$f64":"8000000000000000"},{"$f64":"7ff8000000000000"},{"$f64":"7ff0000000000000"},{"$f64":"fff0000000000000"},{"$f64":"0000000000000001"}]')
})

it("normalizes NaN sign/payload differences while retaining every other bit", () => {
  const buffer = new ArrayBuffer(8), view = new DataView(buffer)
  view.setUint32(0, 0xfff80000); view.setUint32(4, 123)
  expect(encodeSnapshot(view.getFloat64(0))).toBe(encodeSnapshot(NaN))
  expect(encodeSnapshot(-0)).not.toBe(encodeSnapshot(0))
  // Regression from generated Fuzz/16: V8 and QuickJS choose different NaN signs here.
  expect(encodeSnapshot(Math.sign(0 + 0) - Math.min(Math.round(NaN), -0.5 % 0.5))).toBe(encodeSnapshot(NaN))
})
