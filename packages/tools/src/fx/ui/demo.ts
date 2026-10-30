/**
 * The review page on the website: the example bank kept in the tab, so a
 * person can try the effects lab without the CLI. The website imports this
 * after the pixel fixer's, the sound lab's, and the lab's own styles.
 */
import { exampleBank, exampleName, exampleSources } from "./example.ts"
import { start } from "./lab.ts"
import { memoryStore } from "./store.ts"

/** Opens the example bank on the effect `first`, with nothing written anywhere. */
export const startDemo = (first?: string): void => start(memoryStore(exampleName, exampleBank, exampleSources), first)
