/**
 * Finding a game's files for a review page, the same way for every tool:
 * folders walked by name (hidden folders and `node_modules` never), ids as
 * paths from the working directory, and the game's root, where a review
 * that must not ship with the game is kept.
 */
import { existsSync } from "node:fs"
import { readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/** A path with `/` between folders, whatever the platform: how review files and the page name files. */
export const posix = (path: string): string => path.split(sep).join("/")

/** How a page names a file: its path from the working directory, with `/` between folders. */
export const idOf = (file: string): string => posix(relative(process.cwd(), file)) || basename(file)

/**
 * Every file under `folder`, in no particular order. Hidden folders and
 * `node_modules` are passed over, and so is any folder `skip` names (a tool's
 * own outputs, such as a song's stems).
 */
export const walk = async (folder: string, skip: (name: string) => boolean = () => false): Promise<Array<string>> => {
  const found: Array<string> = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules" && !skip(entry.name)) found.push(...(await walk(join(folder, entry.name), skip)))
    } else if (entry.isFile()) found.push(join(folder, entry.name))
  }
  return found
}

const roots = new Map<string, string>()

/** The game's root for a file: the nearest folder at or above it with a `package.json`, else the file's own folder. */
export const rootOf = (file: string): string => {
  const start = dirname(file)
  const known = roots.get(start)
  if (known !== undefined) return known
  let folder = start
  for (;;) {
    if (existsSync(join(folder, "package.json"))) break
    const parent = dirname(folder)
    if (parent === folder) {
      folder = start
      break
    }
    folder = parent
  }
  roots.set(start, folder)
  return folder
}

/**
 * The real path of `file` (from `folder`, links followed) when it is inside
 * `folder`, else `undefined`: a file that is not there, and one a path or a
 * link leads out of the folder to. What a page asks for by a path someone
 * can write (a bank's drafts) is read only through this.
 */
export const inside = async (folder: string, file: string): Promise<string | undefined> => {
  try {
    const [root, real] = await Promise.all([realpath(folder), realpath(resolve(folder, file))])
    const from = relative(root, real)
    return from !== "" && from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from) ? real : undefined
  } catch {
    return undefined
  }
}

let temps = 0

/**
 * Writes a file whole or not at all: to a hidden file beside it, then
 * renamed over it, so a page or a command reading it meanwhile never sees
 * half of it.
 */
export const writeWhole = async (file: string, data: string | Uint8Array): Promise<void> => {
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}-${++temps}.tmp`)
  try {
    await writeFile(temp, data)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
