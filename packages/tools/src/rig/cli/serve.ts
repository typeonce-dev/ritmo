/**
 * The rig review page on localhost, and a small API beside it, after the
 * effects lab's (`fx/cli/serve.ts`): it reads and writes the bank and its
 * review, so what the person picks, tunes, pins, and drags lands in the
 * files the agent reads, and it bakes each draft for the page with the same
 * runner and rasterizer as `rig bake`.
 *
 * It watches the bank's folder: a change to a clip's module rebakes that
 * clip's drafts, a change to the rig module, a picture, or any other module
 * there rebakes every draft, and a change to the bank rebakes the drafts
 * whose entry (tune, accept, seed) or pivots changed. Modules are imported
 * anew on each rebake (`registerFreshImports`); the page polls each draft's
 * stamp and swaps in the new frames without a reload.
 *
 * The published package serves the page as built (`dist/rig/page`, made by
 * `prepack`); inside the repository Vite serves it from its source.
 */
import { existsSync, watch } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { networkInterfaces } from "node:os"
import { basename, dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { encodePng } from "../../pixel/cli/png.ts"
import { decodeBank, decodeReview, encodeBank, encodeReview, reviewPath, type Bank } from "../core/bank.ts"
import type { Rig } from "../core/rig.ts"
import { draftView, pivotAt, spotAt, type DraftResult } from "../core/view.ts"
import type { Clip } from "../core/clip.ts"
import type { Session, Version } from "../ui/store.ts"
import { loadClip, loadRig, registerFreshImports } from "./io.ts"

export interface ServeOptions {
  readonly bank: string
  readonly port: number
  readonly host: boolean
}

const here = dirname(fileURLToPath(import.meta.url))
const built = resolve(here, "../page")
const source = resolve(here, "../ui")
const packageRoot = resolve(here, "../../..")

const mtime = async (file: string): Promise<string> => {
  try {
    return String((await stat(file)).mtimeMs)
  } catch {
    return "0"
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

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

/** The bank's API and watcher: one per `rig review`. */
export const reviewApi = (bankFile: string, options: { readonly scale?: number } = {}) => {
  // Frames at 2x on this machine; at 1x over the network (`--host`), a quarter of the bytes for a phone.
  const scale = options.scale ?? 2
  registerFreshImports()
  const folder = dirname(bankFile)
  const review = reviewPath(bankFile)
  /** Bumped when a module or picture of the bank changes: every draft reads its modules anew. */
  let generation = 0
  /** Bumped per clip module that changed: its drafts rebake. */
  const fileGeneration = new Map<string, number>()
  const baked = new Map<string, { readonly stamp: string; readonly result: DraftResult<string> }>()
  const baking = new Set<string>()

  const readBankNow = async (): Promise<Bank | undefined> => {
    const decoded = decodeBank(await readFile(bankFile, "utf8").catch(() => ""))
    return decoded.ok ? decoded.value : undefined
  }
  const stampOf = (bank: Bank, clip: string, id: string): string => {
    const draft = bank.clips[clip]?.drafts[id]
    return `${generation}.${fileGeneration.get(resolve(folder, draft?.file ?? "")) ?? 0}:${JSON.stringify([draft, bank.pivots])}`
  }
  const rigs = new Map<string, Promise<{ readonly ok: true; readonly rig: Rig } | { readonly ok: false; readonly error: string }>>()
  /** The rig as the bank names it now, read anew once per generation and pivots. */
  const rigOf = (bank: Bank) => {
    const key = `${generation}:${bank.rig}:${JSON.stringify(bank.pivots)}`
    let found = rigs.get(key)
    if (found === undefined) {
      rigs.clear()
      found = run(loadRig(bankFile, bank, String(generation)).pipe(Effect.provide(NodeServices.layer))).then((loaded) => (loaded.ok ? { ok: true as const, rig: loaded.rig } : { ok: false as const, error: loaded.error }))
      rigs.set(key, found)
    }
    return found
  }
  /** A draft's rig and clip as the files say now. */
  const loaded = async (clip: string, id: string): Promise<{ readonly rig: Rig; readonly clip: Clip; readonly bank: Bank } | { readonly error: string; readonly file: string } | undefined> => {
    const bank = await readBankNow()
    const draft = bank?.clips[clip]?.drafts[id]
    if (bank === undefined || draft === undefined) return undefined
    const rig = await rigOf(bank)
    if (!rig.ok) return { error: rig.error, file: bank.rig }
    const at = resolve(folder, draft.file)
    const module = await run(loadClip(bankFile, draft, rig.rig, `${generation}.${fileGeneration.get(at) ?? 0}`).pipe(Effect.provide(NodeServices.layer)))
    return module.ok ? { rig: rig.rig, clip: module.clip, bank } : { error: module.error, file: draft.file }
  }
  /** Bakes a draft for the page, its frames as PNG data URLs, unless its stamp says it already is. */
  const bake = async (clip: string, id: string): Promise<{ readonly stamp: string; readonly result: DraftResult<string> } | undefined> => {
    const bank = await readBankNow()
    if (bank === undefined || bank.clips[clip]?.drafts[id] === undefined) return undefined
    const stamp = stampOf(bank, clip, id)
    const key = `${clip}/${id}`
    const known = baked.get(key)
    if (known !== undefined && known.stamp === stamp) return known
    baking.add(key)
    try {
      const found = await loaded(clip, id)
      if (found === undefined) return undefined
      let result: DraftResult<string>
      if ("error" in found) result = { ok: false, id, file: found.file, error: found.error }
      else {
        const view = draftView(found.rig, found.clip, found.bank.clips[clip]!.drafts[id]!, id, clip, scale)
        result = view.ok ? { ok: true, view: { ...view.view, art: view.view.art.map((image) => `data:image/png;base64,${Buffer.from(encodePng(image)).toString("base64")}`) } } : view
      }
      const entry = { stamp, result }
      baked.set(key, entry)
      return entry
    } finally {
      baking.delete(key)
    }
  }
  /** Bakes the drafts whose stamps changed, one after another, so the page finds them ready. */
  let queue: Promise<unknown> = Promise.resolve()
  const rebake = async (): Promise<void> => {
    const bank = await readBankNow()
    if (bank === undefined) return
    for (const [clip, entry] of Object.entries(bank.clips))
      for (const id of Object.keys(entry.drafts)) if (baked.get(`${clip}/${id}`)?.stamp !== stampOf(bank, clip, id) && baked.has(`${clip}/${id}`)) queue = queue.then(() => bake(clip, id)).catch(() => undefined)
  }

  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const watcher = watch(folder, { recursive: true }, (_event, name) => {
    if (name === null) return
    const file = resolve(folder, name)
    if (file === review || name.includes("node_modules") || /\.(look|out)[\\/]/.test(name)) return
    // Editors write in bursts: act once things settle.
    clearTimeout(timers.get(file))
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file)
        void (async () => {
          if (file !== resolve(bankFile)) {
            if (!/\.(m?[jt]s|png)$/.test(file)) return
            const bank = await readBankNow()
            const clipFiles = new Set(Object.values(bank?.clips ?? {}).flatMap((entry) => Object.values(entry.drafts).map((draft) => resolve(folder, draft.file))))
            // A clip's own module: its drafts. The rig, a picture, or a module clips share: every draft.
            if (clipFiles.has(file)) fileGeneration.set(file, (fileGeneration.get(file) ?? 0) + 1)
            else generation += 1
          }
          await rebake()
        })()
      }, 120)
    )
  })

  const version = async (): Promise<Version> => {
    const bank = await readBankNow()
    const stamps: Record<string, string> = {}
    for (const [clip, entry] of Object.entries(bank?.clips ?? {})) for (const id of Object.keys(entry.drafts)) stamps[`${clip}/${id}`] = stampOf(bank!, clip, id)
    return { bank: await mtime(bankFile), review: await mtime(review), stamps, baking: [...baking] }
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost")
      const route = `${request.method ?? "GET"} ${url.pathname}`
      if (route === "GET /version") return send(response, 200, await version())
      if (route === "GET /session") {
        const bank = await readBankNow()
        const rig = bank === undefined ? { ok: false as const, error: "the bank does not read" } : await rigOf(bank)
        const session: Session = {
          bank: bankFile,
          name: basename(bankFile),
          bankText: await readFile(bankFile, "utf8"),
          reviewText: await readFile(review, "utf8").catch(() => null),
          rig: rig.ok ? { width: rig.rig.width, height: rig.rig.height, anchor: rig.rig.anchor, look: rig.rig.look } : { error: rig.error },
          version: await version()
        }
        return send(response, 200, session)
      }
      if (route === "GET /draft") {
        const found = await bake(url.searchParams.get("clip") ?? "", url.searchParams.get("draft") ?? "")
        return found === undefined ? send(response, 404, { error: "no such draft" }) : send(response, 200, found)
      }
      if (route === "POST /spot" || route === "POST /pivot") {
        const asked = JSON.parse(await body(request)) as { clip: string; draft: string; frame: number; x: number; y: number; part?: string }
        const found = await loaded(asked.clip, asked.draft)
        if (found === undefined || "error" in found) return send(response, 404, { error: found?.error ?? "no such draft" })
        const draft = found.bank.clips[asked.clip]!.drafts[asked.draft]!
        if (route === "POST /spot") return send(response, 200, spotAt(found.rig, found.clip, draft, asked.frame, asked.x, asked.y))
        return send(response, 200, { pivot: pivotAt(found.rig, found.clip, draft, asked.frame, asked.part ?? "", asked.x, asked.y) })
      }
      if (route === "PUT /bank") {
        const decoded = decodeBank(await body(request))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(bankFile, encodeBank(decoded.value))
        return send(response, 200, await version())
      }
      if (route === "PUT /review") {
        const decoded = decodeReview(await body(request))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(review, encodeReview(decoded.value))
        return send(response, 200, await version())
      }
      return send(response, 404, { error: `no ${route}` })
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { handle, close: () => watcher.close() }
}

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json"
}

