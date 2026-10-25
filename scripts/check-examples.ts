/**
 * Type-checks every `@example` in `packages/*\/src`, the way a game would
 * compile it: against the workspace packages by name, resolved through their
 * `exports`, with the repo's game compiler options (`tsconfig.json`). An example that cites an export that
 * does not exist, or calls one with the wrong arguments, fails.
 *
 *   node --import tsx scripts/check-examples.ts
 *
 * Writing an example:
 *
 * - Every `@example` holds one or more ```ts blocks; each block compiles as
 *   its own module.
 * - Modules are in scope by name: a block that uses `Clock.hz` gets
 *   `import * as Clock from "@typeonce/ritmo/Clock"`, the import a game
 *   writes, for every module of every package. A block's own imports win
 *   (`import { Schema } from "effect"` shadows Ritmo's `Schema`).
 * - The game is in scope too: names a typical game defines (`Game`, `Root`,
 *   `Position`, `Player`, `runtime`, `update`, ...) come from
 *   `scripts/examples/prelude.ts` when the block uses them without declaring
 *   them. Read the prelude before writing an example; a block that needs
 *   something else declares it.
 * - Context the example assumes goes at the top of the block, above a
 *   `// ---cut---` line, usually as `declare const`: the reader sees what the
 *   example takes as given, and the checker compiles it.
 * - A block that cannot compile (it shows a file layout, or code for a
 *   library the repo does not install) starts with
 *   `// example-check: skip <reason>`. The reason is required and printed.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript6"

const root = join(import.meta.dirname, "..")
const packagesDir = join(root, "packages")
const outDir = join(root, ".examples")
const preludePath = join(root, "scripts", "examples", "prelude.ts")
const skipMarker = /^\s*\/\/\s*example-check:\s*skip\b\s*(.*)$/
const cutMarker = /^\s*\/\/\s*---cut---\s*$/

interface Block {
  /** `packages/core/src/Clock.ts`, for messages. */
  readonly file: string
  /** The JSDoc line of each code line, 1-based. */
  readonly lines: ReadonlyArray<{ readonly text: string; readonly line: number }>
}

const problems: Array<string> = []
const skipped: Array<string> = []

// ── Modules a block can use by name ────────────────────────────────────

const modules = new Map<string, string>()
for (const name of readdirSync(packagesDir)) {
  const manifest = join(packagesDir, name, "package.json")
  const src = join(packagesDir, name, "src")
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue
  const { name: packageName } = JSON.parse(readFileSync(manifest, "utf8")) as { name: string }
  for (const file of readdirSync(src)) {
    const match = /^([A-Z]\w*)\.ts$/.exec(file)
    if (match === null) continue
    const moduleName = match[1]!
    const existing = modules.get(moduleName)
    if (existing !== undefined) throw new Error(`two packages export a module named ${moduleName}: ${existing} and ${packageName}`)
    modules.set(moduleName, `${packageName}/${moduleName}`)
  }
}

// ── The prelude's exports ──────────────────────────────────────────────

const parse = (fileName: string, text: string) =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const preludeExports = new Map<string, "value" | "type">()
for (const statement of parse(preludePath, readFileSync(preludePath, "utf8")).statements) {
  const exported = ts.isExportDeclaration(statement) || ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  if (!exported) continue
  if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
    for (const element of statement.exportClause.elements) {
      preludeExports.set(element.name.text, statement.isTypeOnly || element.isTypeOnly ? "type" : "value")
    }
  } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    preludeExports.set(statement.name.text, "type")
  } else {
    for (const name of declaredNames(statement)) preludeExports.set(name, "value")
  }
}
for (const name of preludeExports.keys()) {
  if (modules.has(name)) throw new Error(`the prelude exports ${name}, which is also a module name`)
}

/** The names one top-level statement declares. */
function declaredNames(statement: ts.Statement): Array<string> {
  const names: Array<string> = []
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.push(name.text)
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name)
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) bind(declaration.name)
  } else if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) &&
    statement.name !== undefined && ts.isIdentifier(statement.name)
  ) {
    names.push(statement.name.text)
  } else if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
    const clause = statement.importClause
    if (clause.name !== undefined) names.push(clause.name.text)
    const bindings = clause.namedBindings
    if (bindings !== undefined) {
      if (ts.isNamespaceImport(bindings)) names.push(bindings.name.text)
      else for (const element of bindings.elements) names.push(element.name.text)
    }
  } else if (ts.isImportEqualsDeclaration(statement)) {
    names.push(statement.name.text)
  }
  return names
}

/** Every identifier a block reads, leaving out property names. */
const usedNames = (source: ts.SourceFile): Set<string> => {
  const used = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) ||
          ts.isMethodSignature(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node)
      if (!isPropertyName) used.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return used
}

// ── Extraction ─────────────────────────────────────────────────────────

const sourceFiles: Array<string> = []
const walk = (directory: string): void => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name.endsWith(".ts")) sourceFiles.push(path)
  }
}
for (const name of readdirSync(packagesDir)) {
  const src = join(packagesDir, name, "src")
  if (statSync(src, { throwIfNoEntry: false })?.isDirectory()) walk(src)
}

