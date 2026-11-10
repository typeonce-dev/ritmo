import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { decodeBank as decodeFxBank } from "@typeonce/ritmo-tools/fx/core/bank.ts"
import { decodeSong } from "@typeonce/ritmo-tools/music/core/song.ts"
import { encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { decodeRecipe as decodePixelRecipe } from "@typeonce/ritmo-tools/pixel/core/recipe.ts"
import { decodeBank as decodeSoundBank } from "@typeonce/ritmo-tools/sound/core/recipe.ts"

/** Bad input is said, not taken: unknown keys, sizes past what the tools read, drafts that never return, and numbers out of range. */

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const example = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url))
const run = (cwd: string, ...args: Array<string>) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 60_000 })
const folder = (): string => mkdtempSync(join(tmpdir(), "limits-"))

/** A picture with a dark half, for the lint to count colors in. */
const picture = (): Uint8Array => {
  const data = new Uint8ClampedArray(8 * 8 * 4)
  for (let i = 0; i < 64; i++) data.set(i % 8 < 4 ? [20, 20, 30, 255] : [i * 3, 200, 90, 255], i * 4)
  return encodePng({ width: 8, height: 8, data })
}

describe("unknown keys", { timeout: 60_000 }, () => {
  it("in pixel.config.json are said with the nearest key, every problem at once", () => {
    const game = folder()
    writeFileSync(join(game, "art.png"), picture())
    writeFileSync(join(game, "pixel.config.json"), JSON.stringify({ palette: "sweetie-16", maxColours: 4, size: ["16x16"], sizes: ["big"] }))
    const linted = run(game, "pixel", "lint", "art.png")
    expect(linted.status).toBe(2)
    const report = JSON.parse(linted.stdout) as { problems: ReadonlyArray<string> }
    expect(report.problems).toEqual(["unknown key maxColours: did you mean maxColors?", "unknown key size: did you mean sizes?", 'sizes: "big" is not a size; a size is "WIDTHxHEIGHT", like "16x16"'])
    writeFileSync(join(game, "pixel.config.json"), JSON.stringify({ palette: "sweetie-16", maxColors: 4, sizes: ["16x16"] }))
    expect(run(game, "pixel", "lint", "art.png").status).toBe(3)
  })

  it("in a recipe, a bank, and a song are said with the nearest key", () => {
    const recipe = decodePixelRecipe(JSON.stringify({ zzz: 1, cleanup: { sizes: 2 } }))
    expect(!recipe.ok && recipe.error).toBe("unknown key zzz: did you mean crop?; unknown key cleanup.sizes: did you mean cleanup.size?")
    const sounds = JSON.parse(readFileSync(example("spirit-call.sounds.json"), "utf8")) as { sounds: Record<string, Record<string, unknown>> }
    const hit = sounds.sounds.hit!
    const sound = decodeSoundBank(JSON.stringify({ ...sounds, mastr: 1, sounds: { hit: { ...hit, revreb: 0.2 } } }))
    expect(!sound.ok && sound.error).toBe("unknown key mastr: did you mean master?; unknown key hit.revreb: did you mean hit.reverb?")
    const bank = JSON.parse(readFileSync(example("fx/effects.fx.json"), "utf8")) as Record<string, unknown>
    const fx = decodeFxBank(JSON.stringify({ ...bank, ramp: {} }))
    expect(!fx.ok && fx.error).toBe("unknown key ramp: did you mean ramps?")
    const song = decodeSong(JSON.stringify({ ...JSON.parse(readFileSync(example("village.song.json"), "utf8")), temp: 90 }))
    expect(!song.ok && song.error).toBe("unknown key temp: did you mean tempo?")
  })

  it("leave every shipped example as it was", () => {
    expect(decodeSoundBank(readFileSync(example("spirit-call.sounds.json"), "utf8")).ok).toBe(true)
    expect(decodeFxBank(readFileSync(example("fx/effects.fx.json"), "utf8")).ok).toBe(true)
    expect(decodeSong(readFileSync(example("village.song.json"), "utf8")).ok).toBe(true)
  })
})

