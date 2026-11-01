/// <reference types="vite/client" />
/**
 * The example bank (`examples/rig`) for the website: its JSON, and the rig
 * module and every clip module imported already, by their paths in the
 * bank, by Vite at build time (they import each other, so they come as
 * modules, not sources). The demo page bakes them in the tab with the same
 * runner and rasterizer the CLI uses.
 */
import bankText from "../../../examples/rig/hero.rig.json?raw"

const files = import.meta.glob("../../../examples/rig/**/*.js", { eager: true })

export const exampleName = "hero.rig.json"
export const exampleBank: string = bankText

/** Each module, by its path in the bank (`clips/attack.js`). */
export const exampleModules: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(files).map(([path, module]) => [path.slice(path.indexOf("examples/rig/") + "examples/rig/".length), module]))
