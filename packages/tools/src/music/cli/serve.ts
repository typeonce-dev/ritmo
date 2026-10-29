/**
 * The music review page on localhost, and a small API beside it that reads
 * and writes the song, its review, and the reference audio next to it, so
 * what the person edits, records, and says lands in the files the agent
 * reads. The page checks the files' versions every moment, so a song the
 * agent rewrites while the page is open shows up in it.
 *
 * The published package serves the page as built (`dist/music/page`, made by
 * `prepack`); inside the repository, where it is not built, Vite serves it
 * from its source (`src/music/ui`).
 */
import { existsSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { networkInterfaces } from "node:os"
import { basename, dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeReview, encodeReview, reviewPath } from "../core/review.ts"
import { decodeSong, encodeSong } from "../core/song.ts"

export interface ServeOptions {
  readonly song: string
  readonly port: number
  readonly host: boolean
}

const here = dirname(fileURLToPath(import.meta.url))
const built = resolve(here, "../page")
const source = resolve(here, "../ui")
const packageRoot = resolve(here, "../../..")

const mtime = async (file: string): Promise<number> => {
  try {
    return (await stat(file)).mtimeMs
  } catch {
    return 0
  }
}

const body = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((done, fail) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => done(Buffer.concat(chunks)))
    request.on("error", fail)
  })

const send = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status
  response.setHeader("content-type", "application/json")
  response.setHeader("cache-control", "no-store")
  response.end(JSON.stringify(value))
}

/** Audio files live next to the song, by a plain name: nothing outside its folder is read or written. */
const audioName = (name: string): string | undefined => (/^[\w.-]+\.wav$/.test(name) && !name.startsWith(".") ? name : undefined)

const api = (song: string) => {
  const review = reviewPath(song)
  const folder = dirname(song)
  const version = async (): Promise<string> => `${await mtime(song)}:${await mtime(review)}`
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/")
      const route = `${request.method ?? "GET"} ${path}`
      if (route === "GET /version") return send(response, 200, { version: await version() })
      if (route === "GET /session") {
        const reviewText = await readFile(review, "utf8").catch(() => null)
        return send(response, 200, { song, name: basename(song), songText: await readFile(song, "utf8"), reviewText, version: await version() })
      }
      if (route === "PUT /song") {
        const decoded = decodeSong((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(song, encodeSong(decoded.value))
        return send(response, 200, { version: await version() })
      }
      if (route === "PUT /review") {
        const decoded = decodeReview((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(review, encodeReview(decoded.value))
        return send(response, 200, { version: await version() })
      }
      if (path.startsWith("/audio/")) {
        const name = audioName(path.slice("/audio/".length))
        if (name === undefined) return send(response, 400, { error: "audio files are plain names ending in .wav" })
        const file = join(folder, name)
        if (request.method === "PUT") {
          await writeFile(file, await body(request))
          return send(response, 200, { audio: name })
        }
        const bytes = await readFile(file).catch(() => null)
        if (bytes === null) return send(response, 404, { error: `no ${name} next to the song` })
        response.setHeader("content-type", "audio/wav")
        response.setHeader("cache-control", "no-store")
        response.end(bytes)
        return
      }
      return send(response, 404, { error: `no ${route}` })
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json"
}

type Address = { readonly url: string; readonly network: ReadonlyArray<string> }

/** Serves the built page's files, and the API under /api. */
const serveBuilt = (options: ServeOptions, handler: ReturnType<typeof api>): Promise<Address> => {
  const server = createHttpServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/"
    if (path.startsWith("/api/")) {
      request.url = path.slice("/api".length)
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
const serveSource = async (options: ServeOptions, handler: ReturnType<typeof api>): Promise<Address> => {
  const { createServer } = await import("vite")
  const server = await createServer({
    root: source,
    configFile: false,
    logLevel: "error",
    clearScreen: false,
    server: { port: options.port, host: options.host, fs: { allow: [packageRoot] } },
    plugins: [
      {
        name: "music-lab-api",
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
export const serve = (options: ServeOptions): Promise<Address> => {
  const handler = api(options.song)
  return existsSync(join(built, "index.html")) ? serveBuilt(options, handler) : serveSource(options, handler)
}
