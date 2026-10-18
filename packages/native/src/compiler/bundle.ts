import { build, type Plugin } from "esbuild"
import ts from "typescript6"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pathToFileURL } from "node:url"

/** Resolve static asset URLs at build time; QuickJS intentionally has no DOM URL global. */
export const assetURLs: Plugin = {
  name: "ritmo-static-asset-urls",
  setup(context) {
    context.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8")
      if (!source.includes("new URL")) return undefined
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true)
      const edits: Array<{ start: number; end: number; text: string }> = []
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === "href" && ts.isNewExpression(node.expression)) {
          const expr = node.expression
          const [relative, base] = expr.arguments ?? []
          if (ts.isIdentifier(expr.expression) && expr.expression.text === "URL" && relative && ts.isStringLiteral(relative) && base?.getText(file) === "import.meta.url") {
            edits.push({ start: node.getStart(file), end: node.end, text: JSON.stringify(new URL(relative.text, pathToFileURL(path)).href) })
            return
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
      let contents = source
      for (const edit of edits.sort((a, b) => b.start - a.start)) contents = contents.slice(0, edit.start) + edit.text + contents.slice(edit.end)
      return { contents, loader: path.endsWith("ts") ? "ts" : "js" }
    })
  }
}
const nativeRoot = fileURLToPath(new URL("../..", import.meta.url))
const workspaceAliases = existsSync(join(nativeRoot, "../../pnpm-workspace.yaml")) ? Object.fromEntries(["core", "browser", "render", "math", "devtools", "native"].map((name) => [name === "core" ? "@typeonce/ritmo" : `@typeonce/ritmo-${name}`, join(nativeRoot, "..", name, "src")])) : {}
export const bundle = async (entry: string, outfile: string, plugins: Plugin[] = []) => build({
  entryPoints: [entry], outfile, bundle: true, target: "es2022", platform: "neutral", format: "iife", globalName: "__ritmoGame", mainFields: ["module", "main"],
  inject: [join(nativeRoot, "src/internal/clone.ts")], alias: workspaceAliases, plugins: [...plugins, assetURLs], logLevel: "warning"
})
