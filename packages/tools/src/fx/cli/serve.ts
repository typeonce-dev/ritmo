/**
 * The effects review page on localhost, and a small API beside it that reads
 * and writes the bank and its review, and hands the page each draft's module
 * source, so what the person picks, tunes, and notes lands in the files the
 * agent reads. The page checks the files' versions (the drafts' too) every
 * moment, so a draft the agent edits while the page is open plays anew.
 *
 * The published package serves the page as built (`dist/fx/page`, made by
 * `prepack`); inside the repository, where it is not built, Vite serves it
 * from its source (`src/fx/ui`).
 */
import { existsSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { networkInterfaces } from "node:os"
import { basename, dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeBank, decodeReview, encodeBank, encodeReview, reviewPath } from "../core/bank.ts"
import type { PageRules } from "../ui/store.ts"

export interface ServeOptions {
  readonly bank: string
  readonly rules: PageRules
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

const body = (request: IncomingMessage): Promise<string> =>
  new Promise((done, fail) => {
    let text = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => (text += chunk))
    request.on("end", () => done(text))
    request.on("error", fail)
  })

const send = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status
  response.setHeader("content-type", "application/json")
  response.setHeader("cache-control", "no-store")
  response.end(JSON.stringify(value))
}

/** The draft files a bank names, from its folder (none when it does not read). */
const draftFiles = async (bank: string): Promise<ReadonlyArray<string>> => {
  const decoded = decodeBank(await readFile(bank, "utf8").catch(() => ""))
  if (!decoded.ok) return []
  return [...new Set(Object.values(decoded.value.effects).flatMap((entry) => Object.values(entry.drafts).map((draft) => draft.file)))]
}

const api = (bank: string, rules: PageRules) => {
  const review = reviewPath(bank)
  const folder = dirname(bank)
  const version = async (): Promise<string> => {
    const drafts = await Promise.all((await draftFiles(bank)).map((file) => mtime(resolve(folder, file))))
    return [await mtime(bank), await mtime(review), ...drafts].join(":")
  }
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const route = `${request.method ?? "GET"} ${(request.url ?? "/").split("?")[0]}`
      if (route === "GET /version") return send(response, 200, { version: await version() })
      if (route === "GET /session") {
        const reviewText = await readFile(review, "utf8").catch(() => null)
        const sources: Record<string, string | null> = {}
        for (const file of await draftFiles(bank)) sources[file] = await readFile(resolve(folder, file), "utf8").catch(() => null)
        return send(response, 200, { bank, name: basename(bank), bankText: await readFile(bank, "utf8"), reviewText, sources, rules, version: await version() })
      }
      if (route === "PUT /bank") {
        const decoded = decodeBank(await body(request))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(bank, encodeBank(decoded.value))
        return send(response, 200, { version: await version() })
      }
      if (route === "PUT /review") {
        const decoded = decodeReview(await body(request))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(review, encodeReview(decoded.value))
        return send(response, 200, { version: await version() })
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

/** Serves the built page's files, and the API under /api. */
const serveBuilt = (options: ServeOptions, handler: ReturnType<typeof api>): Promise<{ readonly url: string; readonly network: ReadonlyArray<string> }> => {
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
const serveSource = async (options: ServeOptions, handler: ReturnType<typeof api>): Promise<{ readonly url: string; readonly network: ReadonlyArray<string> }> => {
  const { createServer } = await import("vite")
  const server = await createServer({
    root: source,
    configFile: false,
    logLevel: "error",
    clearScreen: false,
    server: { port: options.port, host: options.host, fs: { allow: [packageRoot] } },
    plugins: [
      {
        name: "fx-lab-api",
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
export const serve = (options: ServeOptions): Promise<{ readonly url: string; readonly network: ReadonlyArray<string> }> => {
  const handler = api(options.bank, options.rules)
  return existsSync(join(built, "index.html")) ? serveBuilt(options, handler) : serveSource(options, handler)
}
