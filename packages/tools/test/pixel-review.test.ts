import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import pngjs from "pngjs"
import { describe, expect, it } from "vitest"

import { decodePng, encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { findAssets, goneOf, libraryOf, readAsset, reviewPlace, reviewsOf, writeReview, writeReviews } from "@typeonce/ritmo-tools/pixel/cli/library.ts"
import { api } from "@typeonce/ritmo-tools/pixel/cli/serve.ts"
import type { RgbaImage } from "@typeonce/ritmo-tools/pixel/core/grid.ts"
import { approvalOf, changedOf, changedSince, decodeReview, encodeReview, hashFrame, mergeReviews, newAsset, pixelSummary, resolveComments, reviewSummary, whereOf, type Frame, type Review } from "@typeonce/ritmo-tools/pixel/core/review.ts"
import { atlasOf, readSpritesheet, spritesheetJson } from "@typeonce/ritmo-tools/pixel/core/spritesheet.ts"
import { TRANSPARENT, type PixelArt } from "@typeonce/ritmo-tools/pixel/core/fix.ts"

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

/** A picture `width` by `height`, each pixel colored by `color(x, y)` (`undefined` for transparent). */
const picture = (width: number, height: number, color: (x: number, y: number) => readonly [number, number, number] | undefined): RgbaImage => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = color(x, y)
      if (c !== undefined) data.set([...c, 255], (y * width + x) * 4)
    }
  return { width, height, data }
}

const coin = (shade = 200): RgbaImage => picture(8, 8, (x, y) => ((x - 3.5) ** 2 + (y - 3.5) ** 2 < 10 ? [shade, 180, 40] : undefined))

const sprite = `palette
. transparent
K #1a1c2c
Y #ffcd75

pixels
.KK.
KYYK
.KK.
`

/** A sheet `pixel sheet` would write: two animations of 4×4 frames, with its JSON. */
const sheet = (walkDuration = 1): { readonly png: Uint8Array; readonly json: string } => {
  const frame = (v: number): PixelArt => ({ width: 4, height: 4, palette: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }], indices: Int32Array.from({ length: 16 }, (_, i) => (i === v ? 1 : i % 5 === 0 ? 0 : TRANSPARENT)) })
  const clips = [
    { name: "walk", frames: [frame(1), frame(2), frame(3)], anchor: { x: 2, y: 3 }, fps: 10, beats: [1, walkDuration, 1], loop: "forward" as const },
    { name: "idle", frames: [frame(6), frame(7)], anchor: { x: 2, y: 3 }, fps: 4, beats: [1, 1], loop: "pingpong" as const }
  ]
  const atlas = atlasOf(clips, { columns: 8, spacing: 0 })
  const image: RgbaImage = { width: atlas.art.width, height: atlas.art.height, data: new Uint8ClampedArray(atlas.art.width * atlas.art.height * 4) }
  atlas.art.indices.forEach((index, i) => {
    const color = atlas.art.palette[index]
    if (index !== TRANSPARENT && color !== undefined) image.data.set([color.r, color.g, color.b, 255], i * 4)
  })
  return { png: encodePng(image), json: spritesheetJson({ image: "hero.sheet.png", clips, atlas, scale: 1 }) }
}

/** A game folder with its art, its tools' outputs beside it, and files that are not art. */
const game = (): string => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "pixel-review-")))
  const write = (name: string, contents: string | Uint8Array): void => {
    mkdirSync(join(folder, name, ".."), { recursive: true })
    writeFileSync(join(folder, name), contents)
  }
  write("package.json", "{}")
  write("public/art/coin.png", encodePng(coin()))
  write("public/art/coin.preview.png", encodePng(coin()))
  write("public/art/coin@4x.png", encodePng(coin()))
  write("public/art/coin@4x.json", "{}")
  write("public/art/hero.png", encodePng(coin(90)))
  write("public/art/hero.fixed.png", encodePng(coin(100)))
  write("public/art/hero.fixed.sprite.txt", sprite)
  write("public/art/hero.fixed.json", '{"width": 8, "height": 8, "palette": [], "pixels": []}')
  write("public/art/hero.project.png", encodePng(coin(90)))
  const { png, json } = sheet()
  write("public/art/hero.sheet.png", png)
  write("public/art/hero.sheet.json", json)
  write("public/art/hero.sheet.idle.onion.png", png)
  write("public/art/hero.sheet.frames/walk/0.png", png)
  // Still Time's atlas: a JSON beside the picture in a format of its own.
  write("public/art/atlas.png", encodePng(coin(60)))
  write("public/art/atlas.json", JSON.stringify({ image: "atlas.png", frameSize: [8, 8], anchor: [4, 7], frames: { down: [0, 1] } }))
  write("art/sprites/personA.txt", sprite)
  write("art/sprites/lamp.sprite.txt", sprite)
  write("art/sprites/lamp.sprite.render.png", encodePng(coin(150)))
  write("art/sheet.txt", "Notes on the sheet: person A walks left.\n")
  write("art/prompt.txt", "A cozy village at dusk.\n")
  write("art/node_modules/dep/icon.png", encodePng(coin()))
  write("art/.cache/old.png", encodePng(coin()))
  write("art/pixel.config.json", JSON.stringify({ palette: ["#1a1c2c", "#ffcd75"], sizes: ["8x8"] }))
  write("pixel.config.json", JSON.stringify({ palette: "sweetie-16" }))
  return folder
}

