/**
 * The review page on the website: the example bank kept in the tab and
 * baked in the browser, so a person can try the skeleton lab without the
 * CLI. The website imports this after the pixel fixer's, the sound lab's,
 * the effects lab's, and the lab's own styles.
 */
import { exampleBank, exampleImages, exampleModules, exampleName } from "./example.ts"
import { start } from "./lab.ts"
import { memoryStore } from "./store.ts"

/** Opens the example bank on the clip `first`, with nothing written anywhere, once its pictures are decoded; its frames baked at 1×, the size its parts sheet drew it. */
export const startDemo = (first?: string): void =>
  void exampleImages().then((images) => start(memoryStore(exampleName, exampleBank, { modules: exampleModules, images }, { scale: 1 }), first))