type Address = { readonly url: string; readonly network: ReadonlyArray<string>; readonly close: () => Promise<void> }

/** Serves the built page's files, and the API under /api. */
const serveBuilt = (options: ServeOptions, api: ReturnType<typeof reviewApi>): Promise<Address> => {
  const server = createHttpServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/"
    if (path.startsWith("/api/")) {
      request.url = (request.url ?? "/").slice("/api".length)
      void api.handle(request, response)
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
      // The port it listens on: the one asked for, or a free one for port 0.
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : options.port
      const network = options.host
        ? Object.values(networkInterfaces())
            .flat()
            .filter((entry) => entry !== undefined && entry.family === "IPv4" && !entry.internal)
            .map((entry) => `http://${entry?.address}:${port}/`)
        : []
      done({ url: `http://localhost:${port}/`, network, close: () => new Promise((closed) => server.close(() => closed())) })
    })
  })
}

/** Serves the page from its source with Vite, inside the repository. */
const serveSource = async (options: ServeOptions, api: ReturnType<typeof reviewApi>): Promise<Address> => {
  const { createServer } = await import("vite")
  const server = await createServer({
    root: source,
    configFile: false,
    logLevel: "error",
    clearScreen: false,
    server: { port: options.port, host: options.host, fs: { allow: [packageRoot] } },
    plugins: [
      {
        name: "rig-lab-api",
        configureServer(vite) {
          vite.middlewares.use("/api", (request, response) => void api.handle(request, response))
        }
      }
    ]
  })
  await server.listen()
  const urls = server.resolvedUrls
  return { url: urls?.local[0] ?? `http://localhost:${options.port}/`, network: urls?.network ?? [], close: () => server.close() }
}

/** Starts the page; resolves with its address once it listens, and how to stop it. */
export const serve = async (options: ServeOptions): Promise<Address> => {
  const api = reviewApi(resolve(options.bank), { scale: options.host ? 1 : 2 })
  const address = await (existsSync(join(built, "index.html")) ? serveBuilt(options, api) : serveSource(options, api))
  return {
    ...address,
    close: async () => {
      api.close()
      await address.close()
    }
  }
}