const ids = async (folder: string, paths: ReadonlyArray<string>) => (await findAssets(paths.map((path) => join(folder, path)))).map((asset) => [relative(folder, asset.file), asset.source === undefined ? undefined : relative(folder, asset.source)])

describe("finding a game's art", () => {
  it("takes PNGs and text sprites in a folder, the tools' outputs left out and each pair shown once", async () => {
    const folder = game()
    expect(await ids(folder, ["public", "art"])).toEqual([
      ["art/sprites/lamp.sprite.render.png", "art/sprites/lamp.sprite.txt"],
      ["art/sprites/personA.txt", undefined],
      ["public/art/atlas.png", undefined],
      ["public/art/coin.png", undefined],
      ["public/art/hero.fixed.png", "public/art/hero.png"],
      ["public/art/hero.sheet.png", "public/art/hero.png"]
    ])
  })

  it("takes a file named outright, whatever its name, once", async () => {
    const folder = game()
    expect(await ids(folder, ["public/art/coin@4x.png", "public/art/coin@4x.png", "art/sheet.txt"])).toEqual([
      ["art/sheet.txt", undefined],
      ["public/art/coin@4x.png", undefined]
    ])
    // Named outright, a text file that is not a sprite is broken, not skipped.
    const [notes] = await findAssets([join(folder, "art/sheet.txt")])
    expect(notes === undefined ? undefined : (await readAsset(notes)).ok).toBe(false)
  })

  it("passes over a path that is gone", async () => {
    expect(await findAssets([join(game(), "nothing")])).toEqual([])
  })

  it("reads a sheet by its JSON, and a picture whose JSON is not a sheet's as a still", async () => {
    const folder = game()
    const assets = await libraryOf(await findAssets([join(folder, "public")]))
    const hero = assets.find((entry) => entry.name === "hero.sheet.png")
    expect(hero?.kind).toBe("sheet")
    expect(hero?.animations.map((animation) => [animation.name, animation.frames, animation.play])).toEqual([
      ["walk", [0, 1, 2], [0, 1, 2]],
      ["idle", [3, 4], [3, 4]]
    ])
    expect(hero?.frames.map((frame) => [frame.animation, frame.index, frame.duration])).toEqual([
      ["walk", 0, 100],
      ["walk", 1, 100],
      ["walk", 2, 100],
      ["idle", 0, 250],
      ["idle", 1, 250]
    ])
    const atlas = assets.find((entry) => entry.name === "atlas.png")
    expect([atlas?.kind, atlas?.frames.length, atlas?.problem]).toEqual(["still", 1, undefined])
  })

  it("lints each asset against its nearest pixel.config.json, each frame of a sheet apart", async () => {
    const folder = game()
    const [person] = await findAssets([join(folder, "art/sprites/personA.txt")])
    const read = person === undefined ? undefined : await readAsset(person)
    // art/pixel.config.json allows 8×8 only, and its palette has both colors: the size is the one rule broken.
    expect(read?.ok === true && read.lint.ok ? [read.lint.issues.map((issue) => issue.rule), read.lint.config] : read).toEqual([["size"], relative(process.cwd(), join(folder, "art/pixel.config.json"))])
    const [hero] = await findAssets([join(folder, "public/art/hero.sheet.png")])
    const sheetRead = hero === undefined ? undefined : await readAsset(hero)
    // Linted against sweetie-16 at the root, each of the five frames apart: pure black and white are off its palette in each.
    const issues = sheetRead?.ok === true && sheetRead.lint.ok ? sheetRead.lint.issues.filter((issue) => issue.rule === "off-palette") : []
    expect(issues.map((issue) => issue.frame)).toEqual([0, 1, 2, 3, 4])
  })

  it("says why a sheet whose frames are off its picture cannot be read, and goes on", async () => {
    const folder = game()
    const { json } = sheet()
    writeFileSync(join(folder, "public/art/coin.json"), json)
    const entries = await libraryOf(await findAssets([join(folder, "public")]))
    expect(entries.find((entry) => entry.name === "coin.png")?.problem).toContain("is not on the 8×8 picture")
    expect(entries.find((entry) => entry.name === "hero.sheet.png")?.problem).toBeUndefined()
  })
})

