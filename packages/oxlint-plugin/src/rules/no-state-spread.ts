import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { calledMethod, docsUrl, globalPath, propertyKey, propertyName, receiverName, stringValue } from "../internal/ast.ts"

/** The `_tag` property of an object literal, if it has one written out. */
const isTag = (node: ESTree.Node): node is ESTree.ObjectProperty =>
  node.type === "Property" && node.kind === "init" &&
  ((!node.computed && node.key.type === "Identifier" && node.key.name === "_tag") || stringValue(node.key) === "_tag")

const unwrap = (node: ESTree.Node): ESTree.Node =>
  node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "TSSatisfiesExpression" || node.type === "ParenthesizedExpression" || node.type === "ChainExpression"
    ? unwrap(node.expression)
    : node

/** One part of a value being built, in order: a field written out, or a value spread into it. */
type Part = { readonly tag: ESTree.ObjectProperty } | { readonly spread: ESTree.Node }

/** The parts of an object literal, with literals spread into it read as their own parts (`{ ...a, ...{ _tag } }`). */
const partsOf = (literal: ESTree.ObjectExpression): ReadonlyArray<Part> =>
  literal.properties.flatMap((property): ReadonlyArray<Part> => {
    if (property.type === "SpreadElement") {
      const argument = unwrap(property.argument)
      return argument.type === "ObjectExpression" ? partsOf(argument) : [{ spread: property.argument }]
    }
    return isTag(property) ? [{ tag: property }] : []
  })

/** The function (or the program) `node` is in. */
const functionOf = (node: ESTree.Node): ESTree.Node | undefined => {
  let current = node.parent
  while (current !== null && current.type !== "ArrowFunctionExpression" && current.type !== "FunctionExpression" && current.type !== "FunctionDeclaration" && current.type !== "Program") {
    current = current.parent
  }
  return current ?? undefined
}

