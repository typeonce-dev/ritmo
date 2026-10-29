/**
 * The review page on the website: an example bank kept in the tab, so a
 * person can try the sound lab without the CLI. The website imports this
 * after the pixel fixer's styles and the lab's own (`page.css`).
 */
import { start } from "./lab.ts"
import { memoryStore } from "./store.ts"

/** Opens `bankText` (a bank's JSON) as `name` on the sound `first`, with nothing written anywhere. */
export const startDemo = (name: string, bankText: string, first?: string): void => start(memoryStore(name, bankText), first)
