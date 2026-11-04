import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { docsUrl, stringValue } from "../internal/ast.ts"

/** The `_tag` property of an object literal, if it has one written out. */
const isTag = (node: ESTree.Node): node is ESTree.ObjectProperty =>
  node.type === "Property" && node.kind === "init" &&
  ((!node.computed && node.key.type === "Identifier" && node.key.name === "_tag") || stringValue(node.key) === "_tag")

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
        "This sets `_tag` over a spread of `{{spread}}`: every field of the previous state survives at runtime, though the type of the new state hides it, so it comes back when the value is saved, compared, or spread again. Move an entity state with `data.state.transition(entity, { from, to, data })`, which takes the new state's fields; queue a state machine's move with the new state's fields, `nextMachines.mode.set({ _tag: \"Talking\", speaker, page: 0 })`; anywhere else, write the new state's fields out: `{ _tag: \"air\", vy, coyote }`. Spread the previous value only to change fields of the same state."
    },
    schema: []
  },
  create(context) {
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node)
    return {
      ObjectExpression(node) {
        let spread: ESTree.SpreadElement | undefined
        for (const property of node.properties) {
          if (property.type === "SpreadElement") {
            spread = property
            continue
          }
          if (spread === undefined || !isTag(property)) continue
          // `{ ...value, _tag: value._tag }` keeps the state it spreads.
          if (text(property.value) === `${text(spread.argument)}._tag`) continue
          context.report({ node: property, messageId: "spread", data: { spread: text(spread.argument) } })
        }
      }
    }
  }
})
