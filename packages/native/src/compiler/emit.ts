import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "esbuild"
import { fileURLToPath } from "node:url"
const packageRoot = fileURLToPath(new URL("../..", import.meta.url))
import type { Analysis } from "./analyze.ts"

export const emitC = (analysis: Analysis): string => {
  const kernels = analysis.kernels.map((k) => `static void rn_kernel_${k.id}(rn_kernel_args *args) {\n${k.code}\n}`).join("\n\n")
  const counts = analysis.kernels.map((k) => `static const int rn_columns_${k.id}[]={${k.queries.map((q) => q.components.reduce((n, c) => n + (c.fields?.length ?? 1), 0)).join(",")}};\nstatic const int rn_marks_${k.id}[]={${k.queries.map((q) => q.components.filter((c) => c.write).length).join(",")}};`).join("\n")
  const entries = analysis.kernels.map((k) => `{${JSON.stringify(k.name)}, ${JSON.stringify(k.hash)}, rn_kernel_${k.id}, ${k.queries.length}, ${k.resources.reduce((n, r) => n + (r.fields?.length ?? 1), 0)}, rn_columns_${k.id}, rn_marks_${k.id}}`).join(",\n")
  return `/* Deterministic generated C11. Never enable fast-math. */\n#include "rn_kernel.h"\n${kernels}\n${counts}\nconst rn_kernel_entry rn_kernels[] = {\n${entries || '{"", "", NULL, 0, 0, NULL, NULL}'}\n};\nconst size_t rn_kernel_count = ${analysis.kernels.length};\n`
}
export const kernelTransform = (analysis: Analysis): Plugin => ({
  name: "ritmo-native-kernels",
  setup(build) {
    build.onLoad({ filter: /\.[cm]?ts$/ }, async ({ path }) => {
      const kernels = analysis.kernels.filter((k) => k.file === path)
      if (!kernels.length) return undefined
      let source = await readFile(path, "utf8")
      for (const kernel of [...kernels].sort((a, b) => b.start - a.start)) {
        const metadata = { id: kernel.id, name: kernel.name, hash: kernel.hash, layouts: kernel.layouts, queries: kernel.queries, resources: kernel.resources }
        const replacement = `__rnSystem(${kernel.game}, ${kernel.arguments.join(", ")}, ${JSON.stringify(metadata)})`
        source = source.slice(0, kernel.start) + replacement + source.slice(kernel.end)
      }
      source = `import { system as __rnSystem } from ${JSON.stringify(join(packageRoot, "src/internal/kernels.ts"))};\n` + source
      return { contents: source, loader: "ts" }
    })
  }
})
