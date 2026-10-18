import { build } from "esbuild"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const targets = ["linux", "macos", "windows", "android", "ios"] as const
export type Target = typeof targets[number]
export interface Config {
  entry: string; assets?: string; simulation?: string
  app: { name: string; id: string; version: string; icon?: string }
  window: { width: number; height: number; resizable: boolean }
  targets: Target[]; requireCompiled: string[]; orientation: "auto" | "portrait" | "landscape"
}
const object = (data: unknown, field: string): Record<string, unknown> => {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${field}: provide an object`)
  return data as Record<string, unknown>
}
const string = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}: provide a nonempty string`)
  return value
}
export const validateConfig = (data: unknown, root: string): Config => {
  const c = object(data, "config"), app = object(c.app, "app"), window = object(c.window ?? {}, "window")
  const dimension = (key: string, fallback: number): number => {
    const n = window[key] ?? fallback
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 16384) throw new Error(`window.${key}: use an integer from 1 to 16384`)
    return n
  }
  const name = string(app.name, "app.name")
  if (!/^[\w .-]+$/.test(name)) throw new Error("app.name: use letters, numbers, spaces, periods, hyphens or underscores")
  const id = string(app.id, "app.id")
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(id)) throw new Error("app.id: use a reverse-domain identifier, for example dev.typeonce.game")
  if (window.resizable !== undefined && typeof window.resizable !== "boolean") throw new Error("window.resizable: use true or false")
  const configured = c.targets ?? [process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"]
  if (!Array.isArray(configured) || !configured.length || configured.some((t) => !targets.includes(t))) throw new Error(`targets: choose from ${targets.join(", ")}`)
  if (c.requireCompiled !== undefined && (!Array.isArray(c.requireCompiled) || c.requireCompiled.some((s) => typeof s !== "string"))) throw new Error("requireCompiled: provide an array of system names")
  if (c.orientation !== undefined && !["auto", "portrait", "landscape"].includes(String(c.orientation))) throw new Error("orientation: choose auto, portrait or landscape")
  const version = string(app.version, "app.version")
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) throw new Error("app.version: use a semantic version, for example 0.1.0")
  const result: Config = { entry: resolve(root, string(c.entry, "entry")),
    app: { name, id, version },
    window: { width: dimension("width", 1280), height: dimension("height", 720), resizable: window.resizable !== false },
    orientation: (c.orientation ?? "auto") as Config["orientation"], targets: configured, requireCompiled: c.requireCompiled as string[] ?? [] }
  for (const key of ["assets", "simulation"] as const) if (c[key] !== undefined) result[key] = resolve(root, string(c[key], key))
  if (app.icon !== undefined) result.app.icon = resolve(root, string(app.icon, "app.icon"))
  return result
}
export const loadConfig = async (path: string): Promise<Config> => {
  await access(path).catch(() => { throw new Error(`Create ${path} with entry, app and window settings; see @typeonce/ritmo-native/README.md`) })
  const temporary = await mkdtemp(join(tmpdir(), "ritmo-config-"))
  try {
    const output = join(temporary, "config.mjs")
    await build({ entryPoints: [path], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" })
    const loaded = await import(pathToFileURL(output).href) as { default: unknown }
    const config = validateConfig(loaded.default, dirname(path))
    await access(config.entry).catch(() => { throw new Error(`entry: create ${config.entry}`) })
    if (config.assets) await access(config.assets).catch(() => { throw new Error(`assets: create ${config.assets} or remove this setting`) })
    return config
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
