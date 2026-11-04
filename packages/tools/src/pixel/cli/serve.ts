/**
 * The pixel art review page on localhost, and a small API beside it: the
 * list of assets (each read, hashed, and linted here, never in the browser,
 * whose canvas may not give back the pixels the file holds), each asset's
 * picture as PNG, and the review, read and written whole. The page checks
 * the list's version every moment, so art the agent rewrites or adds, and
 * comments it resolves, show up while the page is open.
 *
 * Only what the library finds under the paths the agent named is served:
 * an `id` names one of those, never a path to read.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { hashText } from "../../internal/hash.ts"
import { body, send, servePage, type Address, type Handler } from "../../internal/serve.ts"
import { decodeReview, encodeReview } from "../core/review.ts"
import { assetVersion, detailOf, findAssets, libraryOf, readAsset, reviewsOf, reviewVersion, writeReviews, type PixelAsset } from "./library.ts"

export interface ServeOptions {
  /** The pictures, text sprites, and folders to review. */
  readonly paths: ReadonlyArray<string>
  readonly port: number
  readonly host: boolean
}

/** The API over the assets under `paths`. */
export const api = (paths: ReadonlyArray<string>): Handler => {
  const named = (request: IncomingMessage, assets: ReadonlyArray<PixelAsset>): PixelAsset | undefined => {
    const id = new URL(request.url ?? "/", "http://localhost").searchParams.get("id")
    return assets.find((asset) => asset.id === id)
  }
  const query = (request: IncomingMessage, name: string): string | null => new URL(request.url ?? "/", "http://localhost").searchParams.get(name)
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/")
      const route = `${request.method ?? "GET"} ${path}`
      const assets = await findAssets(paths)
      if (route === "GET /library") {
        const entries = await libraryOf(assets)
        const version = hashText(JSON.stringify(entries.map((entry) => [entry.id, entry.version])))
        const review = await reviewVersion(assets)
        // Most looks change nothing: then only the versions travel.
        return send(response, 200, query(request, "since") === version ? { version, review } : { version, review, entries })
      }
      if (route === "GET /review") return send(response, 200, { text: encodeReview(await reviewsOf(assets)), version: await reviewVersion(assets) })
      if (route === "PUT /review") {
        const decoded = decodeReview((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        const unknown = Object.keys(decoded.value.assets).filter((id) => !assets.some((asset) => asset.id === id))
        if (unknown.length > 0) return send(response, 400, { error: `no such asset: ${unknown.join(", ")}` })
        // Written since the page last read it (the agent resolved a comment): the page merges and tries again.
        const now = await reviewVersion(assets)
        if (query(request, "base") !== now) return send(response, 409, { error: "the review changed since the page read it", text: encodeReview(await reviewsOf(assets)), version: now })
        await writeReviews(assets, decoded.value)
        return send(response, 200, { version: await reviewVersion(assets) })
      }
      const asset = named(request, assets)
      if (asset === undefined) return send(response, 404, { error: `no such asset for ${route}` })
      if (route === "GET /asset") return send(response, 200, await detailOf(asset))
      if (route === "GET /png") {
        const got = await readAsset(asset)
        if (!got.ok) return send(response, 422, { error: got.problem })
        response.setHeader("content-type", "image/png")
        // The page asks by version (`v`): a new version is a new address, so the picture at one can be kept.
        response.setHeader("cache-control", query(request, "v") === (await assetVersion(asset)) ? "private, max-age=31536000, immutable" : "no-store")
        response.end(got.png)
        return
      }
      return send(response, 404, { error: `no ${route}` })
    } catch (error) {
      return send(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Starts the page; resolves with its address once it listens. */
export const serve = (options: ServeOptions): Promise<Address> =>
  servePage({ from: dirname(fileURLToPath(import.meta.url)), source: "../review", name: "pixel-review-api", port: options.port, host: options.host }, api(options.paths))
