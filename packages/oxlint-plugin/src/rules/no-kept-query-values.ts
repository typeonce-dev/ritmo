import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { calledMethod, docsUrl, globalPath, propertyKey, propertyName } from "../internal/ast.ts"

type Kind = "entity" | "data"

/** Array methods whose callback's first parameter is one entity of the array they are called on. */
const callbacks = new Set(["map", "forEach", "filter", "find", "findLast", "some", "every", "flatMap"])
/** Array methods that return one entity, or entities, of the array they are called on. */
const picks = new Set(["find", "findLast", "at", "filter", "slice", "toSorted", "toReversed"])
/** Array methods that return what their callback returns, for each entity. */
const maps = new Set(["map", "flatMap"])
/** Collection methods that keep their argument. */
const keeps = new Set(["push", "unshift", "add", "set"])

/** `queries.x.each()` */
const isEach = (node: ESTree.Node): boolean =>
  node.type === "CallExpression" && calledMethod(node) === "each" && node.arguments.length === 0

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

const isFunction = (node: ESTree.Node | null | undefined): node is ESTree.ArrowFunctionExpression | ESTree.Function =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression" || node?.type === "FunctionDeclaration"

/** Whether `call` is `Game.System(...)` or `Game.Inspector(...)`. */
const isSystemCall = (call: ESTree.Node | null | undefined): call is ESTree.CallExpression => {
  if (call?.type !== "CallExpression") return false
  const method = calledMethod(call)
  return method === "System" || method === "Inspector"
}

