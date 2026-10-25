import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { calledMethod, docsUrl, propertyName } from "../internal/ast.ts"

// The names a tick's seconds go by: a local, a field (`time.dt`), or a resource read (`resources.deltaTime.get()`).
const deltaNames = ["dt", "deltaTime", "deltaSeconds"]

/** `node` without the type-only wrappers TypeScript adds (`dt as number`, `dt!`). */
const unwrap = (node: ESTree.Node): ESTree.Node =>
  node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "TSSatisfiesExpression" ? unwrap(node.expression) : node

/** Whether `node` is a tick's seconds on their own: `dt`, `time.dt`, or `resources.deltaTime.get()`. */
const isDelta = (raw: ESTree.Node): boolean => {
  const node = unwrap(raw)
  if (node.type === "Identifier") return deltaNames.includes(node.name)
  if (node.type === "MemberExpression") return deltaNames.includes(propertyName(node) ?? "")
  if (node.type === "CallExpression" && calledMethod(node) === "get" && node.callee.type === "MemberExpression") {
    const receiver = unwrap(node.callee.object)
    return receiver.type === "MemberExpression" && deltaNames.includes(propertyName(receiver) ?? "")
  }
  return false
}

/** Whether `node` reads a stored value (a local or a field), the thing a timer counts. */
const isStored = (raw: ESTree.Node): boolean => {
  const node = unwrap(raw)
  return (node.type === "Identifier" || node.type === "MemberExpression") && !isDelta(node)
}

/**
 * A timer in simulation code is a deadline in steps, never a float counted
 * down (or up) by `dt`: the float drifts, and the value it saves means
 * nothing once the fixed step changes.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Keep timers and cooldowns as Clock deadlines in steps, not floats counted by dt.",
      url: docsUrl("no-float-timers")
    },
    messages: {
      floatTimer:
        "`{{text}}` counts a timer by `dt` in floating point: rounding error builds up each tick, so it ends a step early or late, and the float it saves means nothing once the fixed step changes. Store the step it ends on instead: `ready: Clock.deadline(time, Clock.duration(step, seconds))` in the component or resource (its schema narrows with `Clock.isDeadline(step)`), and check `Clock.reached(time, ready)` each tick (`Clock.remaining(time, ready)` for a readout, `Clock.every(time, duration)` for something that repeats, `Clock.elapsed(time)` for seconds since the start)."
    },
    schema: []
  },
  create(context) {
    const report = (node: ESTree.Node) =>
      context.report({ node, messageId: "floatTimer", data: { text: context.sourceCode.getText(node) } })
    return {
      AssignmentExpression(node) {
        // `timer -= dt`, `elapsed += time.dt`
        if ((node.operator === "-=" || node.operator === "+=") && isDelta(node.right)) report(node)
      },
      BinaryExpression(node) {
        // `cooldown.remaining - dt`, `time.dt + since`; `x + vx * dt` scales dt, so it is integration.
        if (node.operator !== "-" && node.operator !== "+") return
        if ((isDelta(node.right) && isStored(node.left)) || (isDelta(node.left) && isStored(node.right))) report(node)
      }
    }
  }
})
