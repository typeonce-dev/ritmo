import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"

/**
 * `kill` and `timeout` end a command: one stuck in synchronous work dies to
 * SIGTERM (no listener waits for an event loop that never turns), and a
 * review server, the one command that listens, stops on SIGTERM and SIGINT.
 */

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const example = (name: string): string => fileURLToPath(new URL(`../examples/${name}`, import.meta.url))
const folder = (): string => mkdtempSync(join(tmpdir(), "signals-"))

/** How the process ended, or `undefined` when it had not within `ms`. */
const ended = (child: ChildProcess, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined> =>
  new Promise((done) => {
    const timer = setTimeout(() => done(undefined), ms)
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      done({ code, signal })
    })
  })

/** Resolves once `ready()` holds, checked every 50 ms; fails past `ms`. */
const until = (ready: () => boolean, ms: number): Promise<void> =>
  new Promise((done, fail) => {
    const start = Date.now()
    const tick = setInterval(() => {
      if (ready()) {
        clearInterval(tick)
        done()
      } else if (Date.now() - start > ms) {
        clearInterval(tick)
        fail(new Error("not ready in time"))
      }
    }, 50)
  })

/** Runs the CLI, stops it with `signal` once `ready` holds, and says how it ended (SIGKILL after 15 s, so a test never leaves it running). */
const stopped = async (args: ReadonlyArray<string>, signal: NodeJS.Signals, ready: (stdout: string) => boolean) => {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
  try {
    await until(() => ready(stdout), 30_000)
    child.kill(signal)
    return await ended(child, 15_000)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
}

const port = (): string => String(20_000 + Math.floor(Math.random() * 20_000))

describe("stopping a command", { timeout: 60_000 }, () => {
  it("SIGTERM ends one stuck in synchronous work", async () => {
    const game = folder()
    cpSync(example("fx"), game, { recursive: true })
    const bank = JSON.parse(readFileSync(join(game, "effects.fx.json"), "utf8")) as { effects: Record<string, unknown> }
    const name = Object.keys(bank.effects)[0]!
    // A draft that loops as it loads: outside draw, so no time limit stops it. It says when it is spinning.
    const spinning = join(game, "spinning")
    writeFileSync(join(game, "spin.js"), `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(spinning)}, "")\nwhile (true) {}\n`)
    writeFileSync(join(game, "spin.fx.json"), JSON.stringify({ ...bank, effects: { [name]: { drafts: { a: { file: "spin.js" } } } } }))
    const result = await stopped(["fx", "check", join(game, "spin.fx.json")], "SIGTERM", () => existsSync(spinning))
    expect(result).toEqual({ code: null, signal: "SIGTERM" })
  })

  it("a review server stops on SIGTERM and SIGINT, in every tool", async () => {
    const game = folder()
    const fx = join(game, "game.fx.json")
    const sound = join(game, "game.sounds.json")
    expect(spawnSync(process.execPath, [cli, "fx", "init", fx]).status).toBe(0)
    expect(spawnSync(process.execPath, [cli, "sound", "init", sound]).status).toBe(0)
    mkdirSync(join(game, "music"))
    expect(spawnSync(process.execPath, [cli, "music", "init", join(game, "music", "theme.song.json")]).status).toBe(0)
    mkdirSync(join(game, "art"))
    writeFileSync(join(game, "art", "knight.png"), encodePng({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) }))
    const listening = (stdout: string): boolean => stdout.includes('"url"')
    const reviews = [
      ["fx", "review", fx],
      ["sound", "review", sound],
      ["music", "review", join(game, "music")],
      ["pixel", "review", join(game, "art")]
    ]
    for (const review of reviews) {
      // Interrupted, as before: its own exit (130), not killed by the signal.
      expect([review[0], await stopped([...review, "--port", port()], "SIGTERM", listening)]).toEqual([review[0], { code: 130, signal: null }])
    }
    expect(await stopped(["fx", "review", fx, "--port", port()], "SIGINT", listening)).toEqual({ code: 130, signal: null })
  })
})
