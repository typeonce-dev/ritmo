/**
 * Writes the package version into the packages that print or record it:
 * `packages/devtools/src/internal/version.ts` (replay files record it) and
 * `packages/tools/src/internal/version.ts` (`ritmo-tools --version`). Run by
 * `pnpm version-packages` after `changeset version`.
 */
import { readFileSync, writeFileSync } from "node:fs"

const sync = (directory: string, constant: string): void => {
  const root = new URL(`../packages/${directory}/`, import.meta.url)
  const manifest: unknown = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
  const version = typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string" ? manifest.version : undefined
  if (version === undefined) throw new Error(`packages/${directory}/package.json has no version`)
  const target = new URL("src/internal/version.ts", root)
  const source = readFileSync(target, "utf8").replace(new RegExp(`export const ${constant} = "[^"]*"`), `export const ${constant} = "${version}"`)
  writeFileSync(target, source)
  console.log(`${directory} ${constant} = ${version}`)
}

sync("devtools", "libraryVersion")
sync("tools", "toolsVersion")
