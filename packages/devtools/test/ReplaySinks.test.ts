import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Replay } from "@typeonce/ritmo-devtools"
import * as ReplayNodeSink from "@typeonce/ritmo-devtools/ReplayNodeSink"
import * as ReplayVitePlugin from "@typeonce/ritmo-devtools/ReplayVitePlugin"
import * as ReplayViteSink from "@typeonce/ritmo-devtools/ReplayViteSink"

const file: Replay.ReplayFile = {
  format: "ritmo-replay",
  version: 1,
  library: Replay.version,
  schema: "00000000",
  schedule: "update",
  reason: "invariant DeadAreGone broke at tick 3",
  savedAt: Date.UTC(2026, 9, 17, 12, 0, 0),
  constants: {},
  start: { tick: 0, snapshot: { version: 3, gameVersion: 0, nextEntity: 1, entities: [], relations: {}, resources: {}, machines: {}, nextStates: {}, scopes: {} }, pendingCommands: 0 },
  ticks: [{ tick: 1 }, { tick: 2 }, { tick: 3 }],
  checkpoints: []
}

describe("replay sinks", () => {
  it("ReplayNodeSink writes one JSON file per replay, named by time and tick", () => {
    const directory = mkdtempSync(join(tmpdir(), "replays-"))
    const sink = ReplayNodeSink.make({ directory })
    sink.save(file)
    expect(sink.written).toEqual([join(directory, "2026-10-17T12-00-00.000Z-tick-3.json")])
    expect(JSON.parse(readFileSync(sink.written[0]!, "utf8"))).toEqual(file)
  })

  it("ReplayViteSink posts to the endpoint the plugin serves, and the plugin writes and logs it", async () => {
    const root = mkdtempSync(join(tmpdir(), "game-"))
    const logged: Array<string> = []
    let handler: ((request: never, response: never, next: () => void) => void) | undefined
    const server = {
      config: { root, logger: { info: (message: string) => { logged.push(message) } } },
      middlewares: { use: (path: string, use: typeof handler) => { if (path === ReplayViteSink.endpoint) handler = use } }
    }
    ReplayVitePlugin.plugin().configureServer(server)

    const finished = new Promise<{ readonly status: number; readonly body: string }>((resolve) => {
      const sink = ReplayViteSink.make({
        fetch: async (url, init) => {
          expect(url).toBe(ReplayViteSink.endpoint)
          const request = Object.assign(new EventEmitter(), { method: init.method, setEncoding: () => {} })
          const response = { statusCode: 0, end: (body: string) => resolve({ status: response.statusCode, body }) }
          handler!(request as never, response as never, () => resolve({ status: 404, body: "" }))
          request.emit("data", init.body)
          request.emit("end")
          return undefined
        }
      })
      sink.save(file)
    })
    const { status, body } = await finished
    expect(status).toBe(201)
    expect(body).toBe(".replays/2026-10-17T12-00-00.000Z-tick-3.json")
    expect(logged).toEqual(["[ritmo] replay saved: .replays/2026-10-17T12-00-00.000Z-tick-3.json (3 ticks): invariant DeadAreGone broke at tick 3"])
    expect(JSON.parse(readFileSync(join(root, body), "utf8"))).toEqual(file)
  })
})
