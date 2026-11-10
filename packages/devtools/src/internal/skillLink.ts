/**
 * The skill check for the `ritmo-devtools lint` CLI (Node only): whether the
 * project links each Ritmo skill from the installed package, as `SETUP.md`
 * step 2 says, so the game's agent reads the skills of the installed
 * version. It is a note: it never fails the lint, since where an agent reads
 * skills from is the project's choice.
 */
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs"
import { join, sep } from "node:path"

/** What an agent misses without each skill `@typeonce/ritmo` ships. A skill not listed here gets {@link missing}. */
const misses: Readonly<Record<string, string>> = {
  ritmo: "reads the playbooks for this Ritmo version",
  "ritmo-prototype": "can prototype a mechanic with this Ritmo version",
  "ritmo-onboarding": "can teach the game to strangers with this Ritmo version",
  "ritmo-polish": "can polish the game's feel, feedback, and UI with this Ritmo version",
  "ritmo-pixel-art": "makes and checks the game's pixel art with `ritmo-tools pixel` and this Ritmo version's principles",
  "ritmo-fx": "makes and reviews the game's pixel art effects with `ritmo-tools fx` for this Ritmo version",
  "ritmo-sounds": "makes and reviews the game's sound effects with `ritmo-tools sound` for this Ritmo version",
  "ritmo-music": "makes and reviews the game's music with `ritmo-tools music` for this Ritmo version"
}

const missing = (skill: Skill): string => misses[skill] ?? `reads the ${skill} skill of this Ritmo version`

export type Skill = string

/**
 * The skills to check: every folder with a `SKILL.md` in the installed
 * `@typeonce/ritmo/skills`, so a skill a later version ships is checked
 * with no change here. Without an installed package to read, the skills
 * listed in {@link misses}.
 */
const skillsIn = (cwd: string): ReadonlyArray<Skill> => {
  const installed = join(cwd, "node_modules", "@typeonce", "ritmo", "skills")
  try {
    const found = readdirSync(installed).filter((name) => existsSync(join(installed, name, "SKILL.md"))).sort()
    if (found.length > 0) return found
  } catch {
    // Not installed here: check the skills this version knows.
  }
  return Object.keys(misses).sort()
}

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
  skillsIn(cwd).map((skill) => checkSkill(cwd, skill))

const formatOne = (link: SkillLink): string => {
  const installed = `node_modules/@typeonce/ritmo/skills/${link.skill}`
  switch (link._tag) {
    case "Linked":
      return ""
    case "Missing":
      return `note  skill-not-linked  ${link.skill}\n`
        + `  No ${folders(link.skill).join(" or ")} links to ${installed}.\n`
        + `  Link it (SETUP.md step 2) so your agent ${missing(link.skill)}.`
    case "Copied":
      return `note  skill-copied  ${link.path}\n`
        + `  This is a copy of the ${link.skill} skill, or a link to somewhere else: it goes stale on the next upgrade.\n`
        + `  Replace it with a link to ${installed} (SETUP.md step 2).`
  }
}

/** The CLI text for the skill checks: nothing when every skill is linked, a note per skill otherwise. */
export const format = (links: ReadonlyArray<SkillLink>): string =>
  links.map(formatOne).filter((text) => text !== "").join("\n")
