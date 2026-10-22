import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import { Lint } from "@typeonce/ritmo-devtools"

const hostClock = HostClock.test()

const Ping = Descriptor.Event<number>()("LintTest/Ping")
const Score = Descriptor.Component<number>()("LintTest/Score")
const Game = Schema.bind(Schema.fragment({ components: { Score }, events: { Ping } }))
const Emit = Game.System("LintTest/Emit", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
  events.ping.emit(1)
})
const Read = Game.System("LintTest/Read", { events: { ping: Game.System.readEvent(Ping) } }, () => {})
const Count = Game.System("LintTest/Count", {
  queries: { scores: Game.Query({ selection: { score: Game.Query.write(Score) } }) }
}, ({ queries }) => {
  for (const { data } of queries.scores.each()) data.score.update((score) => score + 1)
})
const runtime = () => Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock } }).success

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const entry = fileURLToPath(new URL("./fixtures/lint-entry.ts", import.meta.url))
const runCli = (env: Record<string, string>): { readonly status: number; readonly output: string } => {
  try {
    return { status: 0, output: execFileSync(process.execPath, [cli, "lint", entry], { encoding: "utf8", env: { ...process.env, ...env } }) }
  } catch (error) {
    const failed = error instanceof Error && "status" in error && "stdout" in error ? error : undefined
    return { status: typeof failed?.status === "number" ? failed.status : -1, output: typeof failed?.stdout === "string" ? failed.stdout : "" }
  }
}

describe("Lint.run", () => {
  it("fails on a warning and prints each lint with its fix", () => {
    const report = Lint.run({ runtime: runtime(), schedules: { update: Game.Schedule(Emit) } })
    expect(report.data.ok).toBe(false)
    expect(report.data.warnings).toBe(1)
    expect(report.text).toContain("warning event-never-read LintTest/Ping: LintTest/Ping is emitted by LintTest/Emit but no described system reads it")
    expect(report.text).toContain("  fix: read LintTest/Ping in a system with Game.System.readEvent, or stop emitting it")
  })

  it("passes with info-level lints only", () => {
    const report = Lint.run({ runtime: runtime(), schedules: { update: Game.Schedule(Emit, Read, Count) } })
    expect(report.data).toMatchObject({ ok: true, warnings: 0, infos: 1 })
    expect(report.data.lints.map((lint) => lint.code)).toEqual(["component-never-read"])
  })

  it("counts declared host events as written", () => {
    const loud = Lint.run({ runtime: runtime(), schedules: { update: Game.Schedule(Read) } })
    expect(loud.data.lints.map((lint) => lint.code)).toEqual(["event-never-written"])
    expect(loud.text).toContain("declare it (debug.declareHostEvents, or hostEvents in a Session or lint target)")
    const quiet = Lint.run({ runtime: runtime(), schedules: { update: Game.Schedule(Read) }, hostEvents: [Ping] })
    expect(quiet.data.ok).toBe(true)
  })

  it("counts describe-only schedules as readers", () => {
    const report = Lint.run({ runtime: runtime(), schedules: { update: Game.Schedule(Emit) }, describe: { render: Game.Schedule(Read) } })
    expect(report.data.ok).toBe(true)
  })
})

describe("ritmo-devtools lint", () => {
  it("exits 1 and prints the warning with its fix", () => {
    const { status, output } = runCli({})
    expect(status).toBe(1)
    expect(output).toContain("warning event-never-read LintFixture/Noise")
    expect(output).toContain("fix:")
  })

  it("exits 0 when there is no warning", () => {
    expect(runCli({ LINT_QUIET: "1" })).toMatchObject({ status: 0 })
  })
})
