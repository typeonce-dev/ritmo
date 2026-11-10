import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { mergeJson, textVersion } from "@typeonce/ritmo-tools/internal/save.ts"
import { servePage, type Handler } from "@typeonce/ritmo-tools/internal/serve.ts"
import { decodeBank as decodeFxBank, encodeBank as encodeFxBank } from "@typeonce/ritmo-tools/fx/core/bank.ts"
import { api as fxApi } from "@typeonce/ritmo-tools/fx/cli/serve.ts"
import { api as musicApi } from "@typeonce/ritmo-tools/music/cli/serve.ts"
import { decodeSong } from "@typeonce/ritmo-tools/music/core/song.ts"
import { api as soundApi } from "@typeonce/ritmo-tools/sound/cli/serve.ts"
import { decodeReview as decodeSoundReview, encodeReview as encodeSoundReview, reviewPath as soundReviewPath } from "@typeonce/ritmo-tools/sound/core/review.ts"

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const fxExample = fileURLToPath(new URL("../examples/fx", import.meta.url))
const soundExample = fileURLToPath(new URL("../examples/spirit-call.sounds.json", import.meta.url))

const run = (...args: Array<string>) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" })

const withApi = async (handler: Handler, use: (url: string) => Promise<void>): Promise<void> => {
  const server: Server = createHttpServer((request, response) => void handler(request, response))
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  try {
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    server.close()
  }
}

const put = (url: string, body: string): Promise<Response> => fetch(url, { method: "PUT", body })

/** A request with any `Host`, which `fetch` does not let a test set. */
const get = (port: number, path: string, host: string): Promise<{ readonly status: number; readonly body: string }> =>
  new Promise((done, fail) => {
    const sent = httpRequest({ host: "localhost", port, path, headers: { host } }, (response) => {
      let body = ""
      response.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")))
      response.on("end", () => done({ status: response.statusCode ?? 0, body }))
    })
    sent.on("error", fail)
    sent.end()
  })

const freePort = (): Promise<number> =>
  new Promise((done) => {
    const server = createHttpServer()
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => done(port))
    })
  })

/** The fx example bank in a folder of its own, with a file outside it. */
const fxGame = (): { readonly folder: string; readonly bank: string; readonly secret: string } => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fx-serve-")))
  const folder = join(root, "game")
  cpSync(fxExample, folder, { recursive: true })
  const secret = join(root, "secret.txt")
  writeFileSync(secret, "the person's private notes")
  return { folder, bank: join(folder, "effects.fx.json"), secret }
}