const blocks: Array<Block> = []
for (const path of sourceFiles.sort()) {
  const file = relative(root, path)
  const text = readFileSync(path, "utf8")
  for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const startLine = text.slice(0, comment.index).split("\n").length
    const lines = comment[0].split("\n").map((raw, index) => ({
      text: raw.replace(/^\s*\/\*\*\s?/, "").replace(/\s*\*\/$/, "").replace(/^\s*\* ?/, ""),
      line: startLine + index
    }))
    let index = 0
    while (index < lines.length) {
      if (!/^@example\b/.test(lines[index]!.text)) {
        index++
        continue
      }
      const exampleLine = lines[index]!.line
      let found = 0
      index++
      while (index < lines.length && !/^@\w/.test(lines[index]!.text)) {
        const fence = /^```(\S*)/.exec(lines[index]!.text)
        if (fence === null) {
          index++
          continue
        }
        const language = fence[1]!
        const code: Array<{ text: string; line: number }> = []
        index++
        while (index < lines.length && !/^```\s*$/.test(lines[index]!.text)) code.push(lines[index++]!)
        index++
        if (language !== "ts" && language !== "typescript") {
          problems.push(`${file}:${exampleLine}: an @example block is \`\`\`${language}; examples are \`\`\`ts`)
          continue
        }
        found++
        blocks.push({ file, lines: code })
      }
      if (found === 0) problems.push(`${file}:${exampleLine}: @example has no \`\`\`ts block`)
    }
  }
}

// ── Generation ─────────────────────────────────────────────────────────

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

/** Generated file name → its line (1-based) → the JSDoc location. */
const origins = new Map<string, Map<number, string>>()
const generated: Array<string> = []

blocks.forEach((block, blockIndex) => {
  const first = block.lines.find((line) => line.text.trim() !== "")
  const skip = first === undefined ? null : skipMarker.exec(first.text)
  if (skip !== null) {
    const reason = skip[1]!.trim()
    if (reason === "") problems.push(`${block.file}:${first!.line}: \`// example-check: skip\` needs a reason`)
    else skipped.push(`${block.file}:${first!.line}: ${reason}`)
    return
  }
  const body = block.lines.filter((line) => !cutMarker.test(line.text))
  const code = body.map((line) => line.text).join("\n")
  const source = parse("example.ts", code)
  const declared = new Set(source.statements.flatMap(declaredNames))
  const header: Array<string> = []
  for (const name of usedNames(source)) {
    if (declared.has(name)) continue
    const specifier = modules.get(name)
    if (specifier !== undefined) header.push(`import * as ${name} from "${specifier}"`)
    const kind = preludeExports.get(name)
    if (kind !== undefined) header.push(`import ${kind === "type" ? "type " : ""}{ ${name} } from "../scripts/examples/prelude.ts"`)
  }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
      /\/internal(\/|$)/.test(statement.moduleSpecifier.text)) {
      const line = body[source.getLineAndCharacterOfPosition(statement.getStart()).line]!.line
      problems.push(`${block.file}:${line}: an example imports an internal module (${statement.moduleSpecifier.text}); games cannot`)
    }
  }
  const name = `${blockIndex.toString().padStart(3, "0")}-${block.file.replace(/^packages\//, "").replace(/[/.]/g, "-")}.ts`
  const lines = new Map<number, string>()
  header.forEach((_, index) => lines.set(index + 1, `${block.file}:${body[0]?.line ?? 0} (an import the checker adds)`))
  body.forEach((line, index) => lines.set(header.length + index + 1, `${block.file}:${line.line}`))
  origins.set(name, lines)
  writeFileSync(join(outDir, name), `${[...header, code].join("\n")}\nexport {}\n`)
  generated.push(name)
})

writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`)
writeFileSync(
  join(outDir, "tsconfig.json"),
  `${JSON.stringify(
    {
      extends: "../tsconfig.json",
      compilerOptions: {
        rootDir: "..",
        composite: false,
        incremental: false,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        noEmit: true,
        // Resolve the packages through their package.json `exports`, as a
        // game does (the root depends on each one): no internal modules.
        paths: {},
        types: ["node", "vite/client"]
      },
      references: [],
      include: [],
      files: ["../scripts/examples/prelude.ts", ...generated]
    },
    null,
    2
  )}\n`
)

// ── Checking ───────────────────────────────────────────────────────────

let output = ""
try {
  execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(outDir, "tsconfig.json"), "--pretty", "false"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
} catch (error) {
  const failed = error as { stdout?: string; stderr?: string }
  output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`
  if (output.trim() === "") throw error
}

let errors = 0
for (const raw of output.split("\n")) {
  if (raw.trim() === "") continue
  const match = /^(.*?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(raw)
  if (match === null) {
    // Continuation lines of a multi-line message.
    problems.push(`    ${raw.trim()}`)
    continue
  }
  errors++
  const [, path, line, , message] = match
  const generatedName = relative(outDir, join(root, path!))
  const origin = origins.get(generatedName)?.get(Number(line))
  problems.push(`${origin ?? path}: ${message!.replaceAll(`${root}/`, "")}`)
}

const checked = generated.length
if (problems.length > 0) {
  console.error(problems.join("\n"))
  console.error(
    `\nexamples: ${checked} checked, ${skipped.length} skipped, ${errors} type error(s). ` +
      "Fix the example, never the API: see scripts/check-examples.ts for how examples compile."
  )
  process.exit(1)
}
rmSync(outDir, { recursive: true, force: true })
console.log(`examples: ${checked} checked, ${skipped.length} skipped`)
for (const line of skipped) console.log(`  skipped ${line}`)
