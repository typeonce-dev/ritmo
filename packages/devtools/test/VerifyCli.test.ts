import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { record } from "./fixtures/replay-entry.ts"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const entry = fileURLToPath(new URL("./fixtures/replay-entry.ts", import.meta.url))
const directory = mkdtempSync(join(tmpdir(), "ritmo-verify-"))
const file = record([1, 2, 3, 0, 0, 5])

const write = (name: string, data: unknown): string => {
  const path = join(directory, name)
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data))
  return path
}
const replay = write("replay.json", file)

const verify = (args: ReadonlyArray<string>, env: Record<string, string> = {}) => {
  const run = spawnSync(process.execPath, [cli, "verify", ...args], { encoding: "utf8", env: { ...process.env, ...env } })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

describe("ritmo-devtools verify", () => {
  it("verifies a replay in Node with no other dependency", () => {
    const run = verify([entry, replay, "--engines", "node"])
    expect(run).toMatchObject({ status: 0, stderr: "" })
    expect(run.stdout).toBe("verified 6 ticks of update on node: every engine reaches the same world as node after every tick, and node matches the recording\n")
  })

  it("defaults to node, and prints JSON with --json", () => {
    const run = verify([entry, replay, "--json"])
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, schedule: "update", ticks: 6, engines: ["node"] })
  })

  it("exits with 1 and names the tick and value when a second run differs", () => {
    const run = verify([entry, replay], { VERIFY_NONDETERMINISTIC: "1" })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain("NOT verified: 6 ticks of update")
    expect(run.stdout).toContain("tick 1: node differs from a second node run in e1 VerifyFixture/Position.x")
  })

  it("exits with 1 when the replay no longer matches its recording", () => {
    const stale = write("stale.json", { ...file, checkpoints: file.checkpoints.map((checkpoint) => checkpoint.tick === 4 ? { ...checkpoint, hash: "00000000" } : checkpoint) })
    const run = verify([entry, stale, "--json"])
    expect(run.status).toBe(1)
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: false, _tag: "NotVerified", outcomes: [{ _tag: "Diverged", engine: "node", against: "recording", tick: 4 }] })
  })

  it("exits with 2 on a usage error", () => {
    expect(verify([entry]).status).toBe(2)
    expect(verify([entry, replay, "--engines", "node,opera"])).toMatchObject({ status: 2, stderr: expect.stringContaining("unknown: opera") })
    expect(verify([entry, write("broken.json", "{")])).toMatchObject({ status: 2, stderr: expect.stringContaining("could not be read as JSON") })
    expect(verify([entry, write("other.json", { format: "other" })])).toMatchObject({ status: 2, stderr: expect.stringContaining("not a ritmo replay") })
    const lintEntry = fileURLToPath(new URL("./fixtures/lint-entry.ts", import.meta.url))
    expect(verify([lintEntry, replay])).toMatchObject({ status: 2, stderr: expect.stringContaining("must export replayTarget") })
  })
})
