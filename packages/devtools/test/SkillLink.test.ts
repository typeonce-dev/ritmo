import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const fixture = new URL("./fixtures/lint-entry.ts", import.meta.url).href

const dirs: Array<string> = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh project whose `main.ts` re-exports the fixture's lintTarget, set up by `prepare`, with the CLI run in it. */
const lintProject = (prepare: (dir: string) => void = () => {}): { readonly status: number; readonly output: string } => {
  const dir = mkdtempSync(join(tmpdir(), "ritmo-skill-"))
  dirs.push(dir)
  writeFileSync(join(dir, "main.ts"), `export { lintTarget } from ${JSON.stringify(fixture)}\n`)
  prepare(dir)
  try {
    return { status: 0, output: execFileSync(process.execPath, [cli, "lint", "main.ts"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LINT_QUIET: "1" } }) }
  } catch (error) {
    const failed = error instanceof Error && "status" in error && "stdout" in error ? error : undefined
    return { status: typeof failed?.status === "number" ? failed.status : -1, output: typeof failed?.stdout === "string" ? failed.stdout : "" }
  }
}

/** An installed skill at `node_modules/@typeonce/ritmo/skills/ritmo`. */
const install = (dir: string): string => {
  const skill = join(dir, "node_modules", "@typeonce", "ritmo", "skills", "ritmo")
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, "SKILL.md"), "# Ritmo\n")
  return skill
}

describe("ritmo-devtools lint: the skill link", () => {
  it("notes a project with no skill link, without failing", () => {
    const { status, output } = lintProject()
    expect(status).toBe(0)
    expect(output).toContain([
      "note  skill-not-linked",
      "  No .agents/skills/ritmo or .claude/skills/ritmo links to node_modules/@typeonce/ritmo/skills/ritmo.",
      "  Link it (SETUP.md step 2) so your agent reads the playbooks for this Ritmo version."
    ].join("\n"))
  })

  it("says nothing when either folder links the installed skill", () => {
    for (const folder of [".agents/skills", ".claude/skills"]) {
      const { status, output } = lintProject((dir) => {
        install(dir)
        mkdirSync(join(dir, folder), { recursive: true })
        symlinkSync("../../node_modules/@typeonce/ritmo/skills/ritmo", join(dir, folder, "ritmo"))
      })
      expect(status).toBe(0)
      expect(output, folder).not.toContain("note  skill")
    }
  })

  it("notes a copy, which goes stale on upgrade", () => {
    const { status, output } = lintProject((dir) => {
      mkdirSync(join(dir, ".agents", "skills", "ritmo"), { recursive: true })
      writeFileSync(join(dir, ".agents", "skills", "ritmo", "SKILL.md"), "# Ritmo, copied\n")
    })
    expect(status).toBe(0)
    expect(output).toContain("note  skill-copied  .agents/skills/ritmo")
    expect(output).toContain("Replace it with a link to node_modules/@typeonce/ritmo/skills/ritmo")
  })
})
