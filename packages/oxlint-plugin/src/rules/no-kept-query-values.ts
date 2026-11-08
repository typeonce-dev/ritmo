import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { calledMethod, docsUrl, propertyName } from "../internal/ast.ts"

type Kind = "entity" | "data"

/** Array methods whose callback's first parameter is one entity of the array they are called on. */
const callbacks = new Set(["map", "forEach", "filter", "find", "findLast", "some", "every", "flatMap"])
/** Array methods that return one entity, or entities, of the array they are called on. */
const picks = new Set(["find", "findLast", "at", "filter", "slice", "toSorted", "toReversed"])
/** Collection methods that keep their argument. */
const keeps = new Set(["push", "unshift", "add", "set"])

/** The name of a property written out: `data` in `{ data }` or `{ data: slots }`. */
const keyName = (property: { readonly computed: boolean; readonly key: ESTree.Node }): string | undefined =>
  !property.computed && property.key.type === "Identifier" ? property.key.name : undefined

/** `queries.x`: a handle of the system's queries (`queries` destructured from its context). */
const isQueryHandle = (node: ESTree.Node): boolean =>
  node.type === "MemberExpression" && propertyName(node) !== undefined &&
  node.object.type === "Identifier" && node.object.name === "queries"

/** `queries.x.each()` */
const isEach = (node: ESTree.Node): boolean =>
  node.type === "CallExpression" && calledMethod(node) === "each" && node.arguments.length === 0

/** `queries.x.data` */
const isData = (node: ESTree.Node): boolean =>
  node.type === "MemberExpression" && propertyName(node) === "data" && isQueryHandle(node.object)

/** Unwraps what passes a value through unchanged: `x!`, `(x)`, `x as T`, `a?.b`. */
const unwrap = (node: ESTree.Node): ESTree.Node => {
  let current = node
  while (
    current.type === "TSNonNullExpression" || current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" || current.type === "TSSatisfiesExpression" || current.type === "ChainExpression"
  ) current = current.expression
  return current
}

/** The root of a member chain: `local` in `local.cache.targets`. */
const rootOf = (node: ESTree.Node): ESTree.Node => {
  let current = unwrap(node)
  while (current.type === "MemberExpression") current = unwrap(current.object)
  return current
}


/** The function passed to `Game.System(...)` or `Game.Inspector(...)` that holds `node`, if any. */
const systemOf = (node: ESTree.Node): ESTree.Node | undefined => {
  let current: ESTree.Node | null | undefined = node.parent
  while (current) {
    if ((current.type === "ArrowFunctionExpression" || current.type === "FunctionExpression") && current.parent?.type === "CallExpression") {
      const method = calledMethod(current.parent)
      if ((method === "System" || method === "Inspector") && current.parent.arguments.includes(current)) return current
    }
    current = current.parent
  }
  return undefined
}

const inside = (node: ESTree.Node, outer: ESTree.Node): boolean => node.range[0] >= outer.range[0] && node.range[1] <= outer.range[1]

