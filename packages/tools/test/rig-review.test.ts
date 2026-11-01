import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { decodePng, encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { decodeBank, decodeReview, encodeBank, encodeReview, type Bank, type Review } from "@typeonce/ritmo-tools/rig/core/bank.ts"
import { reviewApi } from "@typeonce/ritmo-tools/rig/cli/serve.ts"
import { memoryStore, type Session, type Version } from "@typeonce/ritmo-tools/rig/ui/store.ts"
import type { DraftResult } from "@typeonce/ritmo-tools/rig/core/view.ts"

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const examples = fileURLToPath(new URL("../examples/rig", import.meta.url))
const rig = (...args: Array<string>) => spawnSync(process.execPath, [cli, "rig", ...args], { encoding: "utf8" })

/** The review API on a port, as `rig review` mounts it under /api. */
const listen = (bank: string, scale?: number): Promise<{ readonly base: string; readonly server: Server; readonly close: () => void }> => {
  const api = reviewApi(bank, scale === undefined ? {} : { scale })
  const server = createServer((request, response) => {
    request.url = (request.url ?? "/").replace(/^\/api/, "")
    void api.handle(request, response)
  })
  return new Promise((done) =>
    server.listen(0, "localhost", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      done({ base: `http://localhost:${port}/api`, server, close: () => (api.close(), server.close()) })
    })
  )
}

type Draft = { readonly stamp: string; readonly result: DraftResult<string> }
const getJson = async <A>(url: string, init?: RequestInit): Promise<A> => (await (await fetch(url, init)).json()) as A

/** Waits until `ready` holds, polling, up to `ms`. */
const until = async (ready: () => Promise<boolean>, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!(await ready())) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((done) => setTimeout(done, 100))
  }
}

describe("the review page's server, on the example bank", () => {
  const folder = mkdtempSync(join(tmpdir(), "rig-review-"))
  cpSync(examples, folder, { recursive: true })
  writeFileSync(join(folder, "package.json"), '{"type":"module"}')
  const bank = join(folder, "hero.rig.json")
  let base = ""
  let close = (): void => {}
  beforeAll(async () => {
    const started = await listen(bank)
    base = started.base
    close = started.close
  })
  afterAll(() => close())

  it("opens the bank with the rig's frame, and bakes a draft with its frames, bones, key frames, and check", async () => {
    const session = await getJson<Session>(`${base}/session`)
    expect(session.rig).toMatchObject({ width: 264, height: 212, anchor: [118, 194] })
    expect(Object.keys(session.version.stamps)).toContain("attack/a")
    const draft = await getJson<Draft>(`${base}/draft?clip=attack&draft=a`)
    expect(draft.result.ok).toBe(true)
    if (!draft.result.ok) return
    const view = draft.result.view
    expect(view.art).toHaveLength(26)
    expect(view.art[0]).toMatch(/^data:image\/png;base64,/)
    expect(view.keys).toEqual(expect.arrayContaining([2, 4, 11, 12, 13, 14, 25]))
    expect(view.fast).toEqual([12, 13, 14])
    expect(Object.keys(view.bones[0]!)).toContain("sword")
    expect(view.check.accepted.map((issue) => issue.code)).toContain("draw-order")
    // Baked once per stamp: the second fetch is the same bake.
    expect((await getJson<Draft>(`${base}/draft?clip=attack&draft=a`)).stamp).toBe(draft.stamp)
  })

  it("says what is at a clicked pixel: the part, its own bone, the spot in its bone's frame, and the phase", async () => {
    const spot = await getJson<{ part: string; bone: string; local: [number, number]; phase: string }>(`${base}/spot`, { method: "POST", body: JSON.stringify({ clip: "attack", draft: "a", frame: 14, x: 218, y: 127 }) })
    expect(spot).toMatchObject({ bone: "sword", phase: "swing" })
    expect(["blade", "fuller"]).toContain(spot.part)
    expect(spot.local[0]).toBeGreaterThan(20)
  })

  it("writes the review, and pixel and span comments round-trip through notes and resolve", async () => {
    const review: Review = {
      clips: {
        attack: {
          status: "changes",
          note: "more reach",
          comments: [
            { draft: "a", frame: 14, x: 218, y: 127, part: "blade", bone: "sword", phase: "swing", local: [32.4, 0.3], text: "reach further" },
            { draft: "a", from: 12, to: 14, phases: ["swing"], text: "too fast" }
          ]
        }
      }
    }
    expect((await fetch(`${base}/review`, { method: "PUT", body: encodeReview(review) })).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(folder, "hero.rig.review.json"), "utf8"))).toMatchObject({ version: 2 })
    const notes = JSON.parse(rig("notes", bank).stdout) as { changes: Array<{ comments: Array<{ number: number; where: string; local?: [number, number] }> }> }
    expect(notes.changes[0]!.comments).toMatchObject([
      { number: 1, where: "draft a, frame 14 (swing), pixel (218, 127), on blade (bone sword)", local: [32.4, 0.3] },
      { number: 2, where: "draft a, frames 12-14 (swing)" }
    ])
    expect(rig("resolve", bank, "attack", "1", "2", "--reply", "longer reach, slower swing").status).toBe(0)
    const session = await getJson<Session>(`${base}/session`)
    const read = decodeReview(session.reviewText ?? "")
    expect(read.ok && read.value.clips.attack!.comments.map((comment) => comment.resolved)).toEqual([true, true])
    // A version 1 file, with no part-local spots, reads as it is.
    const old = decodeReview(JSON.stringify({ version: 1, clips: { idle: { status: "approved", comments: [{ draft: "a", frame: 2, x: 1, y: 1, text: "ok" }] } } }))
    expect(old.ok).toBe(true)
  }, 30_000)

  it("rebakes a draft whose tune the bank changes, with a new stamp and new frames", async () => {
    const before = await getJson<Draft>(`${base}/draft?clip=attack&draft=a`)
    const decoded = decodeBank(readFileSync(bank, "utf8"))
    if (!decoded.ok) throw new Error(decoded.error)
    const tuned: Bank = { ...decoded.value, clips: { ...decoded.value.clips, attack: { ...decoded.value.clips.attack!, drafts: { ...decoded.value.clips.attack!.drafts, a: { ...decoded.value.clips.attack!.drafts.a!, tune: { lean: 38 } } } } } }
    expect((await fetch(`${base}/bank`, { method: "PUT", body: encodeBank(tuned) })).ok).toBe(true)
    const version = await getJson<Version>(`${base}/version`)
    expect(version.stamps["attack/a"]).not.toBe(before.stamp)
    const after = await getJson<Draft>(`${base}/draft?clip=attack&draft=a`)
    expect(after.result.ok && after.result.view.tuned).toMatchObject({ lean: 38 })
    expect(after.result.ok && before.result.ok && after.result.view.art[14] !== before.result.view.art[14]).toBe(true)
  })

})

