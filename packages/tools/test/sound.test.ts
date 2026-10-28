import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { checkBank, issuesOf, measure } from "@typeonce/ritmo-tools/sound/core/measure.ts"
import { applyTune, decodeBank, decodeRecipe, encodeBank, encodeRecipe, type Bank, type Recipe } from "@typeonce/ritmo-tools/sound/core/recipe.ts"
import { render, renderSequence, SAMPLE_RATE } from "@typeonce/ritmo-tools/sound/core/render.ts"
import { decodeReview, encodeReview, reviewPath, reviewSummary, type Review } from "@typeonce/ritmo-tools/sound/core/review.ts"
import { makeTakes } from "@typeonce/ritmo-tools/sound/core/takes.ts"
import { toWav } from "@typeonce/ritmo-tools/sound/core/wav.ts"

const hit: Recipe = {
  about: "A blow lands.",
  reverb: 0.12,
  layers: [
    { type: "click", delay: 0, gain: 0.45 },
    { type: "tone", wave: "sine", from: 160, to: 55, duration: 0.12, attack: 0.002, delay: 0, gain: 0.65 },
    { type: "crunch", from: 1500, to: 500, duration: 0.07, delay: 0, gain: 0.3 }
  ]
}

const example = fileURLToPath(new URL("../examples/spirit-call.sounds.json", import.meta.url))
const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

describe("recipes", () => {
  it("round-trip through their JSON", () => {
    const decoded = decodeRecipe(encodeRecipe(hit))
    expect(decoded).toEqual({ ok: true, value: hit })
  })

  it("name every problem, with where it is", () => {
    const decoded = decodeRecipe(JSON.stringify({ reverb: 2, layers: [{ type: "tone", wave: "buzz", from: 100 }, { type: "laser" }] }))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.error).toContain("reverb")
    expect(decoded.error).toContain("layers[0]")
    expect(decoded.error).toContain("layers[1]")
  })

  it("keep a bank's sounds and master volume", () => {
    const bank: Bank = { master: 0.6, sounds: { hit } }
    expect(decodeBank(encodeBank(bank))).toEqual({ ok: true, value: bank })
  })

  it("fold a tune into the layers", () => {
    const tuned = applyTune({ ...hit, tune: { pitch: 12, length: 2, brightness: 0, echo: 0.1, volume: 0 } })
    const tone = tuned.layers[1]
    expect(tone?.type === "tone" && tone.from).toBeCloseTo(320)
    expect(tone?.type === "tone" && tone.duration).toBeCloseTo(0.24)
    expect(tuned.reverb).toBeCloseTo(0.22)
    expect(tuned.tune).toBeUndefined()
  })
})

describe("rendering", () => {
  it("is the same every time", () => {
    expect(render(hit).samples).toEqual(render(hit).samples)
  })

  it("lasts the layers and the room's tail, trimmed where it falls silent", () => {
    const dry = render({ ...hit, reverb: 0 })
    expect(dry.samples.length / SAMPLE_RATE).toBeGreaterThan(0.1)
    expect(dry.samples.length / SAMPLE_RATE).toBeLessThan(0.2)
    expect(render(hit).samples.length).toBeGreaterThan(dry.samples.length)
  })

  it("plays a sequence at its offsets", () => {
    // Each part gets its own seed, so its noise differs from the one before.
    const second = render(hit, { seed: 2 })
    const two = renderSequence([
      { recipe: hit, at: 0 },
      { recipe: hit, at: 0.5 }
    ])
    expect(two.samples.length).toBe(Math.round(0.5 * SAMPLE_RATE) + second.samples.length)
  })
})