describe("fx review's server", () => {
  const rules = {}

  it("refuses a bank that names a file outside its folder, as the CLI does", { timeout: 60_000 }, async () => {
    const { folder, bank } = fxGame()
    const decoded = decodeFxBank(readFileSync(bank, "utf8"))
    if (!decoded.ok) throw new Error(decoded.error)
    const [name, entry] = Object.entries(decoded.value.effects)[0]!
    for (const file of ["/etc/passwd", "../../../../etc/hosts", "drafts/../../secret.txt", "C:\\secret.txt"]) {
      const draft = { ...decoded.value, effects: { ...decoded.value.effects, [name]: { ...entry, drafts: { ...entry.drafts, z: { file } } } } }
      const standIn = { ...decoded.value, standIn: { file, anchor: [0, 0] as const } }
      for (const bad of [draft, standIn]) {
        const read = decodeFxBank(JSON.stringify(bad))
        expect(read.ok, file).toBe(false)
        expect(!read.ok && read.error).toContain('no ".."')
      }
      writeFileSync(join(folder, "bad.fx.json"), JSON.stringify(draft))
      const checked = run("fx", "check", join(folder, "bad.fx.json"))
      expect(checked.status).toBe(2)
      expect(checked.stdout).toContain("inside the bank's folder")
    }
    await withApi(fxApi(bank, rules), async (url) => {
      const { bankText } = (await (await fetch(`${url}/session`)).json()) as { bankText: string }
      const bad = { ...JSON.parse(bankText), standIn: { file: "/etc/passwd", anchor: [0, 0] } }
      const saved = await put(`${url}/bank?base=${textVersion(bankText)}`, JSON.stringify(bad))
      expect(saved.status).toBe(400)
      expect(readFileSync(bank, "utf8")).toBe(bankText)
    })
  })

  it("reads no draft or stand-in that a link leads out of the bank's folder", async () => {
    const { folder, bank, secret } = fxGame()
    symlinkSync(secret, join(folder, "drafts", "linked.js"))
    symlinkSync(secret, join(folder, "linked.png"))
    const decoded = decodeFxBank(readFileSync(bank, "utf8"))
    if (!decoded.ok) throw new Error(decoded.error)
    const [name, entry] = Object.entries(decoded.value.effects)[0]!
    writeFileSync(bank, encodeFxBank({ ...decoded.value, standIn: { file: "linked.png", anchor: [0, 0] }, effects: { ...decoded.value.effects, [name]: { ...entry, drafts: { ...entry.drafts, z: { file: "drafts/linked.js" } } } } }))
    await withApi(fxApi(bank, rules), async (url) => {
      const session = (await (await fetch(`${url}/session`)).json()) as { sources: Record<string, string | null>; standIn: string | null }
      expect(session.sources["drafts/linked.js"]).toBeNull()
      expect(session.standIn).toBeNull()
      expect(JSON.stringify(session)).not.toContain(Buffer.from("the person's private notes").toString("base64"))
      expect(JSON.stringify(session)).not.toContain("private notes")
      // A draft inside the folder still reads.
      expect(Object.values(session.sources).filter((source) => source !== null).length).toBeGreaterThan(0)
    })
  })

  it("writes the bank and the review only on the version the page read, and says what they hold now when it is not", async () => {
    const { bank } = fxGame()
    await withApi(fxApi(bank, rules), async (url) => {
      const { bankText } = (await (await fetch(`${url}/session`)).json()) as { bankText: string }
      const decoded = decodeFxBank(bankText)
      if (!decoded.ok) throw new Error(decoded.error)
      const name = Object.keys(decoded.value.effects)[0]!
      const page = encodeFxBank({ ...decoded.value, effects: { ...decoded.value.effects, [name]: { ...decoded.value.effects[name]!, about: "the page's" } } })
      // The agent writes the bank after the page read it.
      const agent = encodeFxBank({ ...decoded.value, backdrops: { night: "#000000" } })
      writeFileSync(bank, agent)
      const stale = await put(`${url}/bank?base=${textVersion(bankText)}`, page)
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ text: agent, version: textVersion(agent) })
      expect(readFileSync(bank, "utf8")).toBe(agent)
      expect((await put(`${url}/bank`, page)).status).toBe(409)
      const saved = await put(`${url}/bank?base=${textVersion(agent)}`, page)
      expect(saved.status).toBe(200)
      expect(((await saved.json()) as { base: string }).base).toBe(textVersion(readFileSync(bank, "utf8")))
      // No review yet: its version is that of no file.
      const review = '{"version": 1, "effects": {}}'
      expect((await put(`${url}/review?base=${textVersion("{}")}`, review)).status).toBe(409)
      expect((await put(`${url}/review?base=${textVersion(null)}`, review)).status).toBe(200)
    })
  })
})

describe("sound review's server", () => {
  it("keeps the takes the agent made after the page read the review", { timeout: 30_000 }, async () => {
    const folder = mkdtempSync(join(tmpdir(), "sound-serve-"))
    const bank = join(folder, "game.sounds.json")
    copyFileSync(soundExample, bank)
    await withApi(soundApi(bank), async (url) => {
      const { reviewText } = (await (await fetch(`${url}/session`)).json()) as { reviewText: string | null }
      expect(run("sound", "vary", bank, "slash", "--toward", "heavier", "--count", "2").status).toBe(0)
      const agent = readFileSync(soundReviewPath(bank), "utf8")
      // The page read before the takes, and writes the person's note.
      const stale = await put(`${url}/review?base=${textVersion(reviewText)}`, encodeSoundReview({ sounds: { hit: { status: "changes", note: "too quiet", takes: [] } } }))
      expect(stale.status).toBe(409)
      expect(((await stale.json()) as { text: string }).text).toBe(agent)
      const review = decodeSoundReview(readFileSync(soundReviewPath(bank), "utf8"))
      expect(review.ok && review.value.sounds.slash?.takes.length).toBe(2)
      const notes = JSON.parse(run("sound", "notes", bank).stdout) as { sounds: ReadonlyArray<{ name: string; takes: number }> }
      expect(notes.sounds.find((sound) => sound.name === "slash")?.takes).toBe(2)
    })
  })

  it("writes the bank on the version the page read", async () => {
    const folder = mkdtempSync(join(tmpdir(), "sound-serve-"))
    const bank = join(folder, "game.sounds.json")
    copyFileSync(soundExample, bank)
    await withApi(soundApi(bank), async (url) => {
      const { bankText } = (await (await fetch(`${url}/session`)).json()) as { bankText: string }
      const saved = await put(`${url}/bank?base=${textVersion(bankText)}`, bankText)
      expect(saved.status).toBe(200)
      const { base } = (await saved.json()) as { base: string }
      expect(base).toBe(textVersion(readFileSync(bank, "utf8")))
      expect((await put(`${url}/bank?base=${base}`, bankText)).status).toBe(200)
      expect((await put(`${url}/bank?base=${textVersion(bankText + " ")}`, bankText)).status).toBe(409)
    })
  })
})

