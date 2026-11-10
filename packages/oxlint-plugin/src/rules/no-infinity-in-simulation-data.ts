import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree } from "@oxlint/plugins"

import { docsUrl, globalMember, globalPath, isGlobalIdentifier } from "../internal/ast.ts"

/** `node` without the wrappers that keep its value (`x as number`, `x!`, `(x)`). */
const unwrap = (node: ESTree.Node): ESTree.Node =>
  node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "TSSatisfiesExpression" || node.type === "ParenthesizedExpression"
    ? unwrap(node.expression)
    : node

const isNumber = (node: ESTree.Node): boolean => {
  const value = unwrap(node)
  if (value.type === "UnaryExpression" && (value.operator === "-" || value.operator === "+")) return isNumber(value.argument)
  return value.type === "Literal" && typeof value.value === "number"
}

/** Whether `node` is Infinity, -Infinity, NaN, Number's names for them, `1 / 0`, or `Math.min()` / `Math.max()` of nothing. */
const nonFinite = (context: Context, raw: ESTree.Node): boolean => {
  const node = unwrap(raw)
  if (node.type === "UnaryExpression" && (node.operator === "-" || node.operator === "+")) return nonFinite(context, node.argument)
  if (isGlobalIdentifier(context, node, "Infinity") || isGlobalIdentifier(context, node, "NaN")) return true
  if (node.type === "MemberExpression") {
    const name = globalMember(context, node, "Number")
    return name === "POSITIVE_INFINITY" || name === "NEGATIVE_INFINITY" || name === "NaN"
  }
  if (node.type === "BinaryExpression" && node.operator === "/") {
    const divisor = unwrap(node.right)
    return isNumber(node.left) && divisor.type === "Literal" && divisor.value === 0
  }
  if (node.type === "CallExpression" && node.arguments.length === 0) {
    const path = globalPath(context, node.callee)
    return path === "Math.min" || path === "Math.max"
  }
  return false
}

const comparisons = new Set(["<", "<=", ">", ">=", "===", "!==", "==", "!="])
const finiteChecks = new Set(["isFinite", "isNaN", "Number.isFinite", "Number.isNaN"])

/** Whether `node` is an operand of a comparison: `hit.time < limit`. */
const isCompared = (node: ESTree.Node): boolean => node.parent?.type === "BinaryExpression" && comparisons.has(node.parent.operator)