/** The expressions a function returns: its expression body, or the `return`s of its body's own statements. */
const returnedBy = (fn: ESTree.Node): ReadonlyArray<ESTree.Node> => {
  if (!isFunction(fn) || fn.body === null) return []
  if (fn.body.type !== "BlockStatement") return [fn.body]
  const found: Array<ESTree.Node> = []
  const visit = (statement: ESTree.Node | null | undefined): void => {
    if (statement === null || statement === undefined) return
    if (statement.type === "ReturnStatement" && statement.argument !== null) found.push(statement.argument)
    if (statement.type === "BlockStatement") statement.body.forEach(visit)
    if (statement.type === "IfStatement") {
      visit(statement.consequent)
      visit(statement.alternate)
    }
  }
  fn.body.body.forEach(visit)
  return found
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
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node)

    const variableOf = (node: ESTree.Node) =>
      context.sourceCode.getScope(node).references.find((reference) => reference.identifier === node)?.resolved ?? undefined

    /** Functions declared apart and passed to `Game.System(...)` by name (`Game.System(name, spec, run)`). */
    let named: Set<ESTree.Node> | undefined
    const namedSystems = (): Set<ESTree.Node> => {
      if (named !== undefined) return named
      named = new Set()
      for (const scope of context.sourceCode.scopeManager.scopes) {
        for (const reference of scope.references) {
          const call = reference.identifier.parent
          if (!isSystemCall(call) || !call.arguments.some((argument) => argument === reference.identifier)) continue
          for (const definition of reference.resolved?.defs ?? []) {
            if (definition.type === "FunctionName") named.add(definition.node)
            if (definition.type === "Variable" && definition.node.type === "VariableDeclarator" && isFunction(definition.node.init)) named.add(definition.node.init)
          }
        }
      }
      return named
    }

    /** Whether `fn` is a system's or an inspector's run: passed to `Game.System(...)` inline or by name. */
    const isSystem = (fn: ESTree.Node): boolean =>
      isFunction(fn) && ((isSystemCall(fn.parent) && fn.parent.arguments.some((argument) => argument === fn)) || namedSystems().has(fn))

    /** The system function that holds `node`, if any. */
    const systemOf = (node: ESTree.Node): ESTree.Node | undefined => {
      for (let current = node.parent; current; current = current.parent) if (isSystem(current)) return current
      return undefined
    }

    /** The keys from the top of a destructuring `pattern` down to `binding` in it (`["queries", "x"]` for `x` in `{ queries: { x } }`). */
    const keysTo = (binding: ESTree.Node, pattern: ESTree.Node): ReadonlyArray<string> | undefined => {
      const keys: Array<string> = []
      let current = binding
      while (current !== pattern) {
        const parent = current.parent
        if (parent === null) return undefined
        if (parent.type === "AssignmentPattern" && parent.left === current) {
          current = parent
          continue
        }
        if (parent.type !== "Property" || parent.value !== current || parent.parent.type !== "ObjectPattern") return undefined
        const key = propertyKey(parent)
        if (key === undefined) return undefined
        keys.unshift(key)
        current = parent.parent
      }
      return keys
    }

    /**
     * The part of the system's context an expression reads, as keys
     * (`["queries", "x"]` for `queries.x`, `q.x` after `({ queries: q })`,
     * `x` after `({ queries: { x } })`, and `ctx.queries.x`), when it reads
     * one. A name `queries` or `local` that resolves to nothing else is read
     * as that part.
     */
    const contextPath = (expression: ESTree.Node): ReadonlyArray<string> | undefined => {
      const node = unwrap(expression)
      if (node.type === "MemberExpression") {
        const name = propertyName(node)
        const object = name === undefined ? undefined : contextPath(node.object)
        return object === undefined || name === undefined ? undefined : [...object, name]
      }
      if (node.type !== "Identifier") return undefined
      const fallback = node.name === "queries" || node.name === "local" ? [node.name] : undefined
      const definition = variableOf(node)?.defs[0]
      if (definition === undefined) return fallback
      if (definition.type === "Parameter" && isSystem(definition.node)) {
        const param = (definition.node as ESTree.ArrowFunctionExpression | ESTree.Function).params[0]
        return param === undefined ? fallback : keysTo(definition.name, param) ?? fallback
      }
      if (definition.type === "Variable" && definition.node.type === "VariableDeclarator" && definition.node.init !== null && definition.node.init !== undefined) {
        const keys = keysTo(definition.name, definition.node.id)
        const from = keys === undefined ? undefined : contextPath(definition.node.init)
        return from === undefined || keys === undefined ? fallback : [...from, ...keys]
      }
      return fallback
    }

    /** `queries.x.data`, however the context was destructured. */
    const isData = (node: ESTree.Node): boolean => {
      const path = contextPath(node)
      return path?.length === 3 && path[0] === "queries" && path[2] === "data"
    }

    /** Marks the variables `declaration` declares under `names` (a declarator, a function's parameters). */
    const mark = (declaration: ESTree.Node, names: ReadonlyArray<string>, kind: Kind): void => {
      for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
        if (names.includes(variable.name)) kinds.set(variable, kind)
      }
    }
    /** The names a binding declares for the value itself or its elements: `entity`, or `first` and `rest` in `[first, ...rest]`. */
    const namesIn = (pattern: ESTree.Node): ReadonlyArray<string> => {
      if (pattern.type === "Identifier") return [pattern.name]
      if (pattern.type === "AssignmentPattern") return namesIn(pattern.left)
      if (pattern.type === "RestElement") return namesIn(pattern.argument)
      if (pattern.type === "ArrayPattern") return pattern.elements.flatMap((element) => (element === null ? [] : namesIn(element)))
      return []
    }
    /** Marks the `index`th parameter of a callback over entities as an entity. */
    const markCallback = (callback: ESTree.Node | undefined, index: number): void => {
      if (callback === undefined || !isFunction(callback)) return
      const param = callback.params[index]
      if (param !== undefined) mark(callback, namesIn(param), "entity")
    }
    /** What a callback over entities returns: an entity, data, or neither (`(entity) => entity.id`). */
    const returnKind = (callback: ESTree.Node | undefined): Kind | undefined => {
      if (callback === undefined) return undefined
      for (const returned of returnedBy(callback)) {
        const found = keptIn(returned)
        if (found) return found.kind
      }
      return undefined
    }

    /** What a value is, when it is plainly one of the run's entities or data. */
    const kindOf = (expression: ESTree.Node): Kind | undefined => {
      const node = unwrap(expression)
      if (isData(node)) return "data"
      if (isEach(node)) return "entity"
      if (node.type === "Identifier") return kinds.get(variableOf(node))
      // `queries.x.each()[0]`, `.find(...)`, `.at(...)`, `.filter(...)` of entities.
      if (node.type === "MemberExpression" && node.computed) return kindOf(node.object) === "entity" ? "entity" : undefined
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
        const method = calledMethod(node) ?? ""
        // `Array.from(queries.x.each())`, or what its map returns.
        if (globalPath(context, node.callee) === "Array.from") {
          const [source, map] = node.arguments
          if (source === undefined || source.type === "SpreadElement" || kindOf(source) !== "entity") return undefined
          if (map === undefined) return "entity"
          markCallback(map, 0)
          return returnKind(map)
        }
        if (kindOf(node.callee.object) !== "entity") return undefined
        if (picks.has(method)) return "entity"
        // `.map((entity) => entity)`: whatever the callback returns for each entity.
        if (maps.has(method)) {
          markCallback(node.arguments[0], 0)
          return returnKind(node.arguments[0])
        }
        // `.reduce((best, entity) => ...)`: what the callback returns, or the initial value.
        if (method === "reduce" || method === "reduceRight") {
          const [reducer, initial] = node.arguments
          markCallback(reducer, 1)
          return returnKind(reducer) ?? (initial === undefined || initial.type === "SpreadElement" ? undefined : kindOf(initial))
        }
        return undefined
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
            const captured = kinds.get(reference.resolved) ?? (isData(reference.identifier) ? "data" : undefined)
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

    /** Whether an expression is the system's `local` state (`whole`), or a part of it (`local.x`, `targets` after `const { targets } = local`). */
    const isLocal = (node: ESTree.Node, whole = false): boolean => {
      // `local.byId[key]` has no static path: its object `local.byId` does.
      for (let current = unwrap(node), depth = 0; ; current = unwrap(current.object), depth += 1) {
        const path = contextPath(current)
        if (path !== undefined) return path[0] === "local" && (whole || path.length + depth >= 2)
        if (current.type !== "MemberExpression") return false
      }
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
        // `const [first] = queries.x.each()`
        const kind = kindOf(node.init)
        if (kind !== undefined) mark(node, namesIn(node.id), kind)
      },
      ForOfStatement(node) {
        if (kindOf(node.right) === "entity" && node.left.type === "VariableDeclaration") {
          for (const declaration of node.left.declarations) mark(declaration, namesIn(declaration.id), "entity")
        }
      },
      CallExpression(node) {
        // `Object.assign(local, { target: entity })`
        if (globalPath(context, node.callee) === "Object.assign") {
          const [target, ...sources] = node.arguments
          if (target === undefined || target.type === "SpreadElement" || !(isLocal(target, true) || outlivesRun(target, node))) return
          for (const source of sources) {
            const found = source.type === "SpreadElement" ? undefined : keptIn(source)
            if (found) report(found)
          }
          return
        }
        const method = calledMethod(node)
        if (method === undefined || node.callee.type !== "MemberExpression") return
        // `queries.x.each().map((entity) => ...)`
        if (callbacks.has(method) && kindOf(node.callee.object) === "entity") {
          markCallback(node.arguments[0], 0)
          return
        }
        if ((method === "reduce" || method === "reduceRight") && kindOf(node.callee.object) === "entity") {
          markCallback(node.arguments[0], 1)
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
