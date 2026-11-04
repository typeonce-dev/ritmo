/**
 * The effects review page on localhost, and a small API beside it that reads
 * and writes the bank and its review, and hands the page each draft's module
 * source (and the stand-in sprite), so what the person picks, tunes, and notes lands in the files the
 * agent reads. The page checks the files' versions (the drafts' too) every
 * moment, so a draft the agent edits while the page is open plays anew.
 */
import { readFile, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { body, mtime, send, servePage, type Address } from "../../internal/serve.ts"
import { decodeBank, decodeReview, encodeBank, encodeReview, reviewPath } from "../core/bank.ts"
import type { PageRules } from "../ui/store.ts"

export interface ServeOptions {
  readonly bank: string
  readonly rules: PageRules
  readonly port: number
  readonly host: boolean
}

/** The draft files a bank names, from its folder, and its stand-in's (none when it does not read). */
const filesOf = async (bank: string): Promise<{ readonly drafts: ReadonlyArray<string>; readonly standIn: string | undefined }> => {
  const decoded = decodeBank(await readFile(bank, "utf8").catch(() => ""))
  if (!decoded.ok) return { drafts: [], standIn: undefined }
  return {
    drafts: [...new Set(Object.values(decoded.value.effects).flatMap((entry) => Object.values(entry.drafts).map((draft) => draft.file)))],
    standIn: decoded.value.standIn?.file
  }
}

const api = (bank: string, rules: PageRules) => {
  const review = reviewPath(bank)
  const folder = dirname(bank)
  const version = async (): Promise<string> => {
    const files = await filesOf(bank)
    const times = await Promise.all([...files.drafts, ...(files.standIn === undefined ? [] : [files.standIn])].map((file) => mtime(resolve(folder, file))))
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
        for (const file of files.drafts) sources[file] = await readFile(resolve(folder, file), "utf8").catch(() => null)
        // The stand-in as a data URL, so the page draws it as it draws everything else: from the session.
        const standIn =
          files.standIn === undefined
            ? undefined
            : await readFile(resolve(folder, files.standIn)).then(
                (bytes) => `data:image/png;base64,${bytes.toString("base64")}`,
                () => null
              )
        return send(response, 200, { bank, name: basename(bank), bankText: await readFile(bank, "utf8"), reviewText, sources, standIn, rules, version: await version() })
      }
      if (route === "PUT /bank") {
        const decoded = decodeBank((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        await writeFile(bank, encodeBank(decoded.value))
        return send(response, 200, { version: await version() })
      }
      if (route === "PUT /review") {
        const decoded = decodeReview((await body(request)).toString("utf8"))
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

/** Starts the page; resolves with its address once it listens. */
export const serve = (options: ServeOptions): Promise<Address> =>
  servePage({ from: dirname(fileURLToPath(import.meta.url)), name: "fx-lab-api", port: options.port, host: options.host }, api(options.bank, options.rules))
