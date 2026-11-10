/**
 * The effects review page on localhost, and a small API beside it that reads
 * and writes the bank and its review, and hands the page each draft's module
 * source (and the stand-in sprite), so what the person picks, tunes, and notes lands in the files the
 * agent reads. The page checks the files' versions (the drafts' too) every
 * moment, so a draft the agent edits while the page is open plays anew.
 *
 * A draft or stand-in is read only when it is inside the bank's folder,
 * links followed: the bank is a file the page writes, so a path in it is
 * never trusted to lead anywhere else. Every write carries the version the
 * page read (`internal/save.ts`).
 */
import { readFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { inside, writeWhole } from "../../internal/files.ts"
import { textVersion } from "../../internal/save.ts"
import { body, mtime, heldFile, send, servePage, writeChecked, type Address, type Handler } from "../../internal/serve.ts"
import { decodeBank, decodeReview, encodeBank, encodeReview, reviewPath } from "../core/bank.ts"
import type { PageRules } from "../ui/store.ts"

export interface ServeOptions {
  readonly bank: string
  readonly rules: PageRules
  readonly port: number
  readonly host: boolean
}

/** The draft files a bank names, as it names them, and its stand-in's (none when it does not read). */
const filesOf = async (bank: string): Promise<{ readonly drafts: ReadonlyArray<string>; readonly standIn: string | undefined }> => {
  const decoded = decodeBank(await readFile(bank, "utf8").catch(() => ""))
  if (!decoded.ok) return { drafts: [], standIn: undefined }
  return {
    drafts: [...new Set(Object.values(decoded.value.effects).flatMap((entry) => Object.values(entry.drafts).map((draft) => draft.file)))],
    standIn: decoded.value.standIn?.file
  }
}

const textOf = (file: string): Promise<string | null> => readFile(file, "utf8").catch(() => null)

/** The API over one bank and its review. */
export const api = (bank: string, rules: PageRules): Handler => {
  const review = reviewPath(bank)
  const folder = dirname(bank)
  /** A file the bank names, when it is inside the bank's folder. */
  const named = (file: string): Promise<string | undefined> => inside(folder, file)
  const version = async (): Promise<string> => {
    const files = await filesOf(bank)
    const times = await Promise.all([...files.drafts, ...(files.standIn === undefined ? [] : [files.standIn])].map(async (file) => {
      const found = await named(file)
      return found === undefined ? 0 : mtime(found)
    }))
    return [await mtime(bank), await mtime(review), ...times].join(":")
  }
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const route = `${request.method ?? "GET"} ${(request.url ?? "/").split("?")[0]}`
      if (route === "GET /version") return send(response, 200, { version: await version() })
      if (route === "GET /session") {
        const reviewText = await readFile(review, "utf8").catch(() => null)
        const files = await filesOf(bank)
        const sources: Record<string, string | null> = {}
        for (const file of files.drafts) {
          const found = await named(file)
          sources[file] = found === undefined ? null : await textOf(found)
        }
        // The stand-in as a data URL, so the page draws it as it draws everything else: from the session.
        const standInFile = files.standIn === undefined ? undefined : await named(files.standIn)
        const standIn =
          files.standIn === undefined
            ? undefined
            : standInFile === undefined
              ? null
              : await readFile(standInFile).then(
                  (bytes) => `data:image/png;base64,${bytes.toString("base64")}`,
                  () => null
                )
        return send(response, 200, { bank, name: basename(bank), bankText: await readFile(bank, "utf8"), reviewText, sources, standIn, rules, version: await version() })
      }
      if (route === "PUT /bank") {
        const decoded = decodeBank((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        const text = encodeBank(decoded.value)
        return writeChecked(request, response, heldFile(bank), async () => {
          await writeWhole(bank, text)
          return { version: await version(), base: textVersion(text) }
        })
      }
      if (route === "PUT /review") {
        const decoded = decodeReview((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        const text = encodeReview(decoded.value)
        return writeChecked(request, response, heldFile(review), async () => {
          await writeWhole(review, text)
          return { version: await version(), base: textVersion(text) }
        })
      }
      return send(response, 404, { error: `no ${route}` })
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Starts the page; resolves with its address once it listens. */
export const serve = (options: ServeOptions): Promise<Address> =>
  servePage({ from: dirname(fileURLToPath(import.meta.url)), name: "fx-lab-api", port: options.port, host: options.host }, api(options.bank, options.rules))
