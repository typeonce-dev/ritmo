import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree } from "@oxlint/plugins"

import { calledMethod, constValue, docsUrl, globalPath, propertyKey, propertyName } from "../internal/ast.ts"

/**
 * The names a step's length in seconds goes by, lowercased without `_`: a
 * local, a constant (`STEP_SECONDS`), a field (`time.dt`), or a resource read
 * (`resources.deltaTime.get()`).
 */
const deltaNames = new Set([
  "dt", "deltatime", "deltaseconds", "dtseconds", "fixeddt", "fixeddelta", "fixeddeltatime", "fixeddeltaseconds",
  "stepseconds", "fixedstepseconds", "fixedstep", "timestep", "fixedtimestep", "secondsperstep", "secondspertick", "tickseconds", "frameseconds"
])
/** Fields that are a step's length only on a receiver named for time: `time.delta`, `step.seconds`, but not a pointer's `delta`. */
const timeFields = new Map([
  ["delta", new Set(["time", "clock", "frame", "tick", "step"])],
  ["seconds", new Set(["frame", "tick", "step"])]
])

const normal = (name: string): string => name.replaceAll("_", "").toLowerCase()

/** `node` without the wrappers that keep its value (`dt as number`, `dt!`, `(dt)`). */
const unwrap = (node: ESTree.Node): ESTree.Node =>
  node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "TSSatisfiesExpression" || node.type === "ParenthesizedExpression"
    ? unwrap(node.expression)
    : node

const numberValue = (node: ESTree.Node): number | undefined => {
  const value = unwrap(node)
  return value.type === "Literal" && typeof value.value === "number" ? value.value : undefined
}

/** Whether `call` is the global `Math.min(...)` or `Math.max(...)`. */
const isMinMax = (context: Context, call: ESTree.Node): call is ESTree.CallExpression => {
  if (call.type !== "CallExpression") return false
  const path = globalPath(context, call.callee)
  return path === "Math.min" || path === "Math.max"
}

/**
 * Whether `node` is a step's length in seconds: `dt`, `time.dt`,
 * `resources.deltaTime.get()`, `1 / 60`, one of these scaled by a number
 * (`dt * 1000`) or clamped (`Math.min(dt, 0.1)`), or a `const` that holds
 * one. A bare `delta` counts only where a timer counts down (`countdown`).
 */
const isDelta = (context: Context, raw: ESTree.Node, countdown = false): boolean => {
  const node = unwrap(raw)
  if (node.type === "Identifier") {
    if (deltaNames.has(normal(node.name)) || (countdown && node.name === "delta")) return true
    const init = constValue(context, node)
    return init !== undefined && isDelta(context, init)
  }
  if (node.type === "MemberExpression") {
    const name = propertyName(node)
    if (name === undefined) return false
    if (deltaNames.has(normal(name))) return true
    const receivers = timeFields.get(name)
    const receiver = unwrap(node.object)
    const owner = receiver.type === "Identifier" ? receiver.name : receiver.type === "MemberExpression" ? propertyName(receiver) : undefined
    return receivers !== undefined && owner !== undefined && receivers.has(normal(owner))
  }
  if (node.type === "CallExpression" && calledMethod(node) === "get" && node.callee.type === "MemberExpression") {
    const receiver = unwrap(node.callee.object)
    return receiver.type === "MemberExpression" && deltaNames.has(normal(propertyName(receiver) ?? ""))
  }
  if (node.type === "BinaryExpression") {
    // `1 / 60`: one second split into steps.
    if (node.operator === "/" && numberValue(node.left) === 1) {
      const steps = numberValue(node.right)
      return steps !== undefined && Number.isInteger(steps) && steps > 1
    }
    // `dt * 1000`, `dt / 2`: still a step's length, in other units.
    if (node.operator === "*") return (isDelta(context, node.left) && numberValue(node.right) !== undefined) || (numberValue(node.left) !== undefined && isDelta(context, node.right))
    if (node.operator === "/") return isDelta(context, node.left) && numberValue(node.right) !== undefined
  }
  if (isMinMax(context, node)) return node.arguments.some((argument) => isDelta(context, argument))
  return false
}

/** The last name of a stored value: `remaining` for `timer.remaining`, `left` for `left`. */
const lastName = (raw: ESTree.Node): string | undefined => {
  const node = unwrap(raw)
  if (node.type === "Identifier") return node.name
  if (node.type === "MemberExpression") return propertyName(node)
  return undefined
}

