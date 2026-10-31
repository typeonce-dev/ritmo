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

/** The installed skills at `node_modules/@typeonce/ritmo/skills/<skill>`. */
const install = (dir: string): void => {
  for (const name of ["ritmo", "ritmo-prototype", "ritmo-onboarding"]) {
    const skill = join(dir, "node_modules", "@typeonce", "ritmo", "skills", name)
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, "SKILL.md"), `# ${name}\n`)
  }
}

/** Links each named skill from the installed package into `folder`. */
const link = (dir: string, folder: string, names: ReadonlyArray<string>): void => {
  mkdirSync(join(dir, folder), { recursive: true })
  for (const name of names) symlinkSync(`../../node_modules/@typeonce/ritmo/skills/${name}`, join(dir, folder, name))
}

describe("ritmo-devtools lint: the skill link", () => {
  it("notes each skill a project does not link, without failing", () => {
    const { status, output } = lintProject()
    expect(status).toBe(0)
    expect(output).toContain([
      "note  skill-not-linked  ritmo",
      "  No .agents/skills/ritmo or .claude/skills/ritmo links to node_modules/@typeonce/ritmo/skills/ritmo.",
      "  Link it (SETUP.md step 2) so your agent reads the playbooks for this Ritmo version.",
      "note  skill-not-linked  ritmo-prototype",
      "  No .agents/skills/ritmo-prototype or .claude/skills/ritmo-prototype links to node_modules/@typeonce/ritmo/skills/ritmo-prototype.",
      "  Link it (SETUP.md step 2) so your agent can prototype a mechanic with this Ritmo version.",
      "note  skill-not-linked  ritmo-onboarding",
      "  No .agents/skills/ritmo-onboarding or .claude/skills/ritmo-onboarding links to node_modules/@typeonce/ritmo/skills/ritmo-onboarding.",
      "  Link it (SETUP.md step 2) so your agent can teach the game to strangers with this Ritmo version."
    ].join("\n"))
  })

  it("notes the prototype skill alone in a project set up before it shipped", () => {
    const { output } = lintProject((dir) => {
      install(dir)
      link(dir, ".agents/skills", ["ritmo"])
    })
    expect(output).toContain("note  skill-not-linked  ritmo-prototype")
    expect(output).not.toContain("note  skill-not-linked  ritmo\n")
  })

  it("notes the onboarding skill alone in a project set up before it shipped", () => {
    const { output } = lintProject((dir) => {
      install(dir)
      link(dir, ".agents/skills", ["ritmo", "ritmo-prototype"])
    })
    expect(output).toContain("note  skill-not-linked  ritmo-onboarding")
    expect(output).not.toContain("note  skill-not-linked  ritmo-prototype")
    expect(output).not.toContain("note  skill-not-linked  ritmo\n")
  })

  it("says nothing when either folder links the installed skills", () => {
    for (const folder of [".agents/skills", ".claude/skills"]) {
      const { status, output } = lintProject((dir) => {
        install(dir)
        link(dir, folder, ["ritmo", "ritmo-prototype", "ritmo-onboarding"])
      })
      expect(status).toBe(0)
      expect(output, folder).not.toContain("note  skill")
    }
  })

  it("says nothing when the package itself is linked from a checkout (`link:`)", () => {
    const { status, output } = lintProject((dir) => {
      const checkout = join(dir, "checkout")
      for (const name of ["ritmo", "ritmo-prototype", "ritmo-onboarding"]) {
        mkdirSync(join(checkout, "skills", name), { recursive: true })
        writeFileSync(join(checkout, "skills", name, "SKILL.md"), `# ${name}\n`)
      }
      mkdirSync(join(dir, "node_modules", "@typeonce"), { recursive: true })
      symlinkSync(checkout, join(dir, "node_modules", "@typeonce", "ritmo"))
      link(dir, ".agents/skills", ["ritmo", "ritmo-prototype", "ritmo-onboarding"])
    })
    expect(status).toBe(0)
    expect(output).not.toContain("note  skill")
  })

  it("notes a copy, which goes stale on upgrade", () => {
    const { status, output } = lintProject((dir) => {
      mkdirSync(join(dir, ".agents", "skills", "ritmo"), { recursive: true })
      writeFileSync(join(dir, ".agents", "skills", "ritmo", "SKILL.md"), "# Ritmo, copied\n")
    })
    expect(status).toBe(0)
    expect(output).toContain("note  skill-copied  .agents/skills/ritmo")
    expect(output).toContain("This is a copy of the ritmo skill")
    expect(output).toContain("Replace it with a link to node_modules/@typeonce/ritmo/skills/ritmo (SETUP.md step 2)")
  })
})