/**
 * A tagged value changes state by writing the new state's fields, never by
 * re-tagging a spread of the old one: the old state's fields would survive at
 * runtime while the type hides them.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Build a new state's value from its own fields, not by spreading the previous state and changing `_tag`.",
      url: docsUrl("no-state-spread")
    },
    messages: {
      spread:
        "This sets `_tag` over a spread of `{{spread}}`: every field of the previous state survives at runtime, though the type of the new state hides it, so it comes back when the value is saved, compared, or spread again. Move an entity state with `data.state.transition(entity, { from, to, data })`, which takes the new state's fields; queue a state machine's move with `nextMachines.mode.transition({ from, to, data })`, which takes them too; anywhere else, write the new state's fields out: `{ _tag: \"air\", vy, coyote }`. Spread the previous value only to change fields of the same state."
    },
    schema: []
  },
  create(context) {
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node)
    /** Values built by parts, checked at the end, once every `_tag` read and slot move of the file is known. */
    const built: Array<ReadonlyArray<Part>> = []
    /** `x._tag` reads, by the function they are in and the text of `x`. */
    const tagReads = new Set<string>()
    /** Slots moved as entity states (`data.contact.transition(...)`), by function and slot text. */
    const movedSlots = new Set<string>()
    const ids = new Map<ESTree.Node, number>()
    const scoped = (at: ESTree.Node, key: string): string => {
      const fn = functionOf(at)
      if (fn !== undefined && !ids.has(fn)) ids.set(fn, ids.size)
      return `${fn === undefined ? -1 : ids.get(fn)}:${key}`
    }

    const variableOf = (node: ESTree.Node) =>
      context.sourceCode.getScope(node).references.find((reference) => reference.identifier === node)?.resolved ?? undefined

    /** The declarator that binds `node` (a `let` or `const` in the file), and the binding in its pattern. */
    const declaratorOf = (node: ESTree.Node) => {
      const definition = node.type === "Identifier" ? variableOf(node)?.defs[0] : undefined
      return definition?.type === "Variable" && definition.node.type === "VariableDeclarator" ? { declarator: definition.node, name: definition.name } : undefined
    }

    /** Whether `node` reads a state machine's value: `machines.x.get()`, `nextMachines.x.getPending()`. */
    const isMachineRead = (node: ESTree.Node): boolean => {
      if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.arguments.length > 0) return false
      const machine = unwrap(node.callee.object)
      if (machine.type !== "MemberExpression") return false
      const view = receiverName(unwrap(machine.object))
      const method = calledMethod(node)
      return (method === "get" && view === "machines") || (method === "getPending" && view === "nextMachines")
    }

    /** Whether `node` reads an entity state's slot that the same function moves: `data.contact.get(entity)` next to `data.contact.transition(...)`. */
    const isStateSlotRead = (node: ESTree.Node): boolean =>
      node.type === "CallExpression" && calledMethod(node) === "get" && node.callee.type === "MemberExpression" &&
      movedSlots.has(scoped(node, text(unwrap(node.callee.object))))

    /** Whether the destructuring that binds `name` takes `_tag` out: `rest` in `const { _tag, ...rest } = ground`. */
    const isTaglessRest = (node: ESTree.Node): boolean => {
      const found = declaratorOf(node)
      const rest = found?.name.parent
      return rest?.type === "RestElement" && rest.parent.type === "ObjectPattern" &&
        rest.parent.properties.some((property) => property.type === "Property" && propertyKey(property) === "_tag")
    }

    /**
     * Whether the file shows that `raw` is a state's value: read from a state
     * machine or a moved entity state slot (directly or through the variable
     * it was stored in), or a value whose `_tag` the same function reads
     * (`if (body._tag === "ground")`, `switch (state._tag)`, `const { _tag } = previous`).
     */
    const isState = (raw: ESTree.Node, at: ESTree.Node): boolean => {
      const node = unwrap(raw)
      if (isMachineRead(node) || isStateSlotRead(node)) return true
      if (tagReads.has(scoped(at, text(node)))) return true
      if (node.type !== "Identifier") return false
      const variable = variableOf(node)
      if (variable?.references.some((reference) => {
        const parent = reference.identifier.parent
        // `x._tag`, wherever the variable is read
        if (parent?.type === "MemberExpression" && parent.object === reference.identifier && propertyName(parent) === "_tag") return true
        // `const { _tag } = x`
        return parent?.type === "VariableDeclarator" && parent.init === reference.identifier && parent.id.type === "ObjectPattern" &&
          parent.id.properties.some((property) => property.type === "Property" && propertyKey(property) === "_tag")
      })) return true
      const found = declaratorOf(node)
      const init = found?.declarator.id === found?.name ? found?.declarator.init : undefined
      return init !== undefined && init !== null && (isMachineRead(unwrap(init)) || isStateSlotRead(unwrap(init)))
    }

    const check = (parts: ReadonlyArray<Part>): void => {
      const spreads = parts.flatMap((part, index) => ("spread" in part ? [{ node: part.spread, index }] : []))
      for (const [index, part] of parts.entries()) {
        if (!("tag" in part)) continue
        // The state spread before this `_tag`. A `_tag` before a spread names the state the spread's fields are, unless they are a rest
        // that took its tag out and the new tag names a state (`{ _tag: "air", ...rest }`; `{ _tag: tag, ...rest }` may put the same one back).
        const state = spreads.filter((spread) => spread.index < index && isState(spread.node, part.tag)).at(-1) ??
          (stringValue(unwrap(part.tag.value)) === undefined ? undefined : spreads.find((spread) => isTaglessRest(unwrap(spread.node))))
        if (state === undefined) continue
        // `{ ...value, _tag: value._tag }` keeps the state it spreads.
        if (text(part.tag.value) === `${text(state.node)}._tag`) continue
        context.report({ node: part.tag, messageId: "spread", data: { spread: text(state.node) } })
      }
    }

    return {
      MemberExpression(node) {
        if (propertyName(node) === "_tag") tagReads.add(scoped(node, text(unwrap(node.object))))
      },
      CallExpression(node) {
        const method = calledMethod(node)
        // `data.contact.transition(entity, { from, to })`, `data.contact.update(entity, { state, data })`: an entity state's slot.
        if (node.callee.type === "MemberExpression" && node.arguments.length === 2 && (method === "transition" || method === "update")) {
          const move = node.arguments[1]
          if (method === "transition" || (move?.type === "ObjectExpression" && move.properties.some((property) => property.type === "Property" && propertyKey(property) === "state"))) {
            movedSlots.add(scoped(node, text(unwrap(node.callee.object))))
          }
        }
        // `Object.assign({}, ground, { _tag: "air" })`
        if (globalPath(context, node.callee) === "Object.assign") {
          built.push(node.arguments.flatMap((argument): ReadonlyArray<Part> => {
            if (argument.type === "SpreadElement") return []
            const value = unwrap(argument)
            return value.type === "ObjectExpression" ? partsOf(value) : [{ spread: argument }]
          }))
        }
      },
      ObjectExpression(node) {
        // A literal spread into another is checked as part of it.
        if (node.parent.type === "SpreadElement" && node.parent.parent.type === "ObjectExpression") return
        built.push(partsOf(node))
      },
      "Program:exit"() {
        for (const parts of built) check(parts)
      }
    }
  }
})