describe("the review file", () => {
  it("lives at the game's root, keyed by the path from there, out of the folder that ships", () => {
    const folder = game()
    expect(reviewPlace(join(folder, "public/art/coin.png"))).toEqual({ reviews: join(folder, "pixel.review.json"), key: "public/art/coin.png" })
    const loose = realpathSync(mkdtempSync(join(tmpdir(), "pixel-review-")))
    expect(reviewPlace(join(loose, "coin.png")).reviews).toBe(join(loose, "pixel.review.json"))
  })

  it("round-trips, leaving out what says nothing, and names every problem", () => {
    const review: Review = {
      assets: {
        "public/art/coin.png": { status: "approved", note: "", comments: [], approved: { frames: ["0badf00d"] } },
        "public/art/hero.sheet.png": {
          status: "changes",
          note: "Thinner outline.",
          comments: [{ animation: "walk", frame: 2, x: 1, y: 0, width: 2, height: 3, text: "Too dark", resolved: true, reply: "Lighter now" }],
          approved: undefined
        },
        "public/art/untouched.png": newAsset
      }
    }
    const decoded = decodeReview(encodeReview(review))
    expect(decoded.ok && Object.keys(decoded.value.assets)).toEqual(["public/art/coin.png", "public/art/hero.sheet.png"])
    expect(decoded.ok && decoded.value.assets["public/art/hero.sheet.png"]).toEqual({ ...review.assets["public/art/hero.sheet.png"], approved: undefined })
    const broken = decodeReview(JSON.stringify({ version: 1, assets: { a: { status: "maybe", comments: [{ frame: -1, x: 0, y: 0, text: "" }] }, b: { approved: { frames: [1] } } } }))
    expect(broken.ok ? "" : broken.error).toBe('a.status must be one of new, approved, changes; a.comments[0] must be {"frame", "x", "y", "text"}, whole numbers from 0; b.approved must be {"frames": ["hash", ...], "durations": [ms, ...]}')
    expect(decodeReview("[]").ok).toBe(false)
  })

  it("keeps every review in the file, of art not under review too, when the page writes its own", async () => {
    const folder = game()
    const all = await findAssets([folder])
    await writeReview(all.find((asset) => asset.file.endsWith("personA.txt"))!, { status: "changes", note: "Taller.", comments: [] })
    const shown = await findAssets([join(folder, "public")])
    const coin = shown.find((asset) => asset.file.endsWith("coin.png"))!
    await writeReviews(shown, { assets: { [coin.id]: { status: "approved", note: "", comments: [] } } })
    const file = decodeReview(readFileSync(join(folder, "pixel.review.json"), "utf8"))
    expect(file.ok && Object.fromEntries(Object.entries(file.value.assets).map(([key, said]) => [key, said.status]))).toEqual({ "art/sprites/personA.txt": "changes", "public/art/coin.png": "approved" })
    expect((await reviewsOf(shown)).assets[coin.id]?.status).toBe("approved")
  })

  it("writes no file while nothing is said", async () => {
    const folder = game()
    const shown = await findAssets([join(folder, "public")])
    await writeReviews(shown, { assets: {} })
    expect(existsSync(join(folder, "pixel.review.json"))).toBe(false)
  })

  it("lists a review whose file is gone, and leaves alone one of art elsewhere", async () => {
    const folder = game()
    const all = await findAssets([folder])
    await writeReview(all.find((asset) => asset.file.endsWith("personA.txt"))!, { status: "changes", note: "Taller.", comments: [{ frame: 0, x: 1, y: 1, text: "Eyes" }] })
    await writeReview(all.find((asset) => asset.file.endsWith("coin.png"))!, { status: "approved", note: "", comments: [] })
    writeFileSync(join(folder, "public/art/coin.png"), "")
    const { rmSync } = await import("node:fs")
    rmSync(join(folder, "public/art/coin.png"))
    const shown = await findAssets([join(folder, "public")])
    expect((await goneOf(shown, [join(folder, "public")])).map((gone) => [gone.key, gone.status])).toEqual([["public/art/coin.png", "approved"]])
  })
})

