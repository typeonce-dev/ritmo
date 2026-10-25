/**
 * The skill check for the `ritmo-devtools lint` CLI (Node only): whether the
 * project links the Ritmo skill from the installed package, as `SETUP.md`
 * step 2 says, so the game's agent reads the playbooks of the installed
 * version. It is a note: it never fails the lint, since where an agent reads
 * skills from is the project's choice.
 */
import { lstatSync, realpathSync } from "node:fs"
import { join, sep } from "node:path"

/** The folders agents read skills from, relative to the working directory. */
const folders = [".agents/skills/ritmo", ".claude/skills/ritmo"] as const

export type SkillLink =
  | { readonly _tag: "Linked"; readonly path: string }
  | { readonly _tag: "Copied"; readonly path: string }
  | { readonly _tag: "Missing" }

// A link into an installed `@typeonce/ritmo` package's skill: `node_modules/@typeonce/ritmo/skills/ritmo`, or pnpm's store path to it.
const isInstalledSkill = (path: string): boolean =>
  path.includes(`${sep}node_modules${sep}`) && path.endsWith(join("@typeonce", "ritmo", "skills", "ritmo"))

/** Where the skill is in `cwd`: linked from the installed package, copied in, or missing. */
export const check = (cwd: string): SkillLink => {
  let copied: string | undefined
  for (const folder of folders) {
    const path = join(cwd, folder)
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() && isInstalledSkill(realpathSync(path))) return { _tag: "Linked", path: folder }
      copied ??= folder
    } catch {
      // Not there (or a dangling link): look at the next folder.
    }
  }
  return copied === undefined ? { _tag: "Missing" } : { _tag: "Copied", path: copied }
}

/** The CLI text for a skill check: nothing when linked, a note otherwise. */
export const format = (link: SkillLink): string => {
  switch (link._tag) {
    case "Linked":
      return ""
    case "Missing":
      return `note  skill-not-linked\n`
        + `  No ${folders.join(" or ")} links to node_modules/@typeonce/ritmo/skills/ritmo.\n`
        + `  Link it (SETUP.md step 2) so your agent reads the playbooks for this Ritmo version.`
    case "Copied":
      return `note  skill-copied  ${link.path}\n`
        + `  This is a copy of the Ritmo skill, or a link to somewhere else: it goes stale on the next upgrade.\n`
        + `  Replace it with a link to node_modules/@typeonce/ritmo/skills/ritmo (SETUP.md step 2).`
  }
}
