import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree, Fixer, Fix } from "@oxlint/plugins"

import { docsUrl, globalMember, isGlobalReference, propertyName, stringValue } from "../internal/ast.ts"

/** The Math functions engines may approximate; each has an `Ops` counterpart. */
const approximated = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "exp", "expm1", "log", "log2", "log10", "log1p", "cbrt", "pow", "hypot",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh"
])

/** Where the type checker reads `Math` as a type: these never run. */
const typePositions = new Set(["TSTypeQuery", "TSQualifiedName", "TSTypeReference", "TSClassImplements", "TSInterfaceHeritage"])

/** The value `require("<source>")` loads, if `node` is that call. */
const requireOf = (node: ESTree.Node | null | undefined): string | undefined =>
  node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments.length === 1
    ? stringValue(node.arguments[0])
    : undefined

/** The identifier `Ops` is bound to in this file (an import or a top-level `require`), if it is. */
const opsBinding = (program: ESTree.Program): ESTree.BindingIdentifier | undefined => {
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue
      const source = statement.source.value
      for (const specifier of statement.specifiers) {
        if (source === "@typeonce/ritmo" && specifier.type === "ImportSpecifier" && specifier.importKind !== "type" &&
          specifier.imported.type === "Identifier" && specifier.imported.name === "Ops") return specifier.local
        if ((source === "@typeonce/ritmo/Ops" || /^\.{1,2}\/(.*\/)?Ops(\.ts)?$/.test(source)) && specifier.type === "ImportNamespaceSpecifier") {
          return specifier.local
        }
      }
    }
    if (statement.type !== "VariableDeclaration") continue
    for (const declarator of statement.declarations) {
      const source = requireOf(declarator.init)
      // const Ops = require("@typeonce/ritmo/Ops")
      if (source === "@typeonce/ritmo/Ops" && declarator.id.type === "Identifier") return declarator.id
      // const { Ops } = require("@typeonce/ritmo")
      if (source !== "@typeonce/ritmo" || declarator.id.type !== "ObjectPattern") continue
      for (const property of declarator.id.properties) {
        if (property.type === "Property" && propertyKey(property) === "Ops" && property.value.type === "Identifier") return property.value
      }
    }
  }
  return undefined
}

/** The static name of an object pattern or literal property (`a`, `"a"`), if it has one. */
const propertyKey = (node: ESTree.ObjectProperty | ESTree.AssignmentTargetProperty | ESTree.BindingProperty): string | undefined =>
  !node.computed && node.key.type === "Identifier" ? node.key.name : stringValue(node.key)

/** The variable `name` resolves to from `scope`, if any declaration in the file binds it. */
const resolve = (scope: ReturnType<Context["sourceCode"]["getScope"]>, name: string) => {
  for (let current: typeof scope | null = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name)
    if (variable !== undefined && variable.defs.length > 0) return variable
  }
  return undefined
}

/**
 * Whether the file is CommonJS: a `.cjs` / `.cts` file, or one with no import
 * or export that calls `require` or writes `module.exports` / `exports.`.
 */
const isCommonJs = (context: Context, program: ESTree.Program): boolean => {
  if (/\.c[jt]s$/.test(context.filename)) return true
  if (program.body.some((statement) => statement.type === "ImportDeclaration" || statement.type.startsWith("Export"))) return false
  return /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(context.sourceCode.text)
}

/** A report waiting for the end of the file, where the first fixable one also adds the `Ops` import. */
type Pending = {
  readonly node: ESTree.Node
  readonly messageId: "math" | "power" | "alias"
  readonly data?: Record<string, string>
  /**
   * The node's new text, given the local name of `Ops` and the (rewritten)
   * text of a child; none when rewriting could change behaviour.
   */
  readonly rewrite?: (ops: string, text: (child: ESTree.Node) => string) => string
}
type Fixable = Pending & Required<Pick<Pending, "rewrite">>

