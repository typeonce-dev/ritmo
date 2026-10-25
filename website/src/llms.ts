// `/llms.txt` and `/llms-full.txt` (https://llmstxt.org): the entry point for
// an agent that finds Ritmo on the web. This site is for people; agents work
// from the docs that ship on npm, so both files route there. Links pin the
// version this build documents (the site deploys after each publish), and
// every list is derived from the packages, the nav, and the pages themselves.
import { demos } from "./demos/index.ts"
import { repository, sections } from "./nav.ts"

const site = "https://ritmo.typeonce.dev"

interface Manifest {
  readonly name: string
  readonly version: string
  readonly description: string
}

const manifests = import.meta.glob<Manifest>("../../packages/*/package.json", {
  eager: true,
  import: "default"
})

const markdown = import.meta.glob<string>(
  ["../../packages/*/README.md", "../../packages/core/SETUP.md", "../../packages/core/skills/ritmo/**/*.md"],
  { eager: true, query: "?raw", import: "default" }
)

const frontmatter = import.meta.glob<{ readonly description: string }>("./pages/**/*.mdx", {
  eager: true,
  import: "frontmatter"
})

/** A shipped file: its path in the repository and its URL in the published package. */
interface ShippedFile {
  readonly path: string
  readonly url: string
  readonly title: string
  readonly note: string
}

const packages = Object.entries(manifests)
  .map(([path, manifest]) => ({ dir: path.replace(/\/package\.json$/, ""), ...manifest }))
  // The runtime first, then the add-ons by name.
  .sort((a, b) => (a.name === "@typeonce/ritmo" ? -1 : b.name === "@typeonce/ritmo" ? 1 : a.name.localeCompare(b.name)))

const core = packages.find((pkg) => pkg.name === "@typeonce/ritmo")
if (core === undefined) throw new Error("llms.txt: packages/core/package.json is not @typeonce/ritmo")

const shipped = (pkg: (typeof packages)[number], file: string, title: string, note: string): ShippedFile => {
  const path = `${pkg.dir}/${file}`
  if (markdown[path] === undefined) throw new Error(`llms.txt: ${path} is not in the markdown glob`)
  return { path, url: `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/${file}`, title, note }
}

const skillFiles = Object.keys(markdown)
  .filter((path) => path.startsWith(`${core.dir}/skills/`))
  .sort((a, b) => (a.endsWith("/SKILL.md") ? -1 : b.endsWith("/SKILL.md") ? 1 : a.localeCompare(b)))
  .map((path) => {
    const file = path.slice(core.dir.length + 1)
    const heading = /^# (.+)$/m.exec(markdown[path] ?? "")?.[1]
    if (heading === undefined) throw new Error(`llms.txt: ${path} has no heading`)
    return file.endsWith("/SKILL.md")
      ? shipped(core, file, "Ritmo skill", "routes each change to its playbook and holds the principles; use it for every change")
      : shipped(core, file, `${file.includes("/references/") ? "Reference" : "Playbook"}: ${heading}`, "")
  })

const agentFiles: ReadonlyArray<ShippedFile> = [
  shipped(core, "SETUP.md", "Setup", "one-time steps: packages, checks, and linking the skill"),
  ...skillFiles
]

const packageFiles: ReadonlyArray<ShippedFile> = packages.map((pkg) =>
  shipped(pkg, "README.md", pkg.name, pkg.description)
)

const link = (file: ShippedFile): string => `- [${file.title}](${file.url})${file.note === "" ? "" : `: ${file.note}`}`

const pageDescription = (href: string): string => {
  const file = href === "/docs/" ? "./pages/docs/index.mdx" : `./pages${href.replace(/\/$/, "")}.mdx`
  const description = frontmatter[file]?.description
  if (description === undefined) throw new Error(`llms.txt: no page with a description for ${href} (${file})`)
  return description
}

const guide = sections.map(
  (section) =>
    `### ${section.title}\n\n` +
    section.pages.map((page) => `- [${page.title}](${site}${page.href}): ${pageDescription(page.href)}`).join("\n")
)

const games = Object.entries(demos).map(
  ([id, demo]) => `- [${demo.title}](${site}/play/${id}/): ${demo.description} [Source](${demo.source})`
)

const intro = `# Ritmo

> ${core.description}. Coding agents write the game; wrong code does not compile and the error names the fix, and headless devtools sessions show lints, invariants, and why a value changed. Ritmo runs the simulation; the game's own renderer draws it.

These links are for version ${core.version}. In a project that has Ritmo installed, read the same files in \`node_modules/@typeonce/*\` instead: they match the installed version, and the API changes between versions. The API reference is the JSDoc in \`node_modules/@typeonce/*/src\`; read a module's header and an export's JSDoc before using it, and each package's \`CHANGELOG.md\` when upgrading. Compiler errors and lint messages name the fix: apply it, never cast around it.

Install: \`pnpm add @typeonce/ritmo\` (TypeScript 5.9 or newer, \`strict\` on). To set up a project, follow Setup below.`

/** The index: what Ritmo is, where its agent docs are, and the guide's pages. */
export const llmsTxt = `${intro}

## Agent docs

- [Every agent doc in one file](${site}/llms-full.txt): Setup, the skill, its playbooks and references, and each package README
${agentFiles.map(link).join("\n")}

## Packages

${packageFiles.map(link).join("\n")}

## Optional

The guide for people, with running demos and compiled snippets:

${guide.join("\n\n")}

### Games

${games.join("\n")}

### Source

- [GitHub repository](${repository})
`

/** Every shipped agent doc in one file, for agents that read a single URL. */
export const llmsFullTxt = `${intro}

Below is every agent doc that ships on npm, in order: Setup, the skill, its playbooks and references, then each package README. Relative links resolve against each file's source URL.

${[...agentFiles, ...packageFiles]
  .map((file) => `---\n\nSource: ${file.url}\n\n${(markdown[file.path] ?? "").replace(/^---\n[\s\S]*?\n---\n+/, "").trim()}`)
  .join("\n\n")}
`