describe("rig review, the command", () => {
  /** `rig review` in its own process, as a person runs it: Node's own module loader, so modules read anew on each rebake. */
  const folder = mkdtempSync(join(tmpdir(), "rig-serve-"))
  cpSync(examples, folder, { recursive: true })
  writeFileSync(join(folder, "package.json"), '{"type":"module"}')
  const bank = join(folder, "hero.rig.json")
  let base = ""
  let child: ChildProcess | undefined
  beforeAll(async () => {
    child = spawn(process.execPath, [cli, "rig", "review", bank, "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] })
    let out = ""
    await new Promise<void>((done, fail) => {
      child!.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString()
        const at = out.indexOf("}")
        if (at >= 0) {
          base = `${(JSON.parse(out.slice(0, out.lastIndexOf("}") + 1)) as { url: string }).url}api`
          done()
        }
      })
      child!.on("exit", (code) => fail(new Error(`rig review exited ${code}`)))
    })
  }, 30_000)
  afterAll(() => {
    child?.kill()
  })

  it("serves the page and its API, and rebakes the drafts of a clip whose module the agent edits, reading its imports anew", async () => {
    expect((await fetch(base.replace(/api$/, ""))).ok).toBe(true)
    const before = await getJson<Draft>(`${base}/draft?clip=punch&draft=a`)
    const file = join(folder, "clips", "punch.js")
    writeFileSync(file, readFileSync(file, "utf8").replace('label: "straight punch, lead fist (unarmed)"', 'label: "straight punch, edited"'))
    await until(async () => (await getJson<Version>(`${base}/version`)).stamps["punch/a"] !== before.stamp)
    const after = await getJson<Draft>(`${base}/draft?clip=punch&draft=a`)
    expect(after.result.ok && after.result.view.label).toBe("straight punch, edited")
    // An edit to the rig module the clips import: every draft rebakes, with the shared constants anew.
    const kick = await getJson<Draft>(`${base}/draft?clip=kick&draft=a`)
    const hero = join(folder, "hero.js")
    writeFileSync(hero, readFileSync(hero, "utf8").replace("export const FEET = { near: 23, far: -22 }", "export const FEET = { near: 23, far: -26 }"))
    await until(async () => (await getJson<Version>(`${base}/version`)).stamps["kick/a"] !== kick.stamp)
    const moved = await getJson<Draft>(`${base}/draft?clip=kick&draft=a`)
    // The kick plants its far foot from FEET on frame 2: further back now (the leg reaches most of the 4 px).
    const foot = (draft: Draft) => (draft.result.ok ? draft.result.view.bones[2]!.footFar![4] : 0)
    expect(foot(moved) - foot(kick)).toBeLessThan(-3)
  }, 30_000)
})

describe("over the network", () => {
  it("bakes the page's frames at 1x for --host, at 2x on this machine", async () => {
    const folder = mkdtempSync(join(tmpdir(), "rig-host-"))
    cpSync(examples, folder, { recursive: true })
    writeFileSync(join(folder, "package.json"), '{"type":"module"}')
    const width = async (scale: number | undefined): Promise<number> => {
      const started = await listen(join(folder, "hero.rig.json"), scale)
      const draft = await getJson<Draft>(`${started.base}/draft?clip=idle&draft=a`)
      started.close()
      return draft.result.ok ? decodePng(Buffer.from(draft.result.view.art[0]!.split(",")[1]!, "base64")).width : 0
    }
    expect([await width(1), await width(undefined)]).toEqual([264, 528])
  }, 30_000)
})

