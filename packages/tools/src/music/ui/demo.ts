/**
 * The review page on the website: an example song kept in the tab, so a
 * person can try the music lab without the CLI. The website imports this
 * after the pixel fixer's, the sound lab's, and the lab's own styles.
 */
import { start } from "./lab.ts"
import { memoryStore } from "./store.ts"

/** Opens `songText` (a song's JSON) as `name`; `audio` loads the files next to it by name (its hum). */
export const startDemo = (name: string, songText: string, audio: ReadonlyMap<string, () => Promise<ArrayBuffer>>): void =>
  start(memoryStore(name, songText, audio))
