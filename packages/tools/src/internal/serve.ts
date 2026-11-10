/**
 * The local server under every review page: the page itself, and the tool's
 * small API beside it under `/api`. The published package serves the page as
 * built (`dist/<tool>/page`, made by `prepack`); inside the repository, where
 * it is not built, Vite serves it from its source (`src/<tool>/ui`, or the
 * folder the tool names).
 *
 * Both answer only a request made to this machine by its own name: a web
 * page the person has open elsewhere could otherwise reach the API by DNS
 * rebinding (its own name pointed at 127.0.0.1), and read or write the
 * game's files.
 */
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { networkInterfaces } from "node:os"
import { dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { STALE, textVersion } from "./save.ts"

/** Answers a request under `/api`, with `/api` taken off its URL. */
export type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

export interface PageOptions {
  /** The folder of the tool's `serve.ts` (`import.meta.url`): `../page` is the built page, `../ui` its source. */
  readonly from: string
  /** The page's source folder, from `from`, when it is not `../ui` (the pixel fixer's page has that one). */
  readonly source?: string | undefined
  /** Names the Vite plugin, for its errors. */
  readonly name: string
  readonly port: number
  readonly host: boolean
}

export interface Address {
  readonly url: string
  readonly network: ReadonlyArray<string>
  /** Stops serving; the CLI never does (it runs until stopped), tests do. */
  readonly close: () => Promise<void>
}

/** When the file last changed; 0 when it does not exist. */
export const mtime = async (file: string): Promise<number> => {
  try {
    return (await stat(file)).mtimeMs
  } catch {
    return 0
  }
}

export const body = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((done, fail) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => done(Buffer.concat(chunks)))
    request.on("error", fail)
  })

export const send = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status
  response.setHeader("content-type", "application/json")
  response.setHeader("cache-control", "no-store")
  response.end(JSON.stringify(value))
}

/** What file a page writes holds now: its text (what the page merges with) and its version (what the page's write must be based on, `textVersion`). */
export interface Held {
  readonly text: string
  readonly version: string
}

/** What a file holds now, read whole: what a page writing it is checked against. */
export const heldFile = (file: string) => async (): Promise<Held> => {
  const text = await readFile(file, "utf8").catch(() => null)
  return { text: text ?? "", version: textVersion(text) }
}

let writing: Promise<unknown> = Promise.resolve()

/**
 * A page's write, checked against what the page read (`save.ts`): the
 * request's `?base=` must be the version the file has now (`held`). When the
 * agent wrote it meanwhile, nothing is written and the answer is 409 with
 * the file's text and version now, for the page to lay its change over and
 * send again; otherwise `write` runs, and its value is the answer. Writes go
 * one at a time, so two pages cannot both pass the check.
 */
export const writeChecked = (request: IncomingMessage, response: ServerResponse, held: () => Promise<Held>, write: () => Promise<Readonly<Record<string, unknown>>>): Promise<void> => {
  const run = writing.then(async () => {
    const now = await held()
    if (new URL(request.url ?? "/", "http://localhost").searchParams.get("base") !== now.version) return send(response, 409, { error: STALE, text: now.text, version: now.version })
    return send(response, 200, await write())
  })
  writing = run.catch(() => undefined)
  return run
}

/** The `Host` a request may name: this machine by name or loopback address, or an address the server announced under `--host`; on the port it listens on. */
const hostsOf = (port: number, network: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set([...["localhost", "127.0.0.1", "[::1]"].map((name) => `${name}:${port}`), ...network.map((url) => new URL(url).host)])

/** Refuses (403) a request whose `Host` is not this machine on this port; says whether it did. */
const refused = (request: IncomingMessage, response: ServerResponse, hosts: ReadonlySet<string>): boolean => {
  if (hosts.has((request.headers.host ?? "").toLowerCase())) return false
  send(response, 403, { error: `this review page answers only at ${[...hosts].join(", ")}, not ${request.headers.host ?? "a request with no Host"}` })
  return true
}

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json"
}

/** Serves the built page's files, and the API under /api. */
const serveBuilt = (built: string, options: PageOptions, handler: Handler): Promise<Address> => {
  let hosts: ReadonlySet<string> = new Set()
  const server = createHttpServer((request, response) => {
    if (refused(request, response, hosts)) return
    const path = (request.url ?? "/").split("?")[0] ?? "/"
    if (path.startsWith("/api/")) {
      // Only the prefix goes: a route can read its query.
      request.url = (request.url ?? "/").slice("/api".length)
      void handler(request, response)
      return
    }
    const file = join(built, normalize(path === "/" ? "/index.html" : path))
    if (!file.startsWith(built)) {
      response.statusCode = 404
      response.end()
      return
    }
    readFile(file).then(
      (bytes) => {
        response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream")
        response.end(bytes)
      },
      () => {
        response.statusCode = 404
        response.end()
      }
    )
  })
  return new Promise((done, fail) => {
    server.once("error", fail)
    server.listen(options.port, options.host ? "0.0.0.0" : "localhost", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : options.port
      const network = options.host
        ? Object.values(networkInterfaces())
            .flat()
            .filter((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)
            .map((entry) => `http://${entry?.address}:${port}/`)
        : []
      hosts = hostsOf(port, network)
      done({ url: `http://localhost:${port}/`, network, close: () => new Promise((closed) => server.close(() => closed())) })
    })
  })
}

/** Serves the page from its source with Vite, inside the repository. */
const serveSource = async (source: string, options: PageOptions, handler: Handler): Promise<Address> => {
  const { createServer } = await import("vite")
  let hosts: ReadonlySet<string> = new Set()
  const server = await createServer({
    root: source,
    configFile: false,
    logLevel: "error",
    clearScreen: false,
    server: { port: options.port, host: options.host, fs: { allow: [resolve(dirname(fileURLToPath(import.meta.url)), "../..")] } },
    plugins: [
      {
        name: options.name,
        configureServer(vite) {
          // Before Vite's own middlewares: the page's files are refused as the API is.
          vite.middlewares.use((request, response, next) => {
            if (!refused(request, response, hosts)) next()
          })
          vite.middlewares.use("/api", (request, response) => void handler(request, response))
        }
      }
    ]
  })
  await server.listen()
  const address = server.httpServer?.address()
  const port = typeof address === "object" && address !== null ? address.port : options.port
  const urls = server.resolvedUrls
  hosts = hostsOf(port, urls?.network ?? [])
  return { url: urls?.local[0] ?? `http://localhost:${port}/`, network: urls?.network ?? [], close: () => server.close() }
}

/** Starts the page; resolves with its address once it listens. */
export const servePage = (options: PageOptions, handler: Handler): Promise<Address> => {
  const built = resolve(options.from, "../page")
  return existsSync(join(built, "index.html")) ? serveBuilt(built, options, handler) : serveSource(resolve(options.from, options.source ?? "../ui"), options, handler)
}

/**
 * A review command's wait once its page is served: until the process is
 * told to stop (SIGINT or SIGTERM), then the command ends as interrupted
 * (exit 130). Only a running server listens for the signals; every other
 * command keeps Node's default, so `kill` and `timeout` end it even mid
 * synchronous work (`cli.ts`).
 */
export const untilStopped: Effect.Effect<never> = Effect.callback<never>((resume) => {
  const stop = (): void => resume(Effect.interrupt)
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  return Effect.sync(() => {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  })
})
