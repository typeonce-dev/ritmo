/// <reference types="vite/client" />
/**
 * The example bank (`examples/fx`) for the website: its JSON and every
 * draft's source by its path in the bank, read at build time by Vite. The
 * demo page and the tools page's showcase load drafts from these sources, as
 * the review page does from the CLI's server.
 */
import bankText from "../../../examples/fx/effects.fx.json?raw"

const files = import.meta.glob<string>("../../../examples/fx/drafts/*.js", { query: "?raw", import: "default", eager: true })

export const exampleName = "effects.fx.json"
export const exampleBank: string = bankText

/** Each draft's source, by its path in the bank (`drafts/hit.a.js`). */
export const exampleSources: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, source]) => [path.slice(path.indexOf("drafts/")), source])
)
