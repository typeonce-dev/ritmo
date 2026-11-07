import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, utimesSync, writeFileSync } from "node:fs"
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
import { approvalOf, approvalOfPart, assetStatus, changedOfPart, changedSince, decodeReview, encodeReview, hashFrame, mergeReviews, newAsset, partName, partOfComment, partReview, partsOf, partsStatus, pixelSummary, samePart, resolveComments, reviewSummary, statusSaid, whereOf, withPart, type AssetReview, type Frame, type Review } from "@typeonce/ritmo-tools/pixel/core/review.ts"
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
    // A frame left empty is an error on that frame.
    const blank = decodePng(readFileSync(join(folder, "public/art/hero.sheet.png")))
    const layout = readSpritesheet(JSON.parse(readFileSync(join(folder, "public/art/hero.sheet.json"), "utf8")), blank)
    const box = layout?.ok === true ? layout.sheet.frames[1] : undefined
    if (box === undefined || hero === undefined) throw new Error("the sheet has no second frame")
    for (let y = box.y; y < box.y + box.h; y++) blank.data.fill(0, (y * blank.width + box.x) * 4, (y * blank.width + box.x + box.w) * 4)
    writeFileSync(join(folder, "public/art/hero.sheet.png"), encodePng(blank))
    utimesSync(join(folder, "public/art/hero.sheet.png"), new Date(), new Date(Date.now() + 5000))
    const blankRead = await readAsset(hero)
    expect(blankRead.ok && blankRead.lint.ok ? blankRead.lint.issues.filter((issue) => issue.rule === "empty-frame").map((issue) => issue.frame) : undefined).toEqual([1])
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
    const shape = { frames, animations: [], normal: undefined }
    const sprite = { kind: "sprite" } as const
    expect(changedOfPart({ status: "approved", note: "", comments: [], approved: { frames: ["b"] } }, shape, sprite)).toBe("it looks different")
    expect(changedOfPart({ status: "approved", note: "", comments: [] }, shape, sprite)).toBeUndefined()
    expect(changedOfPart({ status: "changes", note: "", comments: [], approved: { frames: ["b"] } }, shape, sprite)).toBeUndefined()
  })
})

