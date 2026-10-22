import { defineRule } from "@oxlint/plugins"

import { calledMethod, docsUrl, receiverName } from "../internal/ast.ts"

interface Options {
  readonly runtimePattern?: string
}

/**
 * The result of `runtime.tick(...)` and `runtime.restore(...)` is read: a
 * failed system or an invalid save comes back as data, and dropping it hides
 * the failure.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Check the Result of runtime.tick(...), tryTick(...), and restore(...) instead of dropping it.",
      url: docsUrl("handle-tick-result")
    },
    messages: {
      tick:
        "The result of `{{call}}(...)` is dropped. A system that fails stops the tick and returns the failure here, so it goes unnoticed and the world is left half-updated. Check it: `const ran = {{call}}(...); if (ran._tag === \"Failure\") ...` (`ran.failure` names the system and why). Write `void {{call}}(...)` to ignore it on purpose.",
      restore:
        "The result of `{{call}}(...)` is dropped. A save that fails to load leaves the previous world in place, unnoticed. Check it: `const restored = {{call}}(data); if (restored._tag === \"Failure\") ...` (`restored.failure` says what was invalid). Write `void {{call}}(...)` to ignore it on purpose."
    },
    schema: [
      {
        type: "object",
        properties: {
          runtimePattern: {
            type: "string",
            description: "A regular expression (case-insensitive) the receiver's name must match to be treated as a Ritmo runtime. Defaults to `runtime$`."
          }
        },
        additionalProperties: false
      }
    ]
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options
    const runtime = new RegExp(options.runtimePattern ?? "runtime$", "i")
    return {
      ExpressionStatement(node) {
        const call = node.expression
        if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression" || call.arguments.length === 0) return
        const method = calledMethod(call)
        if (method !== "tick" && method !== "tryTick" && method !== "restore") return
        const receiver = receiverName(call.callee.object)
        if (receiver === undefined || !runtime.test(receiver)) return
        context.report({
          node,
          messageId: method === "restore" ? "restore" : "tick",
          data: { call: context.sourceCode.getText(call.callee) }
        })
      }
    }
  }
})
