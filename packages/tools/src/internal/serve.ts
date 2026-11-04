/**
 * The local server under every review page: the page itself, and the tool's
 * small API beside it under `/api`. The published package serves the page as
 * built (`dist/<tool>/page`, made by `prepack`); inside the repository, where
 * it is not built, Vite serves it from its source (`src/<tool>/ui`).
 */
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { networkInterfaces } from "node:os"
import { dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Answers a request under `/api`, with `/api` taken off its URL. */
export type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

export interface PageOptions {
  /** The folder of the tool's `serve.ts` (`import.meta.url`): `../page` is the built page, `../ui` its source. */
  readonly from: string
  /** Names the Vite plugin, for its errors. */
  readonly name: string
  readonly port: number
  readonly host: boolean
}

export interface Address {
  readonly url: string
  readonly network: ReadonlyArray<string>
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

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json"
}

/** Serves the built page's files, and the API under /api. */
const serveBuilt = (built: string, options: PageOptions, handler: Handler): Promise<Address> => {
  const server = createHttpServer((request, response) => {
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
      const network = options.host
        ? Object.values(networkInterfaces())
            .flat()
            .filter((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)
            .map((entry) => `http://${entry?.address}:${options.port}/`)
        : []
      done({ url: `http://localhost:${options.port}/`, network })
    })
  })
}

/** Serves the page from its source with Vite, inside the repository. */
const serveSource = async (source: string, options: PageOptions, handler: Handler): Promise<Address> => {
  const { createServer } = await import("vite")
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
          vite.middlewares.use("/api", (request, response) => void handler(request, response))
        }
      }
    ]
  })
  await server.listen()
  const urls = server.resolvedUrls
  return { url: urls?.local[0] ?? `http://localhost:${options.port}/`, network: urls?.network ?? [] }
}

/** Starts the page; resolves with its address once it listens. */
export const servePage = (options: PageOptions, handler: Handler): Promise<Address> => {
  const built = resolve(options.from, "../page")
  return existsSync(join(built, "index.html")) ? serveBuilt(built, options, handler) : serveSource(resolve(options.from, "../ui"), options, handler)
}