describe("the parts of an asset", () => {
  const frame = (animation: string, index: number, hash: string, normal = `map of ${hash}`): Frame => ({ name: `${animation} ${index}`, animation, index, x: 0, y: 0, w: 1, h: 1, duration: 100, hash, normal })
  const frames = [frame("walk", 0, "a"), frame("walk", 1, "b"), frame("idle", 0, "c")]
  const animations = [
    { name: "walk", frames: [0, 1] },
    { name: "idle", frames: [2] }
  ]
  const sheetShape = { frames, animations, normal: "map" }
  const walk = { kind: "animation", name: "walk" } as const
  const idle = { kind: "animation", name: "idle" } as const
  const walkMap = { kind: "map", name: "walk" } as const
  const idleMap = { kind: "map", name: "idle" } as const
  const allParts = [walk, idle, walkMap, idleMap]

  it("are a still's sprite and its normal map, or each animation of a sheet and the normal map of each", () => {
    expect(partsOf({ frames: [frames[0]!], animations: [], normal: undefined })).toEqual([{ kind: "sprite" }])
    expect(partsOf({ frames: [frames[0]!], animations: [], normal: "map" })).toEqual([{ kind: "sprite" }, { kind: "map" }])
    expect(partsOf(sheetShape)).toEqual(allParts)
    expect(partsOf({ ...sheetShape, normal: undefined })).toEqual([walk, idle])
    expect(samePart(walkMap, idleMap)).toBe(false)
    expect(samePart(walkMap, walk)).toBe(false)
    expect(samePart(walkMap, { kind: "map", name: "walk" })).toBe(true)
    expect(partName(walkMap)).toBe("walk normal map")
    expect(partName({ kind: "map" })).toBe("normal map")
  })

  it("are reviewed apart, and the file says each", () => {
    const review = withPart(withPart(newAsset, walk, { status: "approved", approved: approvalOfPart(sheetShape, walk) }), walkMap, { status: "changes", note: "Hair faces up" })
    expect(partReview(review, walk).status).toBe("approved")
    expect(partReview(review, idle).status).toBe("new")
    expect(partReview(review, walkMap).note).toBe("Hair faces up")
    expect(partReview(review, idleMap).status).toBe("new")
    expect(review.status).toBe("new")
    const round = decodeReview(encodeReview({ assets: { "a.png": review } }))
    expect(round.ok && round.value.assets["a.png"]).toEqual(review)
    expect(round.ok && round.value.assets["a.png"]?.animations?.walk?.approved?.frames).toEqual(["a", "b"])
    expect(round.ok && round.value.assets["a.png"]?.maps?.walk?.status).toBe("changes")
  })

  it("leave out of the file what says nothing", () => {
    const review = withPart(withPart(newAsset, walk, { note: "x" }), walk, { note: "" })
    expect(encodeReview({ assets: { "a.png": review } })).toBe('{\n  "version": 1,\n  "assets": {}\n}\n')
  })

  it("give the file one status: changes if any asks, approved once all are", () => {
    const approve = (review: AssetReview, part: Parameters<typeof partReview>[1]) => withPart(review, part, { status: "approved" })
    expect(assetStatus(newAsset, sheetShape)).toBe("new")
    expect(assetStatus(approve(newAsset, walk), sheetShape)).toBe("new")
    expect(assetStatus(approve(approve(newAsset, walk), idle), sheetShape)).toBe("new")
    expect(assetStatus(approve(approve(approve(newAsset, walk), idle), walkMap), sheetShape)).toBe("new")
    expect(assetStatus(allParts.reduce(approve, newAsset), sheetShape)).toBe("approved")
    expect(assetStatus(withPart(approve(approve(newAsset, walk), idle), idleMap, { status: "changes" }), sheetShape)).toBe("changes")
    expect(partsStatus(approve(newAsset, walkMap), [walkMap, idleMap])).toBe("new")
    expect(partsStatus(approve(approve(newAsset, walkMap), idleMap), [walkMap, idleMap])).toBe("approved")
    expect(statusSaid(withPart(approve(newAsset, walk), idleMap, { status: "changes" }))).toBe("changes")
    expect(statusSaid({ status: "approved", note: "", comments: [] })).toBe("approved")
  })

  it("flag only what changed: new art flags its animation and that animation's map, a new map only the map of the frames it changed", () => {
    const seen = allParts.reduce((review: AssetReview, part) => withPart(review, part, { status: "approved", approved: approvalOfPart(sheetShape, part) }), newAsset)
    expect(allParts.map((part) => changedOfPart(seen, sheetShape, part))).toEqual([undefined, undefined, undefined, undefined])
    const newMap = { ...sheetShape, normal: "other", frames: [frame("walk", 0, "a", "other"), frames[1]!, frames[2]!] }
    expect(allParts.map((part) => changedOfPart(seen, newMap, part))).toEqual([undefined, undefined, "the normal map of walk frame 0 changed", undefined])
    const allNew = { ...sheetShape, normal: "other", frames: [frames[0]!, frames[1]!, frame("idle", 0, "c", "other")] }
    expect(allParts.map((part) => changedOfPart(seen, allNew, part))).toEqual([undefined, undefined, undefined, "its normal map changed"])
    const newArt = { ...sheetShape, frames: [frame("walk", 0, "x", "map of a"), frames[1]!, frames[2]!] }
    expect(allParts.map((part) => changedOfPart(seen, newArt, part))).toEqual(["walk frame 0 looks different", undefined, "walk frame 0 looks different", undefined])
  })

  it("let a still's map stand in for each animation's when the still becomes a sheet", () => {
    const still = withPart(newAsset, { kind: "map" }, { status: "changes", note: "Hair" })
    expect(partReview(still, walkMap)).toEqual(still.map)
    const changed = withPart(still, walkMap, { status: "approved" })
    expect(changed.maps?.walk).toEqual({ status: "approved", note: "Hair" })
    expect(partReview(changed, idleMap).status).toBe("changes")
  })

  it("read a review from before them as it was: a sheet's approval stands for each animation, and a map nobody judged is not approved", () => {
    const old = decodeReview(JSON.stringify({ version: 1, assets: { "a.png": { status: "approved", note: "Good", comments: [{ animation: "walk", frame: 1, x: 0, y: 0, text: "t" }], approved: { frames: ["a", "b", "c"], durations: [100, 100, 100] } } } }))
    if (!old.ok) throw new Error(old.error)
    const review = old.value.assets["a.png"]!
    expect(partReview(review, walk).status).toBe("approved")
    expect(partReview(review, idle).note).toBe("Good")
    expect(partReview(review, walkMap).status).toBe("new")
    expect(assetStatus(review, sheetShape)).toBe("new")
    expect(assetStatus(review, { ...sheetShape, normal: undefined })).toBe("approved")
    expect(partOfComment(review.comments[0]!)).toEqual(walk)
    expect(changedOfPart(review, sheetShape, walk)).toBeUndefined()
    // Only the animation whose frames changed is flagged, though the approval was of the whole sheet.
    const newIdle = { ...sheetShape, frames: [frames[0]!, frames[1]!, frame("idle", 0, "x")] }
    expect(changedOfPart(review, newIdle, walk)).toBeUndefined()
    expect(changedOfPart(review, newIdle, idle)).toBe("idle frame 0 looks different")
    // Changing one keeps the rest as they were, and takes none of the file's comments along.
    const changed = withPart(review, idle, { status: "changes" })
    expect(partReview(changed, walk).status).toBe("approved")
    expect(partReview(changed, idle).status).toBe("changes")
    expect(partReview(changed, idle).note).toBe("Good")
    expect(changed.animations?.idle).toEqual({ status: "changes", note: "Good", approved: review.approved })
  })

  it("say apart what `pixel notes` reports, with comments on the map marked", () => {
    const review: AssetReview = {
      ...withPart(withPart(newAsset, walk, { status: "approved", approved: approvalOfPart(sheetShape, walk) }), walkMap, { status: "changes", note: "Hair" }),
      comments: [
        { animation: "walk", frame: 0, x: 0, y: 0, text: "Art" },
        { animation: "walk", frame: 0, x: 0, y: 0, text: "Map", about: "map", facing: "up" }
      ]
    }
    const said = reviewSummary(review, sheetShape)
    expect(said.status).toBe("changes")
    expect(said.parts).toEqual([
      { part: "animation", animation: "walk", status: "approved", note: undefined, changedSinceApproved: undefined },
      { part: "animation", animation: "idle", status: "new", note: undefined, changedSinceApproved: undefined },
      { part: "map", animation: "walk", status: "changes", note: "Hair", changedSinceApproved: undefined },
      { part: "map", animation: "idle", status: "new", note: undefined, changedSinceApproved: undefined }
    ])
    expect(said.comments?.map((comment) => comment.where)).toEqual(["walk frame 0, pixel 0,0", "normal map, walk frame 0, pixel 0,0"])
    expect(said.next).toContain("`parts`")
    expect(said.next).toContain('`about: "map"`')
    expect(partOfComment(review.comments[1]!)).toEqual(walkMap)
    // One part says as it always did, with nothing about parts.
    const still = reviewSummary({ status: "approved", note: "", comments: [] }, { frames: [frames[0]!], animations: [], normal: undefined })
    expect(still).not.toHaveProperty("parts")
    expect(still.next).toContain("Leave it as it is")
  })

  it("say when the person approved some and has not judged the rest", () => {
    expect(reviewSummary(withPart(newAsset, walk, { status: "approved" }), sheetShape).next).toContain("has not judged the rest")
    expect(pixelSummary([{ file: "a", ...reviewSummary(withPart(newAsset, walkMap, { note: "Hair" }), sheetShape) }]).summary).toContain("with a note or comments")
  })

  it("that are gone stay in the notes, and their comments stay open", () => {
    const review: AssetReview = {
      ...[{ kind: "map", name: "walk" } as const, { kind: "map", name: "run" } as const].reduce((all: AssetReview, part) => withPart(all, part, { status: "approved" }), withPart(newAsset, { kind: "animation", name: "run" }, { status: "changes", note: "Faster" })),
      comments: [{ animation: "run", frame: 0, x: 0, y: 0, text: "Knee" }]
    }
    // The animation renamed takes its map with it; the rest of the maps are still here.
    const renamed = reviewSummary(review, sheetShape)
    expect(renamed.goneParts).toEqual([
      { part: "animation", animation: "run", status: "changes", note: "Faster" },
      { part: "map", animation: "run", status: "approved", note: undefined }
    ])
    expect(renamed.comments?.map((comment) => comment.text)).toEqual(["Knee"])
    // With the map itself gone, so is each animation's.
    expect(reviewSummary(review, { ...sheetShape, normal: undefined }).goneParts?.map((part) => [part.part, part.animation])).toEqual([
      ["animation", "run"],
      ["map", "walk"],
      ["map", "run"]
    ])
    expect(reviewSummary(withPart(newAsset, { kind: "map" }, { status: "approved" }), { frames, animations, normal: undefined }).goneParts).toEqual([{ part: "map", animation: undefined, status: "approved", note: undefined }])
  })

  it("take a direction as about the map, and refuse any other subject", () => {
    const read = decodeReview(JSON.stringify({ assets: { "a.png": { comments: [{ frame: 0, x: 0, y: 0, text: "t", facing: "up" }] } } }))
    expect(read.ok && read.value.assets["a.png"]?.comments[0]?.about).toBe("map")
    expect(decodeReview(JSON.stringify({ assets: { "a.png": { comments: [{ frame: 0, x: 0, y: 0, text: "t", about: "art" }] } } }))).toMatchObject({ ok: false, error: expect.stringContaining("about must be") })
    expect(decodeReview(JSON.stringify({ assets: { "a.png": { animations: [] } } }))).toMatchObject({ ok: false, error: expect.stringContaining("animations must be") })
    expect(decodeReview(JSON.stringify({ assets: { "a.png": { animations: { walk: { status: "maybe" } } } } }))).toMatchObject({ ok: false, error: expect.stringContaining("a.png.animations.walk.status") })
    expect(decodeReview(JSON.stringify({ assets: { "a.png": { map: { approved: { frames: [1] } } } } }))).toMatchObject({ ok: false, error: expect.stringContaining("a.png.map.approved") })
    expect(decodeReview(JSON.stringify({ assets: { "a.png": { maps: { walk: { approved: { frames: ["a"], normal: "b" } } } } } }))).toMatchObject({ ok: false, error: expect.stringContaining("a.png.maps.walk.approved") })
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

  it("never tell the agent to leave alone what still has an open comment", () => {
    const comment = { frame: 0, x: 0, y: 0, text: "Too dark" }
    expect(reviewSummary({ status: "approved", note: "", comments: [] }, undefined).next).toContain("Leave it as it is")
    expect(reviewSummary({ status: "approved", note: "", comments: [comment] }, undefined).next).not.toContain("Leave it as it is")
    expect(reviewSummary({ status: "approved", note: "", comments: [comment] }, undefined).next).toContain("pixel resolve")
    expect(reviewSummary({ status: "approved", note: "But the eyes could be wider", comments: [] }, undefined).next).toContain("note")
    expect(reviewSummary({ status: "new", note: "", comments: [comment] }, undefined).next).toContain("Act on")
    // Resolved comments ask nothing more.
    expect(reviewSummary({ status: "approved", note: "", comments: [{ ...comment, resolved: true }] }, undefined).next).toContain("Leave it as it is")
    const frames: ReadonlyArray<Frame> = [{ name: "", index: 0, x: 0, y: 0, w: 8, h: 8, hash: "new" }]
    expect(reviewSummary({ status: "approved", note: "", comments: [comment], approved: { frames: ["old"] } }, { frames, animations: [], normal: undefined }).next).toContain("pixel resolve")
  })

  it("put words left without a status ahead of what nobody has looked at, and count them apart", () => {
    const order = pixelSummary([
      { file: "untouched", status: "new" as const },
      { file: "approved", status: "approved" as const },
      { file: "stale", status: "approved" as const, changedSinceApproved: "it looks different" },
      { file: "commented", status: "new" as const, comments: [{}] },
      { file: "noted", status: "new" as const, note: "Rounder" },
      { file: "approved-commented", status: "approved" as const, comments: [{}] },
      { file: "approved-noted", status: "approved" as const, note: "Lovely" }
    ])
    expect(order.assets.map((entry) => entry.file)).toEqual(["commented", "noted", "approved-commented", "stale", "untouched", "approved", "approved-noted"])
    expect(order.summary).toBe("4 approved (1 changed since: ask the person to look again; 1 with open comments: read them), 0 with changes asked, 2 with a note or comments but no status set: act on them, 1 not reviewed yet (of 7).")
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
  const withServer = async (paths: ReadonlyArray<string>, run: (url: string) => Promise<void>, listWait?: number): Promise<void> => {
    const server: Server = createServer((request, response) => void api(paths, listWait)(request, response))
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
      // An id in a saved review is never a path to write: nothing found, nothing written, and it is said back.
      const review = encodeReview({ assets: { "../../etc/passwd": { status: "approved", note: "", comments: [] } } })
      const { review: base } = (await (await fetch(`${url}/library?since=`)).json()) as { review: string }
      const saved = await fetch(`${url}/review?base=${base}`, { method: "PUT", body: review })
      expect(saved.status).toBe(200)
      expect(((await saved.json()) as { ignored: ReadonlyArray<string> }).ignored).toEqual(["../../etc/passwd"])
      expect(existsSync(join(folder, "pixel.review.json"))).toBe(false)
    })
  })

  it("keeps saving after the agent renames art the page holds a review of, and keeps that review under its old name", async () => {
    const folder = game()
    await withServer([join(folder, "public")], async (url) => {
      const coin = idOf(join(folder, "public/art/coin.png"))
      const atlas = idOf(join(folder, "public/art/atlas.png"))
      const said = { status: "changes", note: "Rounder.", comments: [] } as const
      const first = (await (await fetch(`${url}/review`)).json()) as { version: string }
      const saved = (await (await fetch(`${url}/review?base=${first.version}`, { method: "PUT", body: encodeReview({ assets: { [coin]: said } }) })).json()) as { version: string }
      renameSync(join(folder, "public/art/coin.png"), join(folder, "public/art/token.png"))
      // The page has not looked since: its version is stale, and it still holds the old name.
      const stale = await fetch(`${url}/review?base=${saved.version}`, { method: "PUT", body: encodeReview({ assets: { [coin]: said, [atlas]: { status: "approved", note: "", comments: [] } } }) })
      expect(stale.status).toBe(409)
      const now = ((await stale.json()) as { version: string }).version
      const merged = await fetch(`${url}/review?base=${now}`, { method: "PUT", body: encodeReview({ assets: { [coin]: said, [atlas]: { status: "approved", note: "", comments: [] } } }) })
      expect(merged.status).toBe(200)
      expect(((await merged.json()) as { ignored: ReadonlyArray<string> }).ignored).toEqual([coin])
      const file = decodeReview(readFileSync(join(folder, "pixel.review.json"), "utf8"))
      expect(file.ok && [file.value.assets["public/art/coin.png"]?.note, file.value.assets["public/art/atlas.png"]?.status]).toEqual(["Rounder.", "approved"])
    })
  })

  it("does not let a page that has not seen art come back write over its review", async () => {
    const folder = game()
    const file = join(folder, "public/art/coin.png")
    const coinKey = "public/art/coin.png"
    writeFileSync(join(folder, "pixel.review.json"), encodeReview({ assets: { [coinKey]: { status: "changes", note: "Rounder.", comments: [] } } }))
    renameSync(file, join(folder, "public/art/token.png"))
    await withServer([join(folder, "public")], async (url) => {
      // The page reads the review while the file is away.
      const { version, text } = (await (await fetch(`${url}/review`)).json()) as { version: string; text: string }
      renameSync(join(folder, "public/art/token.png"), file)
      expect((await fetch(`${url}/review?base=${version}`, { method: "PUT", body: text })).status).toBe(409)
      const saved = decodeReview(readFileSync(join(folder, "pixel.review.json"), "utf8"))
      expect(saved.ok && saved.value.assets[coinKey]?.note).toBe("Rounder.")
    })
  })

  it("answers while it reads, and says how far it is", async () => {
    const folder = game()
    mkdirSync(join(folder, "public/more"))
    for (let i = 0; i < 8; i++) writeFileSync(join(folder, `public/more/coin-${i}.png`), encodePng(coin(i)))
    await withServer(
      [join(folder, "public")],
      async (url) => {
        const first = (await (await fetch(`${url}/library?since=`)).json()) as { reading?: { done: number; total: number }; entries?: ReadonlyArray<unknown> }
        expect(first.entries).toBeUndefined()
        expect(first.reading?.total).toBe(12)
        expect(first.reading?.done).toBeLessThan(12)
        let listed = first
        // A look that never waits still gets the list once all is read: it does not have to beat the clock.
        for (let look = 0; listed.entries === undefined && look < 1000; look++) {
          await new Promise((next) => setTimeout(next, 20))
          listed = (await (await fetch(`${url}/library?since=`)).json()) as typeof first
        }
        expect(listed.entries).toHaveLength(12)
        expect(listed.reading).toBeUndefined()
      },
      0
    )
  }, 60_000)

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