/**
 * Simulation code uses `Ops` from `@typeonce/ritmo` for the math functions
 * engines may approximate, so every device computes the same bits.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Use Ops from @typeonce/ritmo instead of the Math functions and `**` that differ across engines.",
      url: docsUrl("use-ops-for-math")
    },
    fixable: "code",
    messages: {
      math:
        "Math.{{name}} may return a different last bit on another browser or CPU, and the simulation grows that bit into a different run. Use `Ops.{{name}}` from `@typeonce/ritmo` (`import { Ops } from \"@typeonce/ritmo\"`), which returns the same bits everywhere. Math.sqrt, abs, min, max, floor, ceil, round, trunc, and sign are exact everywhere and stay as they are.",
      power:
        "`{{operator}}` may return a different last bit on another browser or CPU, and the simulation grows that bit into a different run. Use `Ops.pow(base, exponent)` from `@typeonce/ritmo` (`import { Ops } from \"@typeonce/ritmo\"`). Squaring stays as it is: `x ** 2` and `x * x` are exact everywhere.",
      alias:
        "This hands the global Math on as a value (an alias, a destructured function, an argument, or a computed key), which hides the calls made through it from this rule, so a function engines approximate (Math.sin, Math.pow, ...) can reach the simulation unchecked and return a different last bit on another device. Call `Ops.<name>` from `@typeonce/ritmo` directly (`import { Ops } from \"@typeonce/ritmo\"`; `Ops.sin(x)`), and read exact members by name where they are used (`Math.sqrt(x)`, `Math.PI`), or destructure only exact members (`const { abs, min, PI } = Math`)."
    },
    schema: []
  },
  create(context) {
    const pending: Array<Pending> = []

    /** Whether `node` is the global Math: `Math` or `globalThis.Math` (not a local named Math). */
    const isMath = (node: ESTree.Node): boolean =>
      node.type === "Identifier"
        ? node.name === "Math" && isGlobalReference(context, node)
        : node.type === "MemberExpression" && globalMember(context, node, "globalThis") === "Math"

    /** Whether destructuring Math with `pattern` pulls only exact members by name. */
    const pullsOnlyExact = (pattern: ESTree.Node): boolean =>
      pattern.type === "ObjectPattern" && pattern.properties.every((property) => {
        if (property.type !== "Property") return false
        const key = propertyKey(property)
        return key !== undefined && !approximated.has(key)
      })

    /** Checks one use of the global Math. */
    const checkMath = (node: ESTree.Node): void => {
      const parent = node.parent
      if (parent === null || typePositions.has(parent.type)) return
      if (parent.type === "MemberExpression" && parent.object === node) {
        const name = propertyName(parent)
        if (name === undefined) {
          pending.push({ node: parent, messageId: "alias" })
          return
        }
        if (!approximated.has(name)) return
        pending.push({ node: parent, messageId: "math", data: { name }, rewrite: (ops) => `${ops}.${name}` })
        return
      }
      if (parent.type === "VariableDeclarator" && parent.init === node && pullsOnlyExact(parent.id)) return
      if (parent.type === "AssignmentExpression" && parent.right === node && pullsOnlyExact(parent.left)) return
      if (parent.type === "BinaryExpression" && parent.operator === "in") return
      pending.push({ node, messageId: "alias" })
    }

    return {
      Identifier(node) {
        if (isMath(node)) checkMath(node)
      },
      MemberExpression(node) {
        if (isMath(node)) checkMath(node)
      },
      BinaryExpression(node) {
        if (node.operator !== "**") return
        if (node.right.type === "Literal" && node.right.value === 2) return
        pending.push({
          node,
          messageId: "power",
          data: { operator: "a ** b" },
          rewrite: (ops, text) => `${ops}.pow(${text(node.left)}, ${text(node.right)})`
        })
      },
      AssignmentExpression(node) {
        if (node.operator !== "**=") return
        if (node.right.type === "Literal" && node.right.value === 2) return
        const target = node.left
        pending.push({
          node,
          messageId: "power",
          data: { operator: "a **= b" },
          // `a.b **= c` is left alone: writing `a.b = Ops.pow(a.b, c)` evaluates `a` twice.
          ...(target.type === "Identifier"
            ? { rewrite: (ops: string, text: (child: ESTree.Node) => string) => `${target.name} = ${ops}.pow(${target.name}, ${text(node.right)})` }
            : {})
        })
      },
      "Program:exit"(program) {
        const binding = opsBinding(program)
        const ops = binding?.name ?? "Ops"
        /** Whether `Ops` (or its local name) at `node` names the binding the fix relies on. */
        const reachable = (node: ESTree.Node): boolean => {
          const variable = resolve(context.sourceCode.getScope(node), ops)
          return binding === undefined ? variable === undefined : variable?.identifiers.some((identifier) => identifier.range[0] === binding.range[0]) === true
        }
        pending.sort((a, b) => a.node.range[0] - b.node.range[0] || b.node.range[1] - a.node.range[1])
        const fixable = pending.filter((report): report is Fixable => report.rewrite !== undefined && reachable(report.node))
        /** The fixable reports inside `node` that no other one inside it holds. */
        const outermostWithin = (node: ESTree.Node): Array<Fixable> => {
          const found: Array<Fixable> = []
          for (const report of fixable) {
            const [start, end] = report.node.range
            if (report.node === node || start < node.range[0] || end > node.range[1]) continue
            const last = found[found.length - 1]
            if (last === undefined || start >= last.node.range[1]) found.push(report)
          }
          return found
        }
        /** The text of `node` with every fix inside it applied, so one fix also covers the ones it holds. */
        const text = (node: ESTree.Node): string => {
          const own = fixable.find((report) => report.node === node)
          if (own !== undefined) return rewritten(own)
          const [start] = node.range
          let source = context.sourceCode.getText(node)
          for (const inner of outermostWithin(node).reverse()) {
            source = source.slice(0, inner.node.range[0] - start) + rewritten(inner) + source.slice(inner.node.range[1] - start)
          }
          return node.type === "SequenceExpression" ? `(${source})` : source
        }
        const rewritten = (report: Fixable): string => report.rewrite(ops, text)
        const topLevel = new Map(outermostWithin(program).map((report) => [report.node, report]))
        let importAdded = binding !== undefined
        for (const { node, messageId, data } of pending) {
          const report = topLevel.get(node)
          // A fix inside another one is applied by the outer one.
          if (report === undefined) {
            context.report({ node, messageId, ...(data === undefined ? {} : { data }) })
            continue
          }
          // The first fix in the file also adds the import; it spans the code up to its node,
          // which holds no other fix, so every fix applies in the same pass.
          const addsImport = !importAdded
          importAdded = true
          const replace = (fixer: Fixer): Fix => fixer.replaceText(node, rewritten(report))
          context.report({
            node,
            messageId,
            ...(data === undefined ? {} : { data }),
            fix: (fixer) => addsImport ? [importOps(context, fixer, program), replace(fixer)] : replace(fixer)
          })
        }
      }
    }
  }
})

