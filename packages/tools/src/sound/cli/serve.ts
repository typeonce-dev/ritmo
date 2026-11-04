/**
 * The review page on localhost, and a small API beside it that reads and
 * writes the bank and its review, so what the person picks and notes lands
 * in the files the agent reads. The page checks the files' versions every
 * moment, so takes the agent writes while the page is open show up in it.
 */
import { readFile, writeFile } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { body, mtime, send, servePage, type Address } from "../../internal/serve.ts"
import { decodeBank, encodeBank } from "../core/recipe.ts"
import { decodeReview, encodeReview, reviewPath } from "../core/review.ts"

export interface ServeOptions {
  readonly bank: string
  readonly port: number
  readonly host: boolean
}

const api = (bank: string) => {
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
  servePage({ from: dirname(fileURLToPath(import.meta.url)), name: "sound-lab-api", port: options.port, host: options.host }, api(options.bank))
