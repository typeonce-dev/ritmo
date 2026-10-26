/**
 * The skill check for the `ritmo-devtools lint` CLI (Node only): whether the
 * project links each Ritmo skill from the installed package, as `SETUP.md`
 * step 2 says, so the game's agent reads the skills of the installed
 * version. It is a note: it never fails the lint, since where an agent reads
 * skills from is the project's choice.
 */
import { lstatSync, realpathSync } from "node:fs"
import { join, sep } from "node:path"

/** The skills `@typeonce/ritmo` ships, with what an agent misses without each. */
const skills = {
  ritmo: "reads the playbooks for this Ritmo version",
  "ritmo-prototype": "can prototype a mechanic with this Ritmo version"
} as const

export type Skill = keyof typeof skills

/** The folders agents read skills from, relative to the working directory. */
const folders = (skill: Skill) => [`.agents/skills/${skill}`, `.claude/skills/${skill}`] as const

export type SkillLink =
  | { readonly _tag: "Linked"; readonly skill: Skill; readonly path: string }
  | { readonly _tag: "Copied"; readonly skill: Skill; readonly path: string }
  | { readonly _tag: "Missing"; readonly skill: Skill }

// A link into an installed `@typeonce/ritmo` package's skill: `node_modules/@typeonce/ritmo/skills/<skill>`,
// pnpm's store path to it, or wherever the project's own `node_modules/@typeonce/ritmo` resolves (a `link:` checkout).
const isInstalledSkill = (cwd: string, path: string, skill: Skill): boolean => {
  if (path.includes(`${sep}node_modules${sep}`) && path.endsWith(join("@typeonce", "ritmo", "skills", skill))) return true
  try {
    return path === realpathSync(join(cwd, "node_modules", "@typeonce", "ritmo", "skills", skill))
  } catch {
    return false
  }
}

const checkSkill = (cwd: string, skill: Skill): SkillLink => {
  let copied: string | undefined
  for (const folder of folders(skill)) {
    const path = join(cwd, folder)
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() && isInstalledSkill(cwd, realpathSync(path), skill)) return { _tag: "Linked", skill, path: folder }
      copied ??= folder
    } catch {
      // Not there (or a dangling link): look at the next folder.
    }
  }
  return copied === undefined ? { _tag: "Missing", skill } : { _tag: "Copied", skill, path: copied }
}

/** Where each skill is in `cwd`: linked from the installed package, copied in, or missing. */
export const check = (cwd: string): ReadonlyArray<SkillLink> =>
  (Object.keys(skills) as ReadonlyArray<Skill>).map((skill) => checkSkill(cwd, skill))

const formatOne = (link: SkillLink): string => {
  const installed = `node_modules/@typeonce/ritmo/skills/${link.skill}`
  switch (link._tag) {
    case "Linked":
      return ""
    case "Missing":
      return `note  skill-not-linked  ${link.skill}\n`
        + `  No ${folders(link.skill).join(" or ")} links to ${installed}.\n`
        + `  Link it (SETUP.md step 2) so your agent ${skills[link.skill]}.`
    case "Copied":
      return `note  skill-copied  ${link.path}\n`
        + `  This is a copy of the ${link.skill} skill, or a link to somewhere else: it goes stale on the next upgrade.\n`
        + `  Replace it with a link to ${installed} (SETUP.md step 2).`
  }
}

/** The CLI text for the skill checks: nothing when every skill is linked, a note per skill otherwise. */
export const format = (links: ReadonlyArray<SkillLink>): string =>
  links.map(formatOne).filter((text) => text !== "").join("\n")
