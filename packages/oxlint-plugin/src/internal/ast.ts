import type { Context, ESTree } from "@oxlint/plugins"

/** The README section of a rule, linked from every report. */
export const docsUrl = (rule: string): string =>
  `https://github.com/typeonce-dev/ritmo/blob/main/packages/oxlint-plugin/README.md#ritmo${rule}`

/** The name a member expression reads (`a.b` or `a["b"]`), if it is static. */
export const propertyName = (node: ESTree.MemberExpression): string | undefined => {
  if (!node.computed && node.property.type === "Identifier") return node.property.name
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") return node.property.value
  return undefined
}

/**
 * Whether `node` reads a global: a reference that no declaration in the file
 * resolves (or that resolves only to a configured global). Property keys,
 * declarations, and locals that shadow a global are not.
 *
 * (`sourceCode.isGlobalReference` only counts globals declared in the lint
 * environment, so rules using it would depend on each game's `env` setting.)
 */
export const isGlobalReference = (context: Context, node: ESTree.Node): boolean => {
  if (node.type !== "Identifier") return false
  const reference = context.sourceCode.getScope(node).references.find((candidate) => candidate.identifier === node)
  return reference !== undefined && (reference.resolved === null || reference.resolved.defs.length === 0)
}

/**
 * The property `node` reads from the global `object` (`Math.random`,
 * `Math["random"]`), or `undefined` when it reads something else or `object`
 * is a local binding that shadows the global.
 */
export const globalMember = (context: Context, node: ESTree.MemberExpression, object: string): string | undefined => {
  if (node.object.type !== "Identifier" || node.object.name !== object) return undefined
  if (!isGlobalReference(context, node.object)) return undefined
  return propertyName(node)
}

/** Objects whose members are the globals themselves: `globalThis.Math` is `Math`. */
const globalObjects = new Set(["globalThis", "self", "window"])

/** Where the type checker reads a name as a type: these never run. */
export const typePositions = new Set(["TSTypeQuery", "TSQualifiedName", "TSTypeReference", "TSClassImplements", "TSInterfaceHeritage"])

/** The static name of an object pattern or literal property (`a`, `"a"`), if it has one. */
export const propertyKey = (node: ESTree.ObjectProperty | ESTree.AssignmentTargetProperty | ESTree.BindingProperty): string | undefined =>
  !node.computed && node.key.type === "Identifier" ? node.key.name : stringValue(node.key)

/** The path of member `name` of the global at `object`: a member of `globalThis`, `self`, or `window` is the global itself. */
const memberOf = (object: string, name: string): string => (globalObjects.has(object) ? name : `${object}.${name}`)

/**
 * The global `node` refers to, as a path (`Math`, `Math.random`,
 * `Temporal.Now`), or `undefined` when it refers to anything else. It
 * resolves:
 * - a global name that no local, parameter, or import shadows (`Math`;
 *   `globalThis`, `self`, and `window` give their own name);
 * - a static member of one (`Math.random`, `Math["random"]`), where a member
 *   of `globalThis`, `self`, or `window` is that global (`globalThis.Math`
 *   and `self.window.Math` give `Math`);
 * - a `const` that holds one (`const M = Math` makes `M` give `Math`), or a
 *   property destructured from one in a `const` (`const { now: n } = Date`
 *   makes `n` give `Date.now`).
 *
 * A name in a type (`let at: Date`, `typeof Math`) runs nothing and gives
 * `undefined`. Values passed through functions or other modules are not
 * followed.
 */
export const globalPath = (context: Context, node: ESTree.Node, seen = new Set<ESTree.Node>()): string | undefined => {
  // `const a = b, b = a` refers to nothing.
  if (seen.has(node)) return undefined
  seen.add(node)
  if (node.type === "MemberExpression") {
    const name = propertyName(node)
    const object = name === undefined ? undefined : globalPath(context, node.object, seen)
    return object === undefined || name === undefined ? undefined : memberOf(object, name)
  }
  if (node.type !== "Identifier" || typePositions.has(node.parent.type)) return undefined
  const reference = context.sourceCode.getScope(node).references.find((candidate) => candidate.identifier === node)
  if (reference === undefined) return undefined
  const variable = reference.resolved
  if (variable === null || variable.defs.length === 0) return node.name
  const [definition] = variable.defs
  if (variable.defs.length !== 1 || definition?.type !== "Variable") return undefined
  if (definition.parent?.type !== "VariableDeclaration" || definition.parent.kind !== "const") return undefined
  return bindingPath(context, definition.name, seen)
}

