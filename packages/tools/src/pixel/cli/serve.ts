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
import { body, send, servePage, writeChecked, type Address, type Handler } from "../../internal/serve.ts"
import { decodeReview, encodeReview } from "../core/review.ts"
import { assetVersion, detailOf, findAssets, libraryOf, normalPictureOf, pictureOf, readAsset, readingOf, reviewsOf, reviewVersion, writeReviews, type PixelAsset } from "./library.ts"

export interface ServeOptions {
  /** The pictures, text sprites, and folders to review. */
  readonly paths: ReadonlyArray<string>
  readonly port: number
  readonly host: boolean
}

/** How long a look at the list waits before saying how far the reading is: a browser may give up on an answer that takes minutes. */
const LIST_WAIT_MS = 1000

/** The API over the assets under `paths`. */
export const api = (paths: ReadonlyArray<string>, listWait = LIST_WAIT_MS): Handler => {
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
        const listing = libraryOf(assets)
        const listed = await Promise.race([listing, new Promise<undefined>((done) => setTimeout(done, listWait))])
        // The reading goes on behind this answer, and the next look finds it further along. Once it is all read, the list comes however long its files take to check: a page must not wait for a look that always runs out of time.
        const reading = readingOf(assets)
        if (listed === undefined && reading.done < reading.total) return send(response, 200, { version: "", review: "", reading })
        const entries = listed ?? (await listing)
        const version = hashText(JSON.stringify(entries.map((entry) => [entry.id, entry.version])))
        const review = await reviewVersion(assets)
        // Most looks change nothing: then only the versions travel.
        return send(response, 200, query(request, "since") === version ? { version, review } : { version, review, entries })
      }
      if (route === "GET /review") return send(response, 200, { text: encodeReview(await reviewsOf(assets)), version: await reviewVersion(assets) })
      if (route === "PUT /review") {
        const decoded = decodeReview((await body(request)).toString("utf8"))
        if (!decoded.ok) return send(response, 400, { error: decoded.error })
        // Written since the page last read it (the agent resolved a comment): the page merges and tries again.
        const held = async () => ({ text: encodeReview(await reviewsOf(assets)), version: await reviewVersion(assets) })
        return writeChecked(request, response, held, async () => {
          await writeReviews(assets, decoded.value)
          // Only what was found is written. An id that is not (the agent renamed that file while the page was open) is said back, and its review stays in the file under its old name, for `pixel notes` to list.
          const ignored = Object.keys(decoded.value.assets).filter((id) => !assets.some((asset) => asset.id === id))
          return { version: await reviewVersion(assets), ignored }
        })
      }
      const asset = named(request, assets)
      if (asset === undefined) return send(response, 404, { error: `no such asset for ${route}` })
      if (route === "GET /asset") return send(response, 200, await detailOf(asset))
      if (route === "GET /png") {
        const got = await readAsset(asset)
        if (!got.ok) return send(response, 422, { error: got.problem })
        const picture = await pictureOf(asset)
        response.setHeader("content-type", picture.type)
        // The page asks by version (`v`): a new version is a new address, so the picture at one can be kept.
        response.setHeader("cache-control", query(request, "v") === (await assetVersion(asset)) ? "private, max-age=31536000, immutable" : "no-store")
        response.end(picture.bytes)
        return
      }
      if (route === "GET /normal") {
        const normal = await normalPictureOf(asset)
        if (normal === undefined) return send(response, 404, { error: `${asset.id} has no normal map` })
        response.setHeader("content-type", "image/png")
        response.setHeader("cache-control", query(request, "v") === (await assetVersion(asset)) ? "private, max-age=31536000, immutable" : "no-store")
        response.end(normal)
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
