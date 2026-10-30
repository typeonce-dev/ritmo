/// <reference types="vite/client" />
/**
 * The example bank (`examples/fx`) for the website: its JSON, every draft's
 * source by its path in the bank, and its stand-in sprite as a data URL, read at build time by Vite. The
 * demo page and the tools page's showcase load drafts from these sources, as
 * the review page does from the CLI's server.
 */
import bankText from "../../../examples/fx/effects.fx.json?raw"

import standInUrl from "../../../examples/fx/hero.png?inline"

const files = import.meta.glob<string>("../../../examples/fx/drafts/*.js", { query: "?raw", import: "default", eager: true })

export const exampleName = "effects.fx.json"
export const exampleBank: string = bankText

/** Each draft's source, by its path in the bank (`drafts/hit.a.js`). */
export const exampleSources: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, source]) => [path.slice(path.indexOf("drafts/")), source])
)

/** The bank's stand-in sprite, as a data URL. */
export const exampleStandIn: string = standInUrl