describe("what an approval keeps", () => {
  const framesOf = (image: RgbaImage): ReadonlyArray<Frame> => [{ name: "", index: 0, x: 0, y: 0, w: image.width, h: image.height, hash: hashFrame(image, 0, 0, image.width, image.height) }]

  it("is the decoded pixels: a re-export that looks the same is no change, and neither is a color hidden under transparent pixels", () => {
    const image = coin()
    const approved = approvalOf(framesOf(image))
    // The same pixels written another way: other bytes, and an RGB value under each transparent pixel.
    const png = pngjs.PNG.sync.read(Buffer.from(encodePng(image)))
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] === 0) png.data.set([255, 0, 255], i)
    const again = pngjs.PNG.sync.write(png, { deflateLevel: 1, filterType: 4 })
    expect(Buffer.compare(again, Buffer.from(encodePng(image)))).not.toBe(0)
    expect(changedSince(approved, framesOf(decodePng(again)))).toBeUndefined()
    expect(changedSince(approved, framesOf(coin(201)))).toBe("it looks different")
    // A pixel that was transparent and is now opaque, in a color that matches the hidden one, is a change.
    const filled = coin()
    filled.data.set([0, 0, 0, 255], 0)
    expect(changedSince(approved, framesOf(filled))).toBe("it looks different")
  })

  it("says which frames of a sheet look different, and which show for longer", () => {
    const frames = (walk: ReadonlyArray<string>, durations: ReadonlyArray<number>): ReadonlyArray<Frame> =>
      walk.map((hash, index) => ({ name: `walk ${index}`, animation: "walk", index, x: index * 4, y: 0, w: 4, h: 4, duration: durations[index], hash }))
    const approved = approvalOf(frames(["a", "b", "c", "d", "e"], [100, 100, 100, 100, 100]))
    expect(approved).toEqual({ frames: ["a", "b", "c", "d", "e"], durations: [100, 100, 100, 100, 100] })
    expect(changedSince(approved, frames(["a", "b", "c", "d", "e"], [100, 100, 100, 100, 100]))).toBeUndefined()
    expect(changedSince(approved, frames(["a", "x", "y", "z", "e"], [100, 100, 100, 100, 100]))).toBe("walk frames 1-3 look different")
    expect(changedSince(approved, frames(["a", "b", "c", "d", "e"], [100, 100, 200, 100, 100]))).toBe("walk frame 2 shows for 200 ms, 100 when approved")
    expect(changedSince(approved, frames(["a", "b", "c", "d", "e"], [100, 150, 150, 100, 100]))).toBe("the timing of walk frames 1-2 changed")
    expect(changedSince(approved, frames(["a", "b", "c"], [100, 100, 100]))).toBe("3 frames, 5 when approved")
  })

  it("is only compared while approved, and not at all from a review with no hashes", () => {
    const frames: ReadonlyArray<Frame> = [{ name: "", index: 0, x: 0, y: 0, w: 1, h: 1, hash: "a" }]
    expect(changedOf({ status: "approved", note: "", comments: [], approved: { frames: ["b"] } }, frames)).toBe("it looks different")
    expect(changedOf({ status: "approved", note: "", comments: [] }, frames)).toBeUndefined()
    expect(changedOf({ status: "changes", note: "", comments: [], approved: { frames: ["b"] } }, frames)).toBeUndefined()
  })
})

