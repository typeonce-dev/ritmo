import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const fixture = new URL("./fixtures/lint-entry.ts", import.meta.url).href

const dirs: Array<string> = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh folder laid out by `prepare`, with the CLI's lint run in `game` (relative to it). */
const lintIn = (prepare: (dir: string) => void, game = "."): { readonly status: number; readonly output: string } => {
  const dir = mkdtempSync(join(tmpdir(), "ritmo-versions-"))
  dirs.push(dir)
  prepare(dir)
  const cwd = join(dir, game)
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(cwd, "main.ts"), `export { lintTarget } from ${JSON.stringify(fixture)}\n`)
  try {
    return { status: 0, output: execFileSync(process.execPath, [cli, "lint", "main.ts"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LINT_QUIET: "1" } }) }
  } catch (error) {
    const failed = error instanceof Error && "status" in error && "stdout" in error ? error : undefined
    return { status: typeof failed?.status === "number" ? failed.status : -1, output: typeof failed?.stdout === "string" ? failed.stdout : "" }
  }
}

/** Writes a package folder: its `package.json`, depending on each of `needs` at its own minor. */
const pkg = (folder: string, name: string, version: string, needs: ReadonlyArray<string> = []): void => {
  mkdirSync(folder, { recursive: true })
  const minor = version.split(".").slice(0, 2).join(".")
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name, version, dependencies: Object.fromEntries(needs.map((need) => [need, `^${minor}.0`])) }))
}

/** A relative symlink at `path` to the folder `target`, as pnpm makes them. */
const link = (target: string, path: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(relative(dirname(path), target), path)
}

/** pnpm: each package in its own store folder, its dependencies linked beside it, the game's linked into node_modules. */
const pnpm = (dir: string, packages: ReadonlyArray<{ readonly name: string; readonly version: string; readonly needs?: ReadonlyArray<{ readonly name: string; readonly version: string }> }>): void => {
  const store = (name: string, version: string) => join(dir, "node_modules", ".pnpm", `${name.replace("/", "+")}@${version}`, "node_modules", ...name.split("/"))
  for (const { name, version, needs = [] } of packages) {
    pkg(store(name, version), name, version, needs.map((need) => need.name))
    for (const need of needs) {
      const target = store(need.name, need.version)
      pkg(target, need.name, need.version)
      link(target, join(dir, "node_modules", ".pnpm", `${name.replace("/", "+")}@${version}`, "node_modules", ...need.name.split("/")))
    }
    link(store(name, version), join(dir, "node_modules", ...name.split("/")))
  }
}

const finding = "warning mismatched-versions @typeonce packages: @typeonce/ritmo-browser 0.22.0 is installed with @typeonce/ritmo 0.23.0 (and a second @typeonce/ritmo 0.22.0 under @typeonce/ritmo-browser): each copy has its own types, so values from one do not type-check against the other\n  fix: install the same version of every @typeonce package"

describe("ritmo-devtools lint: the versions of @typeonce packages", () => {
  it("names each copy and the fix when npm nests a second core under an older package, and fails", () => {
    const { status, output } = lintIn((dir) => {
      pkg(join(dir, "node_modules", "@typeonce", "ritmo"), "@typeonce/ritmo", "0.23.0")
      pkg(join(dir, "node_modules", "@typeonce", "ritmo-browser"), "@typeonce/ritmo-browser", "0.22.0", ["@typeonce/ritmo"])
      pkg(join(dir, "node_modules", "@typeonce", "ritmo-browser", "node_modules", "@typeonce", "ritmo"), "@typeonce/ritmo", "0.22.0")
    })
    expect(status).toBe(1)
    expect(output).toContain([
      finding,
      "  node_modules/@typeonce/ritmo  @typeonce/ritmo 0.23.0",
      "  node_modules/@typeonce/ritmo-browser  @typeonce/ritmo-browser 0.22.0",
      "  node_modules/@typeonce/ritmo-browser/node_modules/@typeonce/ritmo  @typeonce/ritmo 0.22.0"
    ].join("\n"))
    expect(output.match(/mismatched-versions/g)).toHaveLength(1)
  })

  it("follows pnpm's links into its store", () => {
    const { status, output } = lintIn((dir) => pnpm(dir, [
      { name: "@typeonce/ritmo", version: "0.23.0" },
      { name: "@typeonce/ritmo-browser", version: "0.22.0", needs: [{ name: "@typeonce/ritmo", version: "0.22.0" }] }
    ]))
    expect(status).toBe(1)
    expect(output).toContain([
      finding,
      "  node_modules/@typeonce/ritmo  @typeonce/ritmo 0.23.0",
      "  node_modules/@typeonce/ritmo-browser  @typeonce/ritmo-browser 0.22.0",
      "  node_modules/.pnpm/@typeonce+ritmo-browser@0.22.0/node_modules/@typeonce/ritmo  @typeonce/ritmo 0.22.0"
    ].join("\n"))
  })

  it("finds packages yarn or npm workspaces hoisted to a parent folder", () => {
    const { status, output } = lintIn((dir) => {
      pkg(join(dir, "node_modules", "@typeonce", "ritmo"), "@typeonce/ritmo", "0.23.0")
      pkg(join(dir, "node_modules", "@typeonce", "ritmo-math"), "@typeonce/ritmo-math", "0.23.0", ["@typeonce/ritmo"])
      pkg(join(dir, "games", "arena", "node_modules", "@typeonce", "ritmo-render"), "@typeonce/ritmo-render", "0.21.0", ["@typeonce/ritmo"])
      pkg(join(dir, "games", "arena", "node_modules", "@typeonce", "ritmo-render", "node_modules", "@typeonce", "ritmo"), "@typeonce/ritmo", "0.21.0")
    }, "games/arena")
    expect(status).toBe(1)
    expect(output).toContain("warning mismatched-versions @typeonce packages: @typeonce/ritmo-render 0.21.0 is installed with @typeonce/ritmo 0.23.0 (and a second @typeonce/ritmo 0.21.0 under @typeonce/ritmo-render)")
    expect(output).toContain("  ../../node_modules/@typeonce/ritmo-math  @typeonce/ritmo-math 0.23.0")
  })

  it("says nothing when every copy is one version", () => {
    for (const prepare of [
      (dir: string) => pnpm(dir, [
        { name: "@typeonce/ritmo", version: "0.23.0" },
        { name: "@typeonce/ritmo-browser", version: "0.23.0", needs: [{ name: "@typeonce/ritmo", version: "0.23.0" }] },
        { name: "@typeonce/ritmo-devtools", version: "0.23.0", needs: [{ name: "@typeonce/ritmo", version: "0.23.0" }] }
      ]),
      (dir: string) => {
        pkg(join(dir, "node_modules", "@typeonce", "ritmo"), "@typeonce/ritmo", "0.23.0")
        pkg(join(dir, "node_modules", "@typeonce", "oxlint-plugin-ritmo"), "@typeonce/oxlint-plugin-ritmo", "0.23.0")
        // Not a Ritmo package: its version is its own.
        pkg(join(dir, "node_modules", "@typeonce", "other"), "@typeonce/other", "2.0.0")
      },
      () => {}
    ]) {
      const { status, output } = lintIn(prepare)
      expect(status).toBe(0)
      expect(output).not.toContain("mismatched-versions")
    }
  })
})