describe("measures", () => {
  it("read a known signal", () => {
    const samples = new Float32Array(SAMPLE_RATE / 2)
    for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE)
    const measures = measure({ sampleRate: SAMPLE_RATE, samples })
    expect(measures.peak).toBeCloseTo(-6, 0)
    expect(measures.loudness).toBeCloseTo(-9, 0)
    expect(measures.brightness).toBeGreaterThan(900)
    expect(measures.brightness).toBeLessThan(1100)
    // It stops at full level: a click.
    expect(issuesOf(hit, measures, undefined).map((issue) => issue.rule)).toContain("end-click")
  })

  it("find clipping and empty sounds", () => {
    const loud: Recipe = { ...hit, layers: hit.layers.map((layer) => ({ ...layer, gain: layer.gain * 6 })) }
    const report = checkBank({ sounds: { loud, empty: { reverb: 0, layers: [] } } })
    expect(report.verdict).toBe("errors")
    expect(report.sounds.find((sound) => sound.name === "loud")?.issues.map((issue) => issue.rule)).toContain("clipping")
    expect(report.sounds.find((sound) => sound.name === "empty")?.issues.map((issue) => issue.rule)).toContain("empty")
  })
})

describe("takes", () => {
  it("are the same for a seed, and differ between seeds", () => {
    expect(makeTakes(hit, "heavier", 3, 1)).toEqual(makeTakes(hit, "heavier", 3, 1))
    expect(makeTakes(hit, "heavier", 3, 1)).not.toEqual(makeTakes(hit, "heavier", 3, 2))
  })

  it("move the way they were asked", () => {
    const base = measure(render(hit))
    const heavier = makeTakes(hit, "heavier", 4, 1).map((take) => measure(render(take.recipe)))
    const lighter = makeTakes(hit, "lighter", 4, 1).map((take) => measure(render(take.recipe)))
    const average = (values: ReadonlyArray<number>): number => values.reduce((sum, value) => sum + value, 0) / values.length
    expect(average(heavier.map((take) => take.brightness))).toBeLessThan(base.brightness)
    expect(average(lighter.map((take) => take.brightness))).toBeGreaterThan(base.brightness)
  })
})

describe("reviews", () => {
  it("round-trip with their takes", () => {
    const review: Review = { sounds: { hit: { status: "changes", note: "More crunch.", takes: makeTakes(hit, "punchier", 2), toward: "punchier", picked: undefined } } }
    expect(decodeReview(encodeReview(review))).toEqual({ ok: true, value: review })
  })

  it("live next to the bank", () => {
    expect(reviewPath("sfx/game.sounds.json")).toBe("sfx/game.sounds.review.json")
  })

  it("sum up what is left to do", () => {
    const summary = reviewSummary(["hit", "swing"], { sounds: { hit: { status: "approved", note: "", takes: [] } } })
    expect(summary.summary).toBe("1 approved, 0 with changes asked, 1 not reviewed yet (of 2).")
  })
})

describe("WAV files", () => {
  it("have a RIFF header and one 16-bit sample per sample", () => {
    const sound = render(hit)
    const bytes = toWav(sound)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF")
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE")
    expect(bytes.length).toBe(44 + sound.samples.length * 2)
  })
})

describe("the CLI", () => {
  const run = (...args: Array<string>) => spawnSync(process.execPath, [cli, "sound", ...args], { encoding: "utf8" })

  it("checks a bank and exits 3 on errors", () => {
    const result = run("check", example)
    expect(result.status).toBe(3)
    const report: unknown = JSON.parse(result.stdout)
    expect(report).toMatchObject({ verdict: "errors" })
  })

  it("writes takes to the review, and reads notes back", () => {
    const folder = mkdtempSync(join(tmpdir(), "sound-"))
    const bank = join(folder, "game.sounds.json")
    copyFileSync(example, bank)
    expect(run("vary", bank, "hit", "--toward", "heavier", "--count", "3").status).toBe(0)
    const review = decodeReview(readFileSync(reviewPath(bank), "utf8"))
    expect(review.ok && review.value.sounds.hit?.takes.length).toBe(3)
    const notes = run("notes", bank)
    expect(notes.status).toBe(0)
    expect(notes.stdout).toContain("not reviewed yet")
  })

  it("exits 2 on a sound the bank does not have", () => {
    expect(run("check", example, "nothing").status).toBe(2)
  })
}, 60_000)
