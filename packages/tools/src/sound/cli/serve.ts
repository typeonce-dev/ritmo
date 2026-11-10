/**
 * The review page on localhost, and a small API beside it that reads and
 * writes the bank and its review, so what the person picks and notes lands
 * in the files the agent reads. The page checks the files' versions every
 * moment, so takes the agent writes while the page is open show up in it.
 * Every write carries the version the page read (`internal/save.ts`).
 */
import { readFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeWhole } from "../../internal/files.ts"
import { textVersion } from "../../internal/save.ts"
import { body, mtime, heldFile, send, servePage, writeChecked, type Address, type Handler } from "../../internal/serve.ts"
import { decodeBank, encodeBank } from "../core/recipe.ts"
import { decodeReview, encodeReview, reviewPath } from "../core/review.ts"

export interface ServeOptions {
  readonly bank: string
  readonly port: number
  readonly host: boolean
}

/** The API over one bank and its review. */
export const api = (bank: string): Handler => {
  const review = reviewPath(bank)
  const version = async (): Promise<string> => `${await mtime(bank)}:${await mtime(review)}`
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const route = `${request.method ?? "GET"} ${(request.url ?? "/").split("?")[0]}`
      if (route === "GET /version") return send(response, 200, { version: await version() })
      if (route === "GET /session") {
        const reviewText = await readFile(review, "utf8").catch(() => null)
        return send(response, 200, { bank, name: basename(bank), bankText: await readFile(bank, "utf8"), reviewText, version: await version() })
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
  servePage({ from: dirname(fileURLToPath(import.meta.url)), name: "sound-lab-api", port: options.port, host: options.host }, api(options.bank))