describe("pivots the person drags", () => {
  /** A rig of one bone with a picture on it, its pivot at the picture's left middle. */
  const folder = mkdtempSync(join(tmpdir(), "rig-pivots-"))
  const bar = { width: 20, height: 6, data: new Uint8ClampedArray(20 * 6 * 4).map((_, i) => [228, 59, 68, 255][i % 4]!) }
  writeFileSync(join(folder, "bar.png"), encodePng(bar))
  writeFileSync(join(folder, "package.json"), '{"type":"module"}')
  writeFileSync(join(folder, "rig.mjs"), 'export default { size: [64, 64], anchor: [32, 40], bones: { root: { y: 10, length: 20 } }, parts: { bar: { bone: "root", z: 0, shape: { kind: "image", file: "bar.png", pivot: [0, 3] } } }, stances: { flat: {} } }')
  writeFileSync(join(folder, "still.mjs"), 'export default { frames: 2, fps: 12, loop: true, pose: (rig, t) => ({ bones: { root: 10 * Math.sin(2 * Math.PI * t) } }) }')
  const bank = join(folder, "bar.rig.json")
  writeFileSync(bank, encodeBank({ rig: "rig.mjs", clips: { still: { drafts: { a: { file: "still.mjs" } } } } }))
  let base = ""
  let close = (): void => {}
  beforeAll(async () => {
    const started = await listen(bank)
    base = started.base
    close = started.close
  })
  afterAll(() => close())

  it("turns a drag into the picture pixel under it, applies the bank's override on load, and lists it in notes", async () => {
    const before = await getJson<Draft>(`${base}/draft?clip=still&draft=a`)
    expect(before.result.ok && before.result.view.pivots[0]!.bar).toEqual([0, 10])
    // Dragged 5 frame pixels to the right of where the pivot is (the bone's start, frame pixel (32, 30)) on frame 0: 5 picture pixels along.
    const { pivot } = await getJson<{ pivot: [number, number] }>(`${base}/pivot`, { method: "POST", body: JSON.stringify({ clip: "still", draft: "a", frame: 0, part: "bar", x: 37, y: 30 }) })
    expect(pivot).toEqual([5, 3])
    const decoded = decodeBank(readFileSync(bank, "utf8"))
    if (!decoded.ok) throw new Error(decoded.error)
    expect((await fetch(`${base}/bank`, { method: "PUT", body: encodeBank({ ...decoded.value, pivots: { bar: pivot } }) })).ok).toBe(true)
    const after = await getJson<Draft>(`${base}/draft?clip=still&draft=a`)
    // The pivot still sits on the bone's start; the picture moved 5 back so its pixel 5 is there.
    expect(after.result.ok && after.result.view.pivots[0]!.bar).toEqual([0, 10])
    expect(after.result.ok && after.result.view.parts[0]![0]!.box[0]).toBeCloseTo(-5, 3)
    const notes = JSON.parse(rig("notes", bank).stdout) as { pivots: Record<string, [number, number]>; next: string }
    expect(notes.pivots).toEqual({ bar: [5, 3] })
    expect(notes.next).toContain("shape.pivot in the rig module")
    expect(rig("check", bank).status).toBe(0)
    // An override on a part that is not a picture is the bank's mistake, named.
    writeFileSync(bank, encodeBank({ ...decoded.value, pivots: { stick: [1, 1] } }))
    const wrong = rig("check", bank)
    expect(wrong.status).toBe(3)
    expect(wrong.stdout).toContain("the bank's pivots.stick: no image part named stick")
  }, 30_000)
})

describe("the demo's store, baking in the tab", () => {
  it("bakes the example bank from its modules with no server, and rebakes a tune", async () => {
    const hero = await import(pathToFileURL(join(examples, "hero.js")).href)
    const idle = await import(pathToFileURL(join(examples, "clips", "idle.js")).href)
    const bankText = JSON.stringify({ version: 1, rig: "hero.js", clips: { idle: { drafts: { a: { file: "clips/idle.js" } } } } })
    const store = memoryStore("hero.rig.json", bankText, { modules: { "hero.js": hero, "clips/idle.js": idle }, images: new Map() })
    const session = await store.session()
    expect(session?.rig).toMatchObject({ width: 264, height: 212 })
    const first = await store.draft("idle", "a")
    expect(first?.result.ok && first.result.view.art[0]).toMatchObject({ width: 528, height: 424 })
    await store.save("bank", JSON.stringify({ version: 1, rig: "hero.js", clips: { idle: { drafts: { a: { file: "clips/idle.js", tune: { breath: 3 } } } } } }))
    const tuned = await store.draft("idle", "a")
    expect(tuned?.stamp).not.toBe(first?.stamp)
    expect(tuned?.result.ok && tuned.result.view.tuned).toEqual({ breath: 3 })
    expect(await store.spot("idle", "a", 0, 118, 120)).toMatchObject({ bone: "torso" })
  })
})