describe("music review's server", () => {
  const setup = (): { readonly folder: string; readonly song: string; readonly id: string } => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "music-serve-")))
    const song = join(folder, "theme.song.json")
    expect(run("music", "init", song).status).toBe(0)
    return { folder, song, id: encodeURIComponent(relative(process.cwd(), song)) }
  }

  it("does not put back a song the agent rewrote after the page read it", { timeout: 30_000 }, async () => {
    const { song, id } = setup()
    await withApi(musicApi([song]), async (url) => {
      const { songText } = (await (await fetch(`${url}/session?id=${id}`)).json()) as { songText: string }
      const read = decodeSong(songText)
      if (!read.ok) throw new Error(read.error)
      const agent = JSON.stringify({ ...JSON.parse(songText), tempo: 140 }, null, 2)
      writeFileSync(song, agent)
      const stale = await put(`${url}/song?id=${id}&base=${textVersion(songText)}`, songText)
      expect(stale.status).toBe(409)
      const now = decodeSong(readFileSync(song, "utf8"))
      expect(now.ok && now.value.tempo).toBe(140)
      const review = '{"version": 1, "status": "changes", "note": "slower"}'
      expect((await put(`${url}/review?id=${id}&base=${textVersion("{}")}`, review)).status).toBe(409)
      expect((await put(`${url}/review?id=${id}&base=${textVersion(null)}`, review)).status).toBe(200)
    })
  })

  it("writes only the song's own hum, and only a WAV", { timeout: 30_000 }, async () => {
    const { folder, song, id } = setup()
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")])
    await withApi(musicApi([song]), async (url) => {
      expect((await fetch(`${url}/audio/theme.song.reference.wav?id=${id}`, { method: "PUT", body: wav })).status).toBe(200)
      expect(readFileSync(join(folder, "theme.song.reference.wav"))).toEqual(wav)
      for (const name of ["boss.wav", "theme.song.wav", "other.song.reference.wav"]) {
        expect((await fetch(`${url}/audio/${name}?id=${id}`, { method: "PUT", body: wav })).status, name).toBe(400)
        expect(existsSync(join(folder, name)), name).toBe(false)
      }
      expect((await fetch(`${url}/audio/theme.song.reference.wav?id=${id}`, { method: "PUT", body: "not a wav" })).status).toBe(400)
    })
  })
})

describe("the review page's server", () => {
  /** A tool's folder with its page built (`page/index.html`), or only its source (`ui/index.html`), as inside the repository. */
  const tool = (built: boolean): string => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "page-")))
    mkdirSync(join(folder, built ? "page" : "ui"))
    mkdirSync(join(folder, "cli"))
    writeFileSync(join(folder, built ? "page" : "ui", "index.html"), "<!doctype html><title>page</title>")
    writeFileSync(join(folder, "secret.txt"), "not the page")
    return join(folder, "cli")
  }
  const handler: Handler = async (_, response) => {
    response.setHeader("content-type", "application/json")
    response.end('{"version": "1"}')
  }

  for (const built of [true, false]) {
    it(`answers only requests made to this machine by its own name, ${built ? "built" : "from its source with Vite"}`, { timeout: 30_000 }, async () => {
      const port = await freePort()
      const address = await servePage({ from: tool(built), name: "test-api", port, host: false }, handler)
      try {
        for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
          expect((await get(port, "/api/version", host)).status, host).toBe(200)
          expect((await get(port, "/", host)).status, host).toBe(200)
        }
        for (const host of ["evil.example", `evil.example:${port}`, "localhost", `localhost:${port + 1}`, `127.0.0.1.evil.example:${port}`]) {
          expect((await get(port, "/api/version", host)).status, host).toBe(403)
          expect((await get(port, "/", host)).status, host).toBe(403)
        }
        for (const path of ["/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt"]) expect((await get(port, path, `localhost:${port}`)).body, path).not.toContain("not the page")
      } finally {
        await address.close()
      }
    })
  }
})

describe("merging a page's change into the agent's", () => {
  it("keeps what each side changed, and the person's where both changed one field", () => {
    const base = { sounds: { hit: { status: "new", note: "" }, swing: { status: "new", takes: [1] } } }
    const mine = { sounds: { hit: { status: "changes", note: "too quiet" }, swing: { status: "new", takes: [1] } } }
    const theirs = { sounds: { hit: { status: "new", note: "" }, swing: { status: "new", takes: [1, 2, 3] }, roar: { status: "new" } } }
    expect(mergeJson(base, mine, theirs)).toEqual({ sounds: { hit: { status: "changes", note: "too quiet" }, swing: { status: "new", takes: [1, 2, 3] }, roar: { status: "new" } } })
    expect(mergeJson({ a: 1, b: 2 }, { a: 1 }, { a: 3, b: 2 })).toEqual({ a: 3 })
    expect(mergeJson({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 2 })
  })
})
