import { install } from "./kernels.ts"
import type { Backend } from "./kernels.ts"
import type { Entry, Host } from "../NativeHost.ts"
import type { Gfx, Layer, Node, Texture } from "../NativeGfx.ts"

export interface Bridge { call(operation: string, ...args: unknown[]): unknown }
export interface Options { readonly headless: boolean; readonly input: unknown; readonly width: number; readonly height: number }
type Event = { type: string; [field: string]: unknown }
/** Shared by the native bridge and the Node oracle. Each number keeps its IEEE representation. */
export const encodeSnapshot = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (typeof item !== "number") return item
  if (Number.isNaN(item)) return { $f64: "7ff8000000000000" }
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, item, false)
  let hex = ""; for (let i = 0; i < 8; i++) hex += view.getUint8(i).toString(16).padStart(2, "0")
  return { $f64: hex }
})
/** Internal engine protocol; every platform dependency enters through bridge. */
export const start = async (entry: Entry, bridge: Bridge, options: Options) => {
  const call = (op: string, ...args: Array<string | number>) => bridge.call(op, ...args)
  const listeners = new Map<string, Set<(event: Event) => void>>()
  const target = {
    addEventListener(type: string, listener: (event: Event) => void) {
      let set = listeners.get(type); if (!set) listeners.set(type, set = new Set()); set.add(listener)
    },
    removeEventListener(type: string, listener: (event: Event) => void) { listeners.get(type)?.delete(listener) },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: call("width") as number, height: call("height") as number }),
    setPointerCapture() {}, releasePointerCapture() {}, style: { touchAction: "none" }
  }
  const frames = new Set<(deltaMS: number) => void>()
  let snapshot: (() => unknown) | undefined
  let background = 0x16212a
  const ids = new WeakMap<Node | Layer, number>()
  const makeNode = (kind: number, texture?: Texture): Node => {
    const id = call("node", kind, texture?.id ?? -1) as number
    let destroyed = false
    const state: Record<string, unknown> = { x: 0, y: 0, width: texture?.width ?? 0, height: texture?.height ?? 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, tint: 0xffffff, alpha: 1, visible: true, text: "", frame: undefined }
    const node = { destroy() { if (destroyed) return; call("remove", id); destroyed = true } } as Node
    for (const key of Object.keys(state)) Object.defineProperty(node, key, {
      enumerable: true, get: () => state[key], set(value: unknown) {
        if (destroyed) throw new Error("Native node was destroyed; create a new node")
        if (key === "frame") {
          const f = value as Node["frame"]; call("frame", id, f?.x ?? 0, f?.y ?? 0, f?.width ?? 0, f?.height ?? 0)
        } else {
          if (key !== "text" && key !== "visible") {
            if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Native node ${key}: use a finite number`)
            if ((key === "width" || key === "height") && value < 0) throw new Error(`Native node ${key}: use a nonnegative number`)
            if (key === "alpha" && (value < 0 || value > 1)) throw new Error("Native node alpha: use a value from 0 to 1")
            if (key === "tint" && (!Number.isInteger(value) || value < 0 || value > 0xffffff)) throw new Error("Native node tint: use a 24-bit RGB color")
          }
          call("set", id, key, typeof value === "boolean" ? +value : value as number | string)
        }
        state[key] = value
      }
    })
    ids.set(node, id)
    node.width = state.width as number; node.height = state.height as number
    return node
  }
  const gfx: Gfx = {
    get width() { return call("width") as number }, get height() { return call("height") as number },
    safeArea: { get left() { return call("safeLeft") as number }, get top() { return call("safeTop") as number }, get right() { return call("safeRight") as number }, get bottom() { return call("safeBottom") as number } },
    get background() { return background }, set background(value) { background = value },
    layer(_name) {
      const base = makeNode(0)
      const layer: Layer = {
        get x() { return base.x }, set x(value) { base.x = value },
        get y() { return base.y }, set y(value) { base.y = value },
        rect(width, height, color) { const n = makeNode(1); n.width = width; n.height = height; n.tint = color; return n },
        sprite: (texture) => makeNode(2, texture),
        text(value, color = 0xffffff) { const n = makeNode(3); n.text = value; n.tint = color; return n },
        addChild(node) { const id = ids.get(node); if (id === undefined) throw new Error("Attach a node created by this native host"); call("attach", ids.get(base)!, id) },
        removeChild(node) { const id = ids.get(node); if (id !== undefined) call("attach", -1, id) },
        destroy: () => base.destroy()
      }
      ids.set(layer, ids.get(base)!); return layer
    },
    texture(path) {
      const info = call("texture", path) as { id: number; width: number; height: number }
      let destroyed = false
      return { ...info, destroy() { if (!destroyed) { call("freeTexture", info.id); destroyed = true } } }
    }
  }
  // The listener storage is generic internally; public hosts keep the structural, precisely typed input contracts.
  const host: Host = { clock: { now: () => call("now") as number },
    frames: { subscribe(callback) { frames.add(callback); return { stop: () => { frames.delete(callback) } } } },
    keyboard: target as unknown as Host["keyboard"], pointer: target as unknown as Host["pointer"], blur: target as unknown as Host["blur"],
    gfx, input: options.input, headless: options.headless,
    snapshots(read) { snapshot = read }, fail(message) { call("fail", message) }
  }
  install(bridge.call("kernelsEnabled") ? { run: (...args) => bridge.call("kernel", ...args) as ReturnType<Backend["run"]> } : undefined)
  const stopped = await entry(host)
  let paused = false, resetDelta = false
  return {
    frame(deltaMS: number) { if (resetDelta) { deltaMS = 0; resetDelta = false }; if (!paused) for (const callback of [...frames]) callback(deltaMS); call("draw", background) },
    event(event: Event) {
      if (event.type === "pause") { paused = true; event = { type: "blur" } }
      else if (event.type === "resume") { paused = false; resetDelta = true }
      event.preventDefault = () => {}
      for (const callback of [...listeners.get(event.type) ?? []]) callback(event)
    },
    snapshot: () => snapshot ? encodeSnapshot(snapshot()) : "null",
    stop() { install(undefined); stopped?.stop(); frames.clear(); listeners.clear() }
  }
}