/**
 * Whether the value of `expression`, a stored value `stored` plus or minus a
 * step, is written back where `stored` came from, so it counts across ticks:
 * to a target of the same name (`x = x - dt`, `let cooldown =
 * state.cooldown - dt`, `{ left: buff.left - dt }`, `resources.timer.set(timer
 * - dt)`), or as the result of an `update` callback over it. A clamp
 * (`Math.max(0, x - dt)`) or a branch (`a ? x - dt : 0`) passes the value on.
 */
const writtenBack = (context: Context, expression: ESTree.Node, stored: ESTree.Node): boolean => {
  const name = lastName(stored)
  if (name === undefined) return false
  let node = expression
  let parent = node.parent
  while (
    parent !== null &&
    ((parent.type === "TSAsExpression" || parent.type === "TSNonNullExpression" || parent.type === "TSSatisfiesExpression" || parent.type === "ParenthesizedExpression") ||
      (parent.type === "ConditionalExpression" && parent.test !== node) ||
      parent.type === "LogicalExpression" ||
      (isMinMax(context, parent) && parent.callee !== node))
  ) {
    node = parent
    parent = node.parent
  }
  if (parent === null) return false
  if (parent.type === "AssignmentExpression") return parent.operator === "=" && parent.right === node && lastName(parent.left) === name
  if (parent.type === "VariableDeclarator") return parent.init === node && parent.id.type === "Identifier" && parent.id.name === name
  if (parent.type === "Property") return parent.value === node && parent.parent.type === "ObjectExpression" && propertyKey(parent) === name
  // `resources.timer.set(timer - dt)`, `data.timer.set(entity, timer - dt)`
  if (parent.type === "CallExpression" && calledMethod(parent) === "set" && parent.callee.type === "MemberExpression" && parent.arguments.at(-1) === node) {
    return lastName(parent.callee.object) === name
  }
  // `resources.timer.update((left) => left - dt)`
  const callback = parent.type === "ArrowFunctionExpression" && parent.body === node ? parent : undefined
  if (callback !== undefined && callback.parent.type === "CallExpression" && calledMethod(callback.parent) === "update") {
    const param = callback.params[0]
    return param?.type === "Identifier" && param.name === name && unwrap(stored).type === "Identifier"
  }
  return false
}

/**
 * A timer in simulation code is a deadline in steps, never a float counted
 * down (or up) by a step's seconds: the float drifts, and the value it saves
 * means nothing once the fixed step changes.
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
        "`{{text}}` counts a timer by `dt` in floating point: rounding error builds up each tick, so it ends a step early or late, and the float it saves means nothing once the fixed step changes. Store the step it ends on instead: `ready: Clock.deadline(time, Clock.duration(step, seconds))` in the component or resource (its schema narrows with `Clock.isDeadline(step)`), and check `Clock.reached(time, ready)` each tick (`Clock.remaining(time, ready)` for a readout, `Clock.every(time, duration)` for something that repeats, `Clock.elapsed(time)` for seconds since the start). A timer that must stop while the world clock runs (hit-stop, a menu over gameplay) is measured against a second clock that holds: `Clock.resource(\"Game/GameplayTime\", step)` advanced by `Clock.system(Game, { name, resource, hold: [paused] })`, so its deadlines wait with it. Only time scaled by a fraction (a 0.3x slow motion) is a real float: keep it and disable this line with the reason."
    },
    schema: []
  },
  create(context) {
    const report = (node: ESTree.Node) =>
      context.report({ node, messageId: "floatTimer", data: { text: context.sourceCode.getText(node) } })
    /** Whether `node` reads a stored value (a local or a field), the thing a timer counts. */
    const isStored = (raw: ESTree.Node): boolean => {
      const node = unwrap(raw)
      return (node.type === "Identifier" || node.type === "MemberExpression") && !isDelta(context, node)
    }
    return {
      AssignmentExpression(node) {
        // `timer -= dt`, `elapsed += time.dt`
        if (node.operator === "-=" && isDelta(context, node.right, true)) report(node)
        if (node.operator === "+=" && isDelta(context, node.right)) report(node)
      },
      BinaryExpression(node) {
        // `cooldown.remaining - dt` written back; `x + vx * dt` scales dt, so it is integration, and `horizon + dt` stored elsewhere is a look-ahead.
        if (node.operator !== "-" && node.operator !== "+") return
        if (isDelta(context, node.right, node.operator === "-") && isStored(node.left) && writtenBack(context, node, node.left)) report(node)
        else if (node.operator === "+" && isDelta(context, node.left) && isStored(node.right) && writtenBack(context, node, node.right)) report(node)
      }
    }
  }
})