describe("what is too large to read or draw", { timeout: 60_000 }, () => {
  it("a PNG whose header claims 30000×30000 is refused before it is decoded", () => {
    const game = folder()
    const bytes = Buffer.from(picture())
    bytes.writeUInt32BE(30000, 16)
    bytes.writeUInt32BE(30000, 20)
    writeFileSync(join(game, "liar.png"), bytes)
    const started = Date.now()
    const checked = run(game, "pixel", "check", "liar.png")
    expect(checked.status).toBe(2)
    expect(checked.stderr).toContain("30000×30000 pixels: the tools read pictures of at most 16,777,216 pixels")
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  it("a bake whose frame or frame count is past the limit is refused", () => {
    const game = folder()
    writeFileSync(join(game, "huge.bake.json"), JSON.stringify({ parts: [{ shape: "sphere", material: "#ef7d57", from: [-5000, -5000, 0], to: [5000, 5000, 10000] }] }))
    const huge = run(game, "pixel", "bake", "huge.bake.json")
    expect(huge.status).toBe(2)
    expect(huge.stderr).toContain("a bake draws frames of at most 1024 on a side")
    writeFileSync(join(game, "many.bake.json"), JSON.stringify({ headings: 64, animations: { spin: { frames: 64 } }, parts: [{ shape: "cylinder", material: "#ef7d57", from: [0, 0, 0], to: [0, 0, 8], sides: 2000 }] }))
    const many = run(game, "pixel", "bake", "many.bake.json")
    expect(many.status).toBe(2)
    expect(many.stdout).toContain("draws 4096 frames")
    expect(many.stdout).toContain("must be a whole number from 3 to 256")
  })

  it("an fx draft whose draw never returns is stopped, in check, render, and look", () => {
    const game = folder()
    cpSync(example("fx"), game, { recursive: true })
    const bank = JSON.parse(readFileSync(join(game, "effects.fx.json"), "utf8")) as { effects: Record<string, unknown> }
    const name = Object.keys(bank.effects)[0]!
    writeFileSync(join(game, "stuck.js"), "export default { size: [8, 8], frames: 4, fps: 12, draw(fx) { if (fx.frame === 2) while (true) {} } }")
    writeFileSync(join(game, "stuck.fx.json"), JSON.stringify({ ...bank, effects: { [name]: { drafts: { a: { file: "stuck.js" } } } } }))
    const checked = run(game, "fx", "check", "stuck.fx.json")
    expect(checked.status).toBe(3)
    expect(checked.stdout).toContain("draw did not return within 5 s on frame 2")
    const looked = run(game, "fx", "look", "stuck.fx.json", name, "-o", join(game, "look"))
    expect(looked.status).toBe(3)
    expect(looked.stdout).toContain("draw did not return within 5 s on frame 2")
    const rendered = run(game, "fx", "render", "stuck.fx.json", "-o", join(game, "out"))
    expect(rendered.status).not.toBe(0)
    expect(rendered.stderr).toContain("draw did not return within 5 s on frame 2")
  })
})

describe("number flags out of range", { timeout: 60_000 }, () => {
  it("are refused with the flag, the value, and the range, and nothing is written", () => {
    const game = folder()
    writeFileSync(join(game, "gradient.png"), picture())
    copyFileSync(example("spirit-call.sounds.json"), join(game, "game.sounds.json"))
    const refused = (args: ReadonlyArray<string>, said: string): void => {
      const result = run(game, ...args)
      expect(result.status, args.join(" ")).toBe(2)
      expect(result.stdout + result.stderr, args.join(" ")).toContain(said)
    }
    refused(["pixel", "fix", "gradient.png", "--cleanup", "-5"], 'Invalid value for flag --cleanup: "-5". Expected: a whole number from 0 to 64')
    refused(["pixel", "fix", "gradient.png", "--shrink-to", "0"], 'Invalid value for flag --shrink-to: "0". Expected: a whole number from 1 to 16384')
    expect(existsSync(join(game, "gradient.fixed.png"))).toBe(false)
    refused(["sound", "vary", "game.sounds.json", "hit", "--count", "99"], 'Invalid value for flag --count: "99". Expected: a whole number from 1 to 12')
    refused(["sound", "vary", "game.sounds.json", "hit", "--count", "0"], "--count")
    refused(["sound", "render", "game.sounds.json", "hit", "--sequence", "-1"], 'Expected: a number from 0 to 10')
    refused(["sound", "render", "game.sounds.json", "hit", "--sequence", "1e9"], 'Expected: a number from 0 to 10')
    refused(["pixel", "sheet", "gradient.png", "--boxes", "0,0,99999,99999"], "--boxes: box 1 (0,0,99999,99999) is not inside the picture, which is 8×8")
    refused(["fx", "look", example("fx/effects.fx.json"), "x", "--scale", "0"], "--scale")
    refused(["music", "listen", "theme.song.json", "hum.wav", "--tempo", "1000"], "a number from 30 to 300")
  })
})

describe("an unexpected throw", { timeout: 60_000 }, () => {
  it("is said in one line with the command, with no stack, and exits 1", () => {
    const game = folder()
    cpSync(example("fx"), game, { recursive: true })
    const bank = JSON.parse(readFileSync(join(game, "effects.fx.json"), "utf8")) as { effects: Record<string, unknown> }
    writeFileSync(join(game, "odd.js"), 'export default { get size() { throw new Error("boom") }, frames: 2, fps: 8, draw() {} }')
    writeFileSync(join(game, "odd.fx.json"), JSON.stringify({ ...bank, effects: { odd: { drafts: { a: { file: "odd.js" } } } } }))
    const checked = run(game, "fx", "check", "odd.fx.json")
    expect(checked.status).toBe(1)
    expect(checked.stderr.trim()).toBe("ritmo-tools: fx check failed: boom")
    expect(JSON.parse(checked.stdout)).toMatchObject({ error: "fx check failed: boom" })
  })
})
