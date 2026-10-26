import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const fixture = new URL("./fixtures/lint-entry.ts", import.meta.url).href

const simulationRules = { "ritmo/keep-simulation-headless": "error", "ritmo/use-clock-for-time": "error" }
const config = (overrides: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ jsPlugins: ["@typeonce/oxlint-plugin-ritmo"], overrides, ...extra })

const dirs: Array<string> = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Writes `files` into a fresh project, with `main.ts` (unless given) re-exporting the fixture's lintTarget, and runs the CLI in it. */
const lintProject = (files: Record<string, string>, entryBody = ""): { readonly status: number; readonly output: string } => {
  const dir = mkdtempSync(join(tmpdir(), "ritmo-coverage-"))
  dirs.push(dir)
  const all = { "main.ts": `export { lintTarget } from ${JSON.stringify(fixture)}\n${entryBody}`, ...files }
  for (const [name, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  try {
    const output = execFileSync(process.execPath, [cli, "lint", "main.ts"], {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LINT_QUIET: "1" }
    })
    return { status: 0, output }
  } catch (error) {
    const failed = error instanceof Error && "status" in error && "stdout" in error ? error : undefined
    return { status: typeof failed?.status === "number" ? failed.status : -1, output: typeof failed?.stdout === "string" ? failed.stdout : "" }
  }
}

const uncovered = (output: string): ReadonlyArray<string> =>
  [...output.matchAll(/^uncovered-simulation-module {2}(\S+)$/gm)].map((match) => match[1]!)

describe("ritmo-devtools lint: simulation coverage", () => {
  it("reports a value import outside the simulation override", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([{ files: ["src/sim/**"], rules: simulationRules }]),
      "src/sim/move.ts": "export const speed = 1\n",
      "src/ui.ts": "export const label = \"hp\"\n"
    }, "import \"./src/sim/move.ts\"\nimport { label } from \"./src/ui.ts\"\nexport const used = label\n")
    expect(status).toBe(1)
    expect(uncovered(output)).toEqual(["src/ui.ts"])
    expect(output).toContain([
      "uncovered-simulation-module  src/ui.ts",
      "  The simulation loads this file, but the simulation rules in .oxlintrc.json do not cover it.",
      "  Add it to the simulation override's \"files\", or stop importing values from it.",
      "  A host module (render, input glue) imported at the top of the lint entry is loaded too: import it inside lintTarget instead."
    ].join("\n"))
  })

  it("passes when every loaded module is covered, and skips the entry and files outside the config directory", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([{ files: ["src/**"], rules: simulationRules }]),
      "src/a.ts": "import { b } from \"./nested/b.ts\"\nexport const a = b\n",
      "src/nested/b.ts": "export const b = 1\n"
    }, "import { a } from \"./src/a.ts\"\nexport const used = a\n")
    expect(uncovered(output)).toEqual([])
    expect(output).not.toContain("not checked")
    expect(status).toBe(0)
  })

  it("does not report a type-only import", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([{ files: ["src/sim/**"], rules: simulationRules }]),
      "src/types.ts": "export type Hp = number\nexport const unused = 0\n"
    }, "import type { Hp } from \"./src/types.ts\"\nexport const hp: Hp = 1\n")
    expect(uncovered(output)).toEqual([])
    expect(status).toBe(0)
  })

  it("lets a later override turn the rule off", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([
        { files: ["src/**"], rules: simulationRules },
        { files: ["src/render*.ts"], rules: { "ritmo/keep-simulation-headless": "off" } }
      ]),
      "src/move.ts": "export const speed = 1\n",
      "src/renderHud.ts": "export const hud = 1\n"
    }, "import \"./src/move.ts\"\nimport \"./src/renderHud.ts\"\n")
    expect(uncovered(output)).toEqual(["src/renderHud.ts"])
    expect(status).toBe(1)
  })

  it("reports a module matched by ignorePatterns", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([{ files: ["src/**"], rules: simulationRules }], { ignorePatterns: ["src/generated/**"] }),
      "src/generated/table.ts": "export const table = [1]\n"
    }, "import \"./src/generated/table.ts\"\n")
    expect(uncovered(output)).toEqual(["src/generated/table.ts"])
    expect(status).toBe(1)
  })

  it("does not report a module imported only inside lintTarget", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([{ files: ["src/sim/**"], rules: simulationRules }]),
      "main.ts": [
        `import { lintTarget as base } from ${JSON.stringify(fixture)}`,
        "export const lintTarget = async () => {",
        "  await import(\"./src/present.ts\")",
        "  return base()",
        "}"
      ].join("\n"),
      "src/present.ts": "export const draw = 1\n"
    })
    expect(status).toBe(0)
    expect(uncovered(output)).toEqual([])
  })

  it("parses comments and trailing commas", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": [
        "{",
        "  // simulation",
        "  \"overrides\": [",
        "    /* the game's systems */",
        "    { \"files\": [\"src/sim/**\", \"src/a//b.ts\",], \"rules\": { \"ritmo/keep-simulation-headless\": [\"error\", {},], }, },",
        "  ],",
        "}"
      ].join("\n"),
      "src/sim/move.ts": "export const speed = 1\n",
      "src/ui.ts": "export const label = 1\n"
    }, "import \"./src/sim/move.ts\"\nimport \"./src/ui.ts\"\n")
    expect(output).not.toContain("not checked")
    expect(uncovered(output)).toEqual(["src/ui.ts"])
    expect(status).toBe(1)
  })

  it("prints that coverage was not checked when no override turns the simulation rules on", () => {
    const { status, output } = lintProject({
      ".oxlintrc.json": config([{ files: ["src/**"], rules: { "ritmo/no-state-spread": "error" } }]),
      "src/ui.ts": "export const label = 1\n"
    }, "import \"./src/ui.ts\"\n")
    expect(output).toContain("simulation coverage not checked: no rules in .oxlintrc.json turn on ritmo/keep-simulation-headless")
    expect(uncovered(output)).toEqual([])
    expect(status).toBe(0)
  })
})