describe("comments", () => {
  it("name their place in words", () => {
    expect(whereOf({ frame: 0, x: 3, y: 4, text: "" })).toBe("pixel 3,4")
    expect(whereOf({ frame: 0, x: 3, y: 4, width: 4, height: 2, text: "" })).toBe("pixels 3,4 to 6,5")
    expect(whereOf({ animation: "walk", frame: 2, x: 0, y: 0, text: "" })).toBe("walk frame 2, pixel 0,0")
  })

  it("resolve by number with a reply, and fail on a number there is no comment for", () => {
    const review: Review = { assets: { a: { status: "changes", note: "", comments: [{ frame: 0, x: 0, y: 0, text: "one" }, { frame: 0, x: 1, y: 1, text: "two" }] } } }
    const resolved = resolveComments(review, "a", [2], "Fixed")
    expect(resolved.ok && resolved.value.assets.a?.comments.map((comment) => [comment.resolved, comment.reply])).toEqual([
      [undefined, undefined],
      [true, "Fixed"]
    ])
    expect(resolveComments(review, "a", [3], "")).toEqual({ ok: false, error: "a has no comment 3 (it has 2)" })
  })

  it("merge the page's changes with a resolve the agent wrote meanwhile", () => {
    const one = { frame: 0, x: 0, y: 0, text: "one" }
    const base: Review = { assets: { a: { status: "changes", note: "", comments: [one] }, b: { status: "new", note: "x", comments: [] } } }
    const theirs: Review = { assets: { ...base.assets, a: { status: "changes", note: "", comments: [{ ...one, resolved: true, reply: "Done" }] } } }
    // The page changed both: a note on a, and b approved.
    const mine: Review = { assets: { a: { status: "changes", note: "Also the eyes.", comments: [one] }, b: { status: "approved", note: "x", comments: [] } } }
    const merged = mergeReviews(base, mine, theirs)
    expect(merged.assets.a).toEqual({ status: "changes", note: "Also the eyes.", comments: [{ ...one, resolved: true, reply: "Done" }] })
    expect(merged.assets.b?.status).toBe("approved")
    // Only the agent changed it: its version stands.
    expect(mergeReviews(base, base, theirs).assets.a?.comments[0]?.resolved).toBe(true)
  })

  it("sum up for the agent: open comments numbered, the changes first", () => {
    const said = reviewSummary({ status: "changes", note: "", comments: [{ frame: 0, x: 0, y: 0, text: "done", resolved: true }, { frame: 0, x: 2, y: 2, text: "open" }] }, undefined)
    expect(said.comments?.map((comment) => [comment.number, comment.where, comment.text])).toEqual([[2, "pixel 2,2", "open"]])
    expect(said.resolved).toBe(1)
    const order = pixelSummary([
      { file: "approved", status: "approved" as const },
      { file: "new", status: "new" as const },
      { file: "stale", status: "approved" as const, changedSinceApproved: "it looks different" },
      { file: "changes", status: "changes" as const }
    ])
    expect(order.assets.map((entry) => entry.file)).toEqual(["changes", "stale", "new", "approved"])
    expect(order.summary).toBe("2 approved (1 changed since: ask the person to look again), 1 with changes asked, 1 not reviewed yet (of 4).")
  })
})

describe("sheet JSON", () => {
  it("reads Aseprite's array format and its frame tags, played the way each says", () => {
    const frames = [0, 1, 2, 3].map((i) => ({ filename: `f${i}`, frame: { x: i * 2, y: 0, w: 2, h: 2 }, duration: 50 }))
    const read = readSpritesheet({ frames, meta: { frameTags: [{ name: "bounce", from: 0, to: 2, direction: "pingpong" }, { name: "back", from: 3, to: 3, direction: "reverse" }] } }, { width: 8, height: 2 })
    expect(read?.ok === true && read.sheet.animations).toEqual([
      { name: "bounce", frames: [0, 1, 2], play: [0, 1, 2, 1] },
      { name: "back", frames: [3], play: [3] }
    ])
  })

  it("is not a sheet's when its frames have no boxes", () => {
    expect(readSpritesheet({ image: "atlas.png", frameSize: [8, 8], frames: { down: [0, 1] } }, { width: 8, height: 8 })).toBeUndefined()
    expect(readSpritesheet({ width: 8, height: 8, palette: [], pixels: [] }, { width: 8, height: 8 })).toBeUndefined()
  })
})

