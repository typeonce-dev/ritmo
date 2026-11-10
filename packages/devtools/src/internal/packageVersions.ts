/**
 * The version check for the `ritmo-devtools lint` CLI (Node only): whether
 * every Ritmo package the game installs is the same version. Each package
 * depends on `@typeonce/ritmo` at its own minor, so `@typeonce/ritmo-browser`
 * 0.22 beside `@typeonce/ritmo` 0.23 installs a second, hidden copy of core
 * 0.22 under browser, and the game then gets type errors between the two
 * copies that name neither.
 *
 * It resolves packages as Node does, by walking up from a folder through
 * each `node_modules`, so it reads npm and yarn trees (hoisted or nested,
 * workspaces included) and pnpm's (symlinks into `node_modules/.pnpm`) the
 * same way. Yarn Plug'n'Play installs no `node_modules`: nothing is found
 * and nothing is said.
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"

const scope = "@typeonce"

/** The Ritmo packages, all released at one version: `@typeonce/ritmo*` and `@typeonce/oxlint-plugin-ritmo`. */
const isRitmo = (name: string): boolean => name.startsWith(`${scope}/`) && name.includes("ritmo")

/** One installed copy of a Ritmo package. */
export interface Installed {
  readonly name: string
  readonly version: string
  /** Where it was found, relative to the game's folder: the `node_modules` entry Node resolves it through. */
  readonly path: string
  /** The package it was resolved from, when it is not the copy the game itself resolves. */
  readonly under: string | undefined
}

export type Versions =
  | { readonly _tag: "Same"; readonly installed: ReadonlyArray<Installed> }
  | { readonly _tag: "Mismatched"; readonly installed: ReadonlyArray<Installed> }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null

const readManifest = (folder: string): { readonly name: string; readonly version: string; readonly needs: ReadonlyArray<string> } | undefined => {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"))
  } catch {
    return undefined
  }
  if (!isRecord(manifest) || typeof manifest["name"] !== "string" || typeof manifest["version"] !== "string") return undefined
  const needs = new Set<string>()
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const entries = manifest[field]
    if (isRecord(entries)) for (const name of Object.keys(entries)) if (isRitmo(name)) needs.add(name)
  }
  return { name: manifest["name"], version: manifest["version"], needs: [...needs] }
}

/** The `node_modules` folders Node looks in from `folder`, nearest first. */
const lookups = (folder: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  for (let at = folder; ; at = dirname(at)) {
    if (basename(at) !== "node_modules") found.push(join(at, "node_modules"))
    if (dirname(at) === at) return found
  }
}

const realpath = (path: string): string | undefined => {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** Where `name` resolves from `folder`, as Node finds it: the entry it resolves through, and its real path. */
const resolveFrom = (folder: string, name: string): { readonly entry: string; readonly real: string } | undefined => {
  for (const modules of lookups(folder)) {
    const entry = join(modules, ...name.split("/"))
    const real = realpath(entry)
    if (real !== undefined && readManifest(real) !== undefined) return { entry, real }
  }
  return undefined
}

/** Every Ritmo package name in a `node_modules/@typeonce` the game's folder can see. */
const visibleNames = (cwd: string): ReadonlyArray<string> => {
  const names = new Set<string>()
  for (const modules of lookups(cwd)) {
    let entries: ReadonlyArray<string>
    try {
      entries = readdirSync(join(modules, scope))
    } catch {
      continue
    }
    for (const entry of entries) if (isRitmo(`${scope}/${entry}`)) names.add(`${scope}/${entry}`)
  }
  return [...names].sort()
}

/**
 * Every copy of a Ritmo package installed for the game in `cwd`: the ones the
 * game resolves, then, through each one's dependencies, every other copy one
 * of them resolves (an npm copy nested under it, or pnpm's store folder).
 */
export const check = (cwd: string): Versions => {
  const root = realpath(cwd) ?? cwd
  const installed: Array<Installed> = []
  const seen = new Set<string>()
  const queue: Array<{ readonly folder: string; readonly under: string | undefined }> = []
  const add = (found: { readonly entry: string; readonly real: string } | undefined, under: string | undefined) => {
    if (found === undefined || seen.has(found.real)) return
    const manifest = readManifest(found.real)
    if (manifest === undefined) return
    seen.add(found.real)
    installed.push({ name: manifest.name, version: manifest.version, path: relative(root, found.entry).split(sep).join("/"), under })
    queue.push({ folder: found.real, under: manifest.name })
  }
  for (const name of visibleNames(root)) add(resolveFrom(root, name), undefined)
  // Each package resolves its own dependencies from where it really is (pnpm: its store folder).
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const name of readManifest(next.folder)?.needs ?? []) add(resolveFrom(next.folder, name), next.under)
  }
  const versions = new Set(installed.map(({ version }) => version))
  return { _tag: versions.size > 1 ? "Mismatched" : "Same", installed }
}

const named = ({ name, version }: Installed): string => `${name} ${version}`

/**
 * The CLI text for the version check: nothing when every copy is one
 * version, one warning otherwise, naming each package and version and the fix.
 */
export const format = (versions: Versions): string => {
  if (versions._tag === "Same") return ""
  const top = versions.installed.filter(({ under }) => under === undefined)
  const nested = versions.installed.filter(({ under }) => under !== undefined)
  // The version the others are measured against: core's, or the most common one.
  const core = top.find(({ name }) => name === `${scope}/ritmo`)
  const counts = new Map<string, number>()
  for (const { version } of top) counts.set(version, (counts.get(version) ?? 0) + 1)
  const reference = core?.version ?? [...counts].sort(([, left], [, right]) => right - left)[0]?.[0] ?? versions.installed[0]!.version
  const off = top.filter(({ version }) => version !== reference)
  const beside = core !== undefined ? named(core) : `the other ${scope} packages at ${reference}`
  const seconds = nested.map((copy) => `a second ${named(copy)} under ${copy.under}`)
  const head = off.length > 0
    ? `${off.map(named).join(", ")} ${off.length === 1 ? "is" : "are"} installed with ${beside}${seconds.length > 0 ? ` (and ${seconds.join(", ")})` : ""}`
    : `${seconds.join(", ")} ${seconds.length === 1 ? "is" : "are"} installed beside ${beside}`
  return [
    `warning mismatched-versions ${scope} packages: ${head}: each copy has its own types, so values from one do not type-check against the other`,
    `  fix: install the same version of every ${scope} package`,
    ...versions.installed.map((copy) => `  ${copy.path}  ${named(copy)}`)
  ].join("\n")
}
