import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { hashFile } from "@typeonce/ritmo-tools/music/cli/library.ts"
import { encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"

/** What every tool's `notes` says about what the person said, the same way: reviews of what is gone, and approvals with no record of what was seen. */

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const example = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url))

interface Notes {
  readonly summary: string
  readonly gone: ReadonlyArray<{ readonly name?: string; readonly file?: string; readonly status: string; readonly note?: string; readonly comments?: number; readonly next: string }>
}

const notes = <Entries>(...args: Array<string>): Notes & Entries => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as Notes & Entries
}

const folder = (): string => realpathSync(mkdtempSync(join(tmpdir(), "notes-")))

const UNRECORDED = "Approved, with no record of what was seen: ask the person to look again; only they approve it."

describe("notes", { timeout: 60_000 }, () => {
  it("sound: lists what was said about a sound the bank no longer has, and an approval with no record", () => {
    const game = folder()
    const bank = join(game, "game.sounds.json")
    copyFileSync(example("spirit-call.sounds.json"), bank)
    writeFileSync(join(game, "game.sounds.review.json"), JSON.stringify({ version: 1, sounds: { ghost: { status: "changes", note: "make it louder" }, hit: { status: "approved" } } }))
    const said = notes<{ sounds: ReadonlyArray<{ name: string; unrecorded?: boolean; next?: string }> }>("sound", "notes", bank)
    expect(said.gone).toEqual([{ name: "ghost", status: "changes", note: "make it louder", next: expect.stringContaining("Its sound is gone.") }])
    expect(said.gone[0]!.next).toContain("game.sounds.review.json")
    expect(said.sounds.find((sound) => sound.name === "hit")).toMatchObject({ unrecorded: true, next: UNRECORDED })
    expect(said.summary).toMatch(/^0 approved, 1 approved with no record of what was seen: ask the person to listen again, /)
    expect(said.summary).toContain("1 review of what is no longer found: see `gone`.")
  })

  it("fx: lists what was said about an effect the bank no longer has, with its open comments, and an approval with no record", () => {
    const game = folder()
    cpSync(example("fx"), game, { recursive: true })
    const bank = join(game, "effects.fx.json")
    const effects = Object.keys((JSON.parse(readFileSync(bank, "utf8")) as { effects: Record<string, unknown> }).effects)
    const comment = { draft: "a", frame: 0, x: 1, y: 1, text: "brighter here" }
    writeFileSync(join(game, "effects.fx.review.json"), JSON.stringify({ version: 1, effects: { ghost: { status: "new", comments: [comment] }, [effects[0]!]: { status: "approved" } } }))
    const said = notes<{ effects: ReadonlyArray<{ name: string; unrecorded?: boolean; next?: string }> }>("fx", "notes", bank)
    expect(said.gone).toEqual([{ name: "ghost", status: "new", comments: 1, next: expect.stringContaining("Its effect is gone.") }])
    expect(said.effects.find((effect) => effect.name === effects[0])).toMatchObject({ unrecorded: true, next: UNRECORDED })
    expect(said.summary).toMatch(/^0 approved, 1 approved with no record of what was seen: ask the person to look again, /)
    expect(said.summary).toContain("1 review of what is no longer found")
  })

  it("music: lists the review of a deleted audio file and of a deleted song, and an approval with no record", async () => {
    const game = folder()
    writeFileSync(join(game, "package.json"), "{}")
    mkdirSync(join(game, "music"))
    const theme = join(game, "music", "theme.song.json")
    expect(spawnSync(process.execPath, [cli, "music", "init", theme]).status).toBe(0)
    copyFileSync(example("village.song.reference.wav"), join(game, "music", "boss.wav"))
    copyFileSync(example("village.song.reference.wav"), join(game, "music", "day.wav"))
    writeFileSync(join(game, "music.review.json"), JSON.stringify({ version: 1, files: { "music/boss.wav": { status: "approved", note: "", comments: [], approved: await hashFile(join(game, "music", "boss.wav")) }, "music/day.wav": { status: "approved", note: "", comments: [] } } }))
    writeFileSync(join(game, "music", "theme.song.review.json"), JSON.stringify({ version: 1, status: "approved", note: "", comments: [], edits: [] }))
    writeFileSync(join(game, "music", "old.song.review.json"), JSON.stringify({ version: 1, status: "changes", note: "slower", comments: [], edits: [] }))
    rmSync(join(game, "music", "boss.wav"))
    const said = spawnSync(process.execPath, [cli, "music", "notes", "music"], { cwd: game, encoding: "utf8" })
    expect(said.status, said.stderr).toBe(0)
    const read = JSON.parse(said.stdout) as Notes & { music: ReadonlyArray<{ file: string; unrecorded?: boolean; next: string }> }
    expect(read.gone).toEqual([
      { file: "music/old.song.json", review: "music/old.song.review.json", status: "changes", note: "slower", comments: 0, next: "Its song is gone. If it was renamed, rename music/old.song.review.json to match; if it was deleted, delete music/old.song.review.json." },
      { file: "music/boss.wav", review: "music.review.json", key: "music/boss.wav", status: "approved", comments: 0, next: "Its file is gone. If it was renamed, move its review to the new name's key in music.review.json; if it was deleted, remove it there." }
    ])
    for (const file of ["music/day.wav", "music/theme.song.json"]) expect(read.music.find((entry) => entry.file === file), file).toMatchObject({ unrecorded: true, next: UNRECORDED })
    expect(read.summary).toBe("0 approved, 2 approved with no record of what was seen: ask the person to listen again, 0 with changes asked, 0 not reviewed yet (of 2). 2 reviews of what is no longer found: see `gone`.")
  })

  it("pixel: an approval with no record is not taken as approved, and a gone review is counted", () => {
    const game = folder()
    writeFileSync(join(game, "package.json"), "{}")
    mkdirSync(join(game, "public", "art"), { recursive: true })
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    writeFileSync(join(game, "public", "art", "knight.png"), encodePng({ width: 4, height: 4, data }))
    writeFileSync(join(game, "pixel.review.json"), JSON.stringify({ assets: { "public/art/knight.png": { status: "approved" }, "public/art/ghost.png": { status: "changes", note: "darker" } } }))
    const said = spawnSync(process.execPath, [cli, "pixel", "notes", "public/art"], { cwd: game, encoding: "utf8" })
    expect(said.status, said.stderr).toBe(0)
    const read = JSON.parse(said.stdout) as Notes & { assets: ReadonlyArray<{ file: string; unrecorded?: boolean; next: string }> }
    expect(read.assets[0]).toMatchObject({ file: "public/art/knight.png", unrecorded: true, next: UNRECORDED })
    expect(read.gone).toEqual([{ file: "public/art/ghost.png", review: "pixel.review.json", key: "public/art/ghost.png", status: "changes", note: "darker", comments: 0, next: expect.stringContaining("Its file is gone.") }])
    expect(read.summary).toBe("0 approved, 1 approved with no record of what was seen: ask the person to look again, 0 with changes asked, 0 not reviewed yet (of 1). 1 review of what is no longer found: see `gone`.")
  })
})