describe("the review page's server", () => {
  const withServer = async (paths: ReadonlyArray<string>, run: (url: string) => Promise<void>): Promise<void> => {
    const server: Server = createServer((request, response) => void api(paths)(request, response))
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    } finally {
      server.close()
    }
  }
  const idOf = (file: string): string => relative(process.cwd(), file)

  it("lists the art, and opens each by its id", async () => {
    const folder = game()
    await withServer([join(folder, "public")], async (url) => {
      const listed = (await (await fetch(`${url}/library?since=`)).json()) as { version: string; review: string; entries: ReadonlyArray<{ id: string; kind: string }> }
      expect(listed.entries.map((entry) => [entry.id.split("/").pop(), entry.kind])).toEqual([
        ["atlas.png", "still"],
        ["coin.png", "still"],
        ["hero.fixed.png", "still"],
        ["hero.sheet.png", "sheet"]
      ])
      // Nothing changed: only the versions come back.
      expect(await (await fetch(`${url}/library?since=${listed.version}`)).json()).toEqual({ version: listed.version, review: listed.review })
      const id = encodeURIComponent(idOf(join(folder, "public/art/coin.png")))
      const detail = (await (await fetch(`${url}/asset?id=${id}`)).json()) as { issues: ReadonlyArray<unknown>; config: string }
      expect(detail.config).toBe(idOf(join(folder, "pixel.config.json")))
      const png = await fetch(`${url}/png?id=${id}`)
      expect(png.headers.get("content-type")).toBe("image/png")
      expect(decodePng(new Uint8Array(await png.arrayBuffer()))).toEqual(coin())
    })
  })

  it("serves nothing but the art it found", async () => {
    const folder = game()
    await withServer([join(folder, "public")], async (url) => {
      for (const id of [idOf(join(folder, "art/sprites/personA.txt")), idOf(join(folder, "public/art/coin@4x.png")), "../../etc/passwd", "/etc/passwd", ""]) {
        expect((await fetch(`${url}/png?id=${encodeURIComponent(id)}`)).status, id).toBe(404)
        expect((await fetch(`${url}/asset?id=${encodeURIComponent(id)}`)).status, id).toBe(404)
      }
      expect((await fetch(`${url}/../../etc/passwd`)).status).toBe(404)
      const review = encodeReview({ assets: { "../../etc/passwd": { status: "approved", note: "", comments: [] } } })
      const { review: base } = (await (await fetch(`${url}/library?since=`)).json()) as { review: string }
      expect((await fetch(`${url}/review?base=${base}`, { method: "PUT", body: review })).status).toBe(400)
    })
  })

  it("saves the whole review, and refuses one written over a newer file, with what it holds now", async () => {
    const folder = game()
    await withServer([join(folder, "public")], async (url) => {
      const coin = idOf(join(folder, "public/art/coin.png"))
      const { version } = (await (await fetch(`${url}/review`)).json()) as { version: string }
      const mine = encodeReview({ assets: { [coin]: { status: "changes", note: "Rounder.", comments: [{ frame: 0, x: 1, y: 1, text: "Flat here" }] } } })
      const saved = await fetch(`${url}/review?base=${version}`, { method: "PUT", body: mine })
      expect(saved.status).toBe(200)
      const after = ((await saved.json()) as { version: string }).version
      const file = decodeReview(readFileSync(join(folder, "pixel.review.json"), "utf8"))
      expect(file.ok && file.value.assets["public/art/coin.png"]?.note).toBe("Rounder.")
      // What the list says the review is now is what the save said: the page does not take its own save for the agent's.
      expect(((await (await fetch(`${url}/library?since=`)).json()) as { review: string }).review).toBe(after)
      // Saved again from the old version: refused, with the file as it is.
      const stale = await fetch(`${url}/review?base=${version}`, { method: "PUT", body: encodeReview({ assets: {} }) })
      expect(stale.status).toBe(409)
      const conflict = (await stale.json()) as { text: string; version: string }
      expect(conflict.version).toBe(after)
      expect(decodeReview(conflict.text)).toEqual({ ok: true, value: { assets: { [coin]: { status: "changes", note: "Rounder.", comments: [{ frame: 0, x: 1, y: 1, text: "Flat here" }] } } } })
      expect((await fetch(`${url}/review?base=${after}`, { method: "PUT", body: "not json" })).status).toBe(400)
    })
  })

  it("follows art the agent rewrites: a new version, and the new picture", async () => {
    const folder = game()
    await withServer([join(folder, "public")], async (url) => {
      const first = (await (await fetch(`${url}/library?since=`)).json()) as { version: string; entries: ReadonlyArray<{ name: string; version: string }> }
      const file = join(folder, "public/art/coin.png")
      writeFileSync(file, encodePng(coin(10)))
      utimesSync(file, new Date(), new Date(Date.now() + 5000))
      const later = (await (await fetch(`${url}/library?since=${first.version}`)).json()) as { version: string; entries: ReadonlyArray<{ name: string; version: string }> }
      expect(later.version).not.toBe(first.version)
      expect(later.entries.find((entry) => entry.name === "coin.png")?.version).not.toBe(first.entries.find((entry) => entry.name === "coin.png")?.version)
    })
  })
})