/**
 * Adds `import { Ops } from "@typeonce/ritmo"` after the file's last import
 * (or `const { Ops } = require("@typeonce/ritmo")` after its last top-level
 * `require` in CommonJS), or at the top after any directives.
 */
const importOps = (context: Context, fixer: Fixer, program: ESTree.Program): Fix => {
  const commonJs = isCommonJs(context, program)
  let lastLoad: ESTree.Node | undefined
  let lastDirective: ESTree.Node | undefined
  for (const statement of program.body) {
    if (statement.type === "ExpressionStatement" && typeof statement.directive === "string") lastDirective = statement
    const loads = commonJs
      ? statement.type === "VariableDeclaration" && statement.declarations.some((declarator) => requireOf(declarator.init) !== undefined)
      : statement.type === "ImportDeclaration"
    if (loads) lastLoad = statement
  }
  const anchor = lastLoad ?? lastDirective
  const reference = anchor ?? program.body[0]
  const semicolon = reference !== undefined && context.sourceCode.getText(reference).endsWith(";") ? ";" : ""
  const line = (commonJs ? "const { Ops } = require(\"@typeonce/ritmo\")" : "import { Ops } from \"@typeonce/ritmo\"") + semicolon
  if (anchor !== undefined) return fixer.insertTextAfter(anchor, `\n${line}`)
  const start = reference?.range[0] ?? 0
  return fixer.insertTextBeforeRange([start, start], `${line}\n`)
}