/**
 * An entity from `queries.x.each()` or the system's `queries.x.data` lives for
 * one run. Kept in `local` state or in a variable outside the system, the data
 * throws in the next run, and the entity keeps reading after it left the
 * query: keep the id, or read the values into plain rows.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Keep an entity's id or plain values past a run, not the entity from queries.x.each() or queries.x.data.",
      url: docsUrl("no-kept-query-values")
    },
    messages: {
      entity:
        "`{{name}}` is an entity from a query, kept past the run: in a later run it is not checked against the query again, so a runtime without `debug` reads it after it left (`without`, `with`), and a debug runtime throws. Keep {{id}} and resolve it with `queries.x.get(id)` in each run, which is fallible.",
      data:
        "`{{name}}` is a query's `data`, kept past the run: it throws when used in a later run. Read `queries.x.data` again in each run, or keep plain values from `queries.x.rows()`."
    },
    schema: []
  },
  create(context) {
    const kinds = new Map<unknown, Kind>()
    /** Variables that hold part of `local` (`const { targets } = local`): writing into them keeps the value too. */
    const localParts = new Set<unknown>()
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node)

    const variableOf = (node: ESTree.Node) =>
      context.sourceCode.getScope(node).references.find((reference) => reference.identifier === node)?.resolved ?? undefined

    /** Marks the variables `declaration` declares under `names` (a declarator, a function's parameters). */
    const mark = (declaration: ESTree.Node, names: ReadonlyArray<string>, kind: Kind): void => {
      for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
        if (names.includes(variable.name)) kinds.set(variable, kind)
      }
    }
    const namesIn = (pattern: ESTree.Node): ReadonlyArray<string> => pattern.type === "Identifier" ? [pattern.name] : []

    /** What a value is, when it is plainly one of the run's entities or data. */
    const kindOf = (expression: ESTree.Node): Kind | undefined => {
      const node = unwrap(expression)
      if (isData(node)) return "data"
      if (isEach(node)) return "entity"
      if (node.type === "Identifier") return kinds.get(variableOf(node))
      // `queries.x.each()[0]`, `.find(...)`, `.at(...)`, `.filter(...)` of entities.
      if (node.type === "MemberExpression" && node.computed) return kindOf(node.object) === "entity" ? "entity" : undefined
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && picks.has(calledMethod(node) ?? "")) {
        return kindOf(node.callee.object) === "entity" ? "entity" : undefined
      }
      if (node.type === "LogicalExpression") return kindOf(node.left) ?? kindOf(node.right)
      if (node.type === "ConditionalExpression") return kindOf(node.consequent) ?? kindOf(node.alternate)
      return undefined
    }

    /** The entity or data a kept value holds: itself, a field or element of a literal, or what a closure captures. */
    const keptIn = (expression: ESTree.Node): { readonly node: ESTree.Node; readonly kind: Kind } | undefined => {
      const node = unwrap(expression)
      const kind = kindOf(node)
      if (kind !== undefined) return { node, kind }
      if (node.type === "ObjectExpression") {
        for (const property of node.properties) {
          const found = property.type === "Property" ? keptIn(property.value) : keptIn(property.argument)
          if (found) return found
        }
      }
      if (node.type === "ArrayExpression") {
        for (const element of node.elements) {
          const found = element === null ? undefined : keptIn(element.type === "SpreadElement" ? element.argument : element)
          if (found) return found
        }
      }
      if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          if (scope.block !== node) continue
          for (const reference of scope.through) {
            const captured = kinds.get(reference.resolved)
            if (captured !== undefined) return { node: reference.identifier, kind: captured }
          }
        }
      }
      return undefined
    }

    const report = (found: { readonly node: ESTree.Node; readonly kind: Kind }): void => {
      const name = text(found.node)
      const id = found.node.type === "Identifier" ? `\`${name}.id\`` : "its `id`"
      context.report({ node: found.node, messageId: found.kind, data: found.kind === "entity" ? { name, id } : { name } })
    }

    /** Whether an expression is the system's `local` state, or a part of it. */
    const isLocal = (node: ESTree.Node): boolean => {
      const root = rootOf(node)
      if (root.type !== "Identifier") return false
      return (root.name === "local" && node.type === "MemberExpression") || localParts.has(variableOf(root))
    }

    /** Whether writing to `target` keeps the value past the run: `local` state, or a variable outside the system. */
    const outlivesRun = (target: ESTree.Node, at: ESTree.Node): boolean => {
      if (isLocal(target)) return true
      const root = rootOf(target)
      if (root.type !== "Identifier") return false
      const system = systemOf(at)
      const variable = variableOf(root)
      const declared = variable?.defs[0]?.node
      return system !== undefined && declared !== undefined && !inside(declared, system)
    }

    return {
      VariableDeclarator(node) {
        if (node.init === null || node.init === undefined) return
        const init = unwrap(node.init)
        if ((init.type === "Identifier" && init.name === "local") || isLocal(init)) {
          for (const variable of context.sourceCode.getDeclaredVariables(node)) localParts.add(variable)
          return
        }
        // `const { data } = queries.x`
        if (node.id.type === "ObjectPattern" && isQueryHandle(unwrap(node.init))) {
          for (const property of node.id.properties) {
            if (property.type === "Property" && keyName(property) === "data") mark(node, namesIn(property.value), "data")
          }
          return
        }
        const kind = kindOf(node.init)
        if (kind !== undefined) mark(node, namesIn(node.id), kind)
      },
      ForOfStatement(node) {
        if (kindOf(node.right) === "entity" && node.left.type === "VariableDeclaration") {
          for (const declaration of node.left.declarations) mark(declaration, namesIn(declaration.id), "entity")
        }
      },
      CallExpression(node) {
        const method = calledMethod(node)
        if (method === undefined || node.callee.type !== "MemberExpression") return
        // `queries.x.each().map((entity) => ...)`
        if (callbacks.has(method) && kindOf(node.callee.object) === "entity") {
          const callback = node.arguments[0]
          if (callback !== undefined && (callback.type === "ArrowFunctionExpression" || callback.type === "FunctionExpression") && callback.params[0] !== undefined) {
            mark(callback, namesIn(callback.params[0]), "entity")
          }
          return
        }
        // `local.targets.push(entity)`, `local.byId.set(id, entity)`
        if (keeps.has(method) && outlivesRun(node.callee.object, node)) {
          for (const argument of node.arguments) {
            const found = argument.type === "SpreadElement" ? undefined : keptIn(argument)
            if (found) report(found)
          }
        }
      },
      AssignmentExpression(node) {
        if (!outlivesRun(node.left, node)) return
        const found = keptIn(node.right)
        if (found) report(found)
      }
    }
  }
})