describe("the command line", () => {
  const run = (cwd: string, ...args: Array<string>) => spawnSync(process.execPath, [cli, "pixel", ...args], { cwd, encoding: "utf8" })

  it("reads back what the person said, the changes first, and resolves comments by number", { timeout: 60_000 }, async () => {
    const folder = game()
    const all = await findAssets([folder])
    const hero = all.find((asset) => asset.file.endsWith("hero.sheet.png"))!
    const heroRead = await readAsset(hero)
    await writeReview(hero, { status: "approved", note: "", comments: [], approved: heroRead.ok ? approvalOf(heroRead.frames) : undefined })
    await writeReview(all.find((asset) => asset.file.endsWith("coin.png"))!, { status: "changes", note: "Rounder.", comments: [{ frame: 0, x: 1, y: 2, width: 2, text: "Flat" }, { frame: 0, x: 5, y: 5, text: "Dent" }] })
    // The agent rewrites the sheet with a frame held longer.
    const { png, json } = sheet(2)
    writeFileSync(join(folder, "public/art/hero.sheet.png"), png)
    writeFileSync(join(folder, "public/art/hero.sheet.json"), json)
    const notes = run(folder, "notes", "public", "art")
    expect(notes.status, notes.stderr).toBe(0)
    const answer = JSON.parse(notes.stdout) as { summary: string; assets: ReadonlyArray<{ file: string; status: string; changedSinceApproved?: string; comments?: ReadonlyArray<{ number: number; where: string }>; lint?: ReadonlyArray<string> }>; gone: ReadonlyArray<unknown> }
    expect(answer.summary).toBe("1 approved (1 changed since: ask the person to look again), 1 with changes asked, 4 not reviewed yet (of 6).")
    expect(answer.assets.slice(0, 2).map((entry) => [entry.file, entry.status, entry.changedSinceApproved])).toEqual([
      ["public/art/coin.png", "changes", undefined],
      ["public/art/hero.sheet.png", "approved", "walk frame 1 shows for 200 ms, 100 when approved"]
    ])
    expect(answer.assets[0]?.comments?.map((comment) => [comment.number, comment.where])).toEqual([
      [1, "pixels 1,2 to 2,2"],
      [2, "pixel 5,5"]
    ])
    expect(answer.assets.find((entry) => entry.file === "art/sprites/personA.txt")?.lint).toEqual(["error: 4×3 is not an allowed size (8×8)"])
    expect(answer.gone).toEqual([])
    const resolved = run(folder, "resolve", "public/art/coin.png", "2", "--reply", "Filled the dent")
    expect(resolved.status, resolved.stderr).toBe(0)
    const after = JSON.parse(run(folder, "notes", "public").stdout) as { assets: ReadonlyArray<{ file: string; comments?: ReadonlyArray<{ number: number }>; resolved?: number }> }
    const coinNow = after.assets.find((entry) => entry.file === "public/art/coin.png")
    expect([coinNow?.comments?.map((comment) => comment.number), coinNow?.resolved]).toEqual([[1], 1])
    expect(run(folder, "resolve", "public/art/coin.png", "7").status).toBe(2)
  })

  it("exits 2 on a path that is not there, a folder with no art, and a text file named outright that is not a sprite", { timeout: 60_000 }, () => {
    const folder = game()
    mkdirSync(join(folder, "empty"))
    writeFileSync(join(folder, "empty/readme.txt"), "Not art.\n")
    for (const args of [["notes", "nowhere"], ["notes", "empty"], ["notes", "art/sheet.txt"], ["review", "empty"]]) {
      const result = run(folder, ...args)
      expect(result.status, args.join(" ")).toBe(2)
    }
    // Lint problems are warnings here, never the exit code.
    expect(run(folder, "notes", "art/sprites/personA.txt").status).toBe(0)
  })
})