/**
 * Simulation data stays finite: Infinity and NaN cannot be saved, so a world
 * holding them no longer loads.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "No Infinity or NaN in simulation data: they cannot be saved and loaded.",
      url: docsUrl("no-infinity-in-simulation-data")
    },
    messages: {
      nonFinite:
        "`{{text}}` puts Infinity or NaN in data, which cannot be saved: JSON turns it into null and a number schema rejects it, so the save no longer loads (and devtools warns `non-finite-value`). Use `null` for \"never\" or \"no limit\": type the field `number | null` and give it a nullable number schema. For a value that only some entities have (a timer on a non-permanent pool), make that part optional: `timer: { remaining: number; duration: number } | null`.",
      seed:
        "`{{text}}` stores `{{name}}`, which starts as `{{value}}` and keeps it when nothing replaces it (a search that finds nothing). Infinity and NaN cannot be saved: JSON turns them into null and a number schema rejects it, so the save no longer loads (and devtools warns `non-finite-value`). Check it before storing it: `Number.isFinite({{name}}) ? {{name}} : null`, with a nullable number schema, or store what the search found instead."
    },
    schema: []
  },
  create(context) {
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node)

    /** The variable `node` names, if a declaration in the file binds it. */
    const variableOf = (node: ESTree.Node) =>
      context.sourceCode.getScope(node).references.find((reference) => reference.identifier === node)?.resolved ?? undefined

    /** Whether every use of a `const` reads a field of it to compare (`hit.time < limit`), and there is one. */
    const onlyCompared = (declarator: ESTree.VariableDeclarator): boolean => {
      const [variable] = context.sourceCode.getDeclaredVariables(declarator)
      const uses = variable?.references.filter((reference) => reference.identifier !== declarator.id) ?? []
      return uses.length > 0 && uses.every((reference) => {
        const read = reference.identifier.parent
        return read?.type === "MemberExpression" && read.object === reference.identifier && isCompared(read)
      })
    }

    /**
     * Whether a literal is local scratch, never stored: a search seed in a
     * `let` (overwritten before anything is stored), a fallback in a function
     * only compared (`(sweep ?? { time: Infinity }).time < limit`), values a
     * `for...of` tries one by one, or a part of one of these.
     */
    const isScratch = (literal: ESTree.Node): boolean => {
      let node = literal
      let parent = node.parent
      while (
        parent !== null &&
        ((parent.type === "TSAsExpression" || parent.type === "TSNonNullExpression" || parent.type === "TSSatisfiesExpression" || parent.type === "ParenthesizedExpression") ||
          (parent.type === "LogicalExpression" && parent.right === node) ||
          (parent.type === "ConditionalExpression" && parent.test !== node))
      ) {
        node = parent
        parent = node.parent
      }
      if (parent === null) return false
      if (parent.type === "Property" && parent.value === node && parent.parent.type === "ObjectExpression") return isScratch(parent.parent)
      if (parent.type === "ArrayExpression") return isScratch(parent)
      if (parent.type === "MemberExpression" && parent.object === node) return isCompared(parent)
      // `for (const size of [0, Infinity])`: values tried one by one, a local each time.
      if (parent.type === "ForOfStatement" && parent.right === node) return true
      if (parent.type !== "VariableDeclarator" || parent.init !== node || parent.id.type !== "Identifier") return false
      const declaration = parent.parent
      if (declaration.type !== "VariableDeclaration") return false
      if (declaration.kind === "let") return true
      return declaration.kind === "const" && context.sourceCode.getScope(parent).variableScope.type !== "module" && onlyCompared(parent)
    }

    /** The non-finite value a variable is declared with (`let best = Infinity`, `const LIMIT = Infinity`), if it is. */
    const declaredAs = (node: ESTree.Node): { readonly value: string; readonly kind: string } | undefined => {
      const variable = variableOf(node)
      const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined
      if (definition?.type !== "Variable" || definition.node.type !== "VariableDeclarator" || definition.node.id.type !== "Identifier") return undefined
      const init = definition.node.init
      if (init === null || init === undefined || !nonFinite(context, init) || definition.parent?.type !== "VariableDeclaration") return undefined
      return { value: text(init), kind: definition.parent.kind }
    }

    /** Whether the code checks a variable against Infinity or NaN before relying on it (`best === Infinity`, `Number.isFinite(best)`). */
    const isChecked = (node: ESTree.Node): boolean =>
      variableOf(node)?.references.some((reference) => {
        const use = reference.identifier
        const parent = use.parent
        if (parent?.type === "BinaryExpression" && comparisons.has(parent.operator)) {
          return nonFinite(context, parent.left === use ? parent.right : parent.left)
        }
        if (parent?.type === "CallExpression" && parent.arguments.some((argument) => argument === use)) return finiteChecks.has(globalPath(context, parent.callee) ?? "")
        return false
      }) ?? false

    /** Reports a value stored in a literal (`at` is the property or the element) that holds Infinity or NaN. */
    const check = (value: ESTree.Node, at: ESTree.Node): void => {
      const node = unwrap(value)
      if (nonFinite(context, node)) {
        context.report({ node: at, messageId: "nonFinite", data: { text: text(at) } })
        return
      }
      // `make(Infinity)`: whatever it builds from Infinity is stored. Math and Number give back numbers.
      if (node.type === "CallExpression" && node.arguments.some((argument) => nonFinite(context, argument))) {
        const path = globalPath(context, node.callee)
        if (path === undefined || !(path.startsWith("Math.") || path.startsWith("Number."))) {
          context.report({ node: at, messageId: "nonFinite", data: { text: text(at) } })
        }
        return
      }
      if (node.type !== "Identifier") return
      const declared = declaredAs(node)
      if (declared === undefined) return
      // `const LIMIT = Infinity` is Infinity; `let best = Infinity` is a seed the search may replace, so a check before storing it is enough.
      if (declared.kind === "const") context.report({ node: at, messageId: "nonFinite", data: { text: text(at) } })
      else if (!isChecked(node)) context.report({ node: at, messageId: "seed", data: { text: text(at), name: node.name, value: declared.value } })
    }

    return {
      Property(node) {
        if (node.kind !== "init" || node.parent.type !== "ObjectExpression" || isScratch(node.parent)) return
        check(node.value, node)
      },
      ArrayExpression(node) {
        if (isScratch(node)) return
        for (const element of node.elements) {
          if (element !== null && element.type !== "SpreadElement") check(element, element)
        }
      }
    }
  }
})
