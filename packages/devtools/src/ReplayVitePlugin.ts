/**
 * A Vite plugin (Node side) that receives the replays `ReplayViteSink`
 * posts from the page and writes them into the game's repository as
 * `.replays/<time>-tick-<tick>.json`, logging the path, the tick count, and the reason.
 * Development only: it does nothing in a build.
 *
 * Add `.replays/` to the game's `.gitignore`.
 *
 * @module ReplayVitePlugin
 * @docGroup devtools
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import * as ReplayVitePlugin from "@typeonce/ritmo-devtools/ReplayVitePlugin"
 * import { defineConfig } from "vite"
 * export default defineConfig({ plugins: [ReplayVitePlugin.plugin()] })
 * ```
 */
import type { IncomingMessage, ServerResponse } from "node:http"

import * as Replay from "./Replay.ts"
import * as ReplayNodeSink from "./ReplayNodeSink.ts"
import { endpoint } from "./ReplayViteSink.ts"

/** The part of Vite's dev server the plugin uses. */
export interface DevServer {
  readonly middlewares: {
    readonly use: (path: string, handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void
  }
  readonly config: { readonly root: string; readonly logger: { readonly info: (message: string) => void } }
}

/** A Vite plugin object. */
export interface Plugin {
  readonly name: string
  readonly apply: "serve"
  readonly configureServer: (server: DevServer) => void
}

/**
 * The plugin. `directory` is relative to the Vite root and defaults to
 * `.replays`. A post that is not a replay is answered with status 400.
 */
export const plugin = (options: { readonly directory?: string } = {}): Plugin => ({
  name: "ritmo-replays",
  apply: "serve",
  configureServer: (server) => {
    const sink = ReplayNodeSink.make({ directory: `${server.config.root}/${options.directory ?? ".replays"}` })
    server.middlewares.use(endpoint, (request, response, next) => {
      if (request.method !== "POST") return next()
      let body = ""
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => {
        body += chunk
      })
      request.on("end", () => {
        let data: unknown
        try {
          data = JSON.parse(body)
        } catch {
          data = undefined
        }
        const parsed = Replay.parse(data)
        if (!parsed.ok) {
          response.statusCode = 400
          response.end(parsed.error._tag === "InvalidReplay" ? parsed.error.message : parsed.error._tag)
          return
        }
        sink.save(parsed.value)
        const path = sink.written.at(-1)!.slice(server.config.root.length + 1)
        const ticks = parsed.value.ticks.length
        server.config.logger.info(`[ritmo] replay saved: ${path} (${ticks} ticks): ${parsed.value.reason}`)
        response.statusCode = 201
        response.end(path)
      })
    })
  }
})