/** The global a `const` binding holds: the whole value (`M` in `const M = Math`) or a property destructured from it. */
const bindingPath = (context: Context, binding: ESTree.Node, seen: Set<ESTree.Node>): string | undefined => {
  const parent = binding.parent
  if (parent === null) return undefined
  if (parent.type === "VariableDeclarator" && parent.id === binding) return parent.init === null ? undefined : globalPath(context, parent.init, seen)
  if (parent.type === "Property" && parent.value === binding) return propertyPath(context, parent, seen)
  if (parent.type === "AssignmentPattern" && parent.left === binding && parent.parent.type === "Property") return propertyPath(context, parent.parent, seen)
  // `const { ...rest } = Math`: the rest holds Math's other members.
  if (parent.type === "RestElement" && parent.parent.type === "ObjectPattern") return patternPath(context, parent.parent, seen)
  return undefined
}

/** The global an object pattern destructures (`Date` in `const { now } = Date`), also when nested in another pattern. */
const patternPath = (context: Context, pattern: ESTree.Node, seen: Set<ESTree.Node>): string | undefined => {
  const parent = pattern.parent
  if (parent === null) return undefined
  if (parent.type === "VariableDeclarator" && parent.id === pattern) return parent.init === null ? undefined : globalPath(context, parent.init, seen)
  if (parent.type === "AssignmentExpression" && parent.left === pattern) return globalPath(context, parent.right, seen)
  if (parent.type === "Property" && parent.value === pattern) return propertyPath(context, parent, seen)
  if (parent.type === "AssignmentPattern" && parent.left === pattern && parent.parent.type === "Property") return propertyPath(context, parent.parent, seen)
  return undefined
}

/** The global a property of an object pattern reads (`Date.now` for `now` in `const { now } = Date`). */
const propertyPath = (context: Context, property: ESTree.Node, seen: Set<ESTree.Node>): string | undefined => {
  if (property.type !== "Property" || property.parent.type !== "ObjectPattern") return undefined
  const key = propertyKey(property)
  const object = key === undefined ? undefined : patternPath(context, property.parent, seen)
  return object === undefined || key === undefined ? undefined : memberOf(object, key)
}

/** A global read at one spot: its path (see `globalPath`), and the path of the global it is a member of. */
export interface GlobalRead {
  readonly path: string
  /** The global the read takes a member of (`window` for `window.innerWidth`); none for a bare name. */
  readonly from?: string
}

/**
 * The global `node` reads where it stands: a member of one
 * (`globalThis.Date.now`, `M.random` after `const M = Math`), a property
 * destructured from one (`now` in `const { now } = Date`), or a global name
 * itself (`setTimeout`). A `const` holding a global (`M`, or `n` after
 * `const { now: n } = Date`) gives `undefined`: the global was read where the
 * `const` was declared, and a rule reports it there.
 */
export const globalRead = (context: Context, node: ESTree.Node): GlobalRead | undefined => {
  if (node.type === "MemberExpression") {
    const name = propertyName(node)
    const from = name === undefined ? undefined : globalPath(context, node.object)
    return from === undefined || name === undefined ? undefined : { path: memberOf(from, name), from }
  }
  if (node.type === "Property") {
    const key = node.parent.type === "ObjectPattern" ? propertyKey(node) : undefined
    const from = key === undefined ? undefined : patternPath(context, node.parent, new Set())
    return from === undefined || key === undefined ? undefined : { path: memberOf(from, key), from }
  }
  if (node.type === "Identifier" && !typePositions.has(node.parent.type) && isGlobalReference(context, node)) return { path: node.name }
  return undefined
}

/** Whether `node` names the global `name` (not a local binding, property key, or type). */
export const isGlobalIdentifier = (context: Context, node: ESTree.Node, name: string): boolean =>
  node.type === "Identifier" && node.name === name && isGlobalReference(context, node)

/** The method name a call invokes (`x.tick(...)` gives `tick`). */
export const calledMethod = (node: ESTree.CallExpression): string | undefined =>
  node.callee.type === "MemberExpression" ? propertyName(node.callee) : undefined

/** The last name in a receiver chain (`runtime`, `t.runtime`, `this.runtime` all give `runtime`). */
export const receiverName = (node: ESTree.Node): string | undefined => {
  if (node.type === "Identifier") return node.name
  if (node.type === "MemberExpression") return propertyName(node)
  return undefined
}

/** Whether an import (or re-export) brings in only types, which never run. */
export const importsOnlyTypes = (node: ESTree.ImportDeclaration): boolean =>
  node.importKind === "type" ||
  (node.specifiers.length > 0 &&
    node.specifiers.every((specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type"))

/** A string literal's value. */
export const stringValue = (node: ESTree.Node | undefined): string | undefined =>
  node !== undefined && node.type === "Literal" && typeof node.value === "string" ? node.value : undefined
