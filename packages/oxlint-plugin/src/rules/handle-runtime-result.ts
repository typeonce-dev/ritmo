import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { calledMethod, constValue, docsUrl, globalPath, propertyKey, propertyName, receiverName } from "../internal/ast.ts"

interface Options {
  readonly runtimePattern?: string
}

/** The runtime methods that return a `Result`, and whether they take arguments. */
const methods = new Map<string, "arguments" | "none">([
  ["tick", "arguments"],
  ["tryTick", "arguments"],
  ["restore", "arguments"],
  ["rewind", "arguments"],
  ["snapshot", "none"],
  ["checksum", "none"]
])

/**
 * Wrappers a result passes through on its way to where it is used: the
 * check looks at where the wrapper goes (`x ?? runtime.snapshot()`,
 * `runtime.snapshot() as unknown`).
 */
const passesThrough = new Set(["ConditionalExpression", "LogicalExpression", "ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ChainExpression"])

/**
 * Where a result goes unchecked: handed to a function, printed, or put
 * inside another value. A variable, a field, a return, `.ok`, and `void`
 * keep it as a `Result` the code still has to look at.
 */
const unchecked = new Set(["CallExpression", "NewExpression", "TemplateLiteral", "Property", "ArrayExpression", "SpreadElement", "BinaryExpression", "JSXExpressionContainer"])

/**
 * Functions that take any value and do nothing with a `Result` but print or
 * encode it. A `tick`, `restore`, or `rewind` result handed to any other
 * function goes to a helper that checks it (`expectOk(runtime.tick(update))`).
 */
const sinks = new Set(["JSON.stringify", "String", "console.log", "console.info", "console.warn", "console.error", "console.debug"])

/** Functions that call back and drop what the callback returns: `forEach`, timers, event listeners. */
const droppingMethods = new Set(["forEach", "addEventListener"])
const droppingGlobals = new Set(["requestAnimationFrame", "requestIdleCallback", "setTimeout", "setInterval", "setImmediate", "queueMicrotask"])

/** Statements whose `test` is read as a boolean. */
const tests = new Set(["IfStatement", "WhileStatement", "DoWhileStatement", "ForStatement"])

const unwrap = (node: ESTree.Node): ESTree.Node =>
  node.type === "TSAsExpression" || node.type === "TSNonNullExpression" || node.type === "TSSatisfiesExpression" || node.type === "ParenthesizedExpression"
    ? unwrap(node.expression)
    : node

const calleeName = (node: ESTree.Node): string | undefined => {
  if (node.type === "Identifier") return node.name
  if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier") {
    return `${node.object.name}.${node.property.name}`
  }
  return undefined
}

/**
 * The `Result` of `runtime.tick(...)`, `tryTick(...)`, `restore(...)`,
 * `rewind(...)`, `snapshot()`, and `checksum()` is checked: dropping it, or
 * passing it on where any value is accepted, hides the failure. A `tick`,
 * `restore`, or `rewind` result passed to a function is left to that
 * function (a test's `expectOk`), unless it only prints or encodes.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Check the Result of runtime.tick, tryTick, restore, rewind, snapshot, and checksum instead of dropping it or passing it on unchecked.",
      url: docsUrl("handle-runtime-result")
    },
    messages: {
      tick:
        "The result of `{{call}}(...)` is dropped. A system that fails stops the tick and returns the failure here, so it goes unnoticed and the world is left half-updated. Check it: `const ran = {{call}}(...); if (!ran.ok) ...` (`ran.error` names the system and why). Write `void {{call}}(...)` to ignore it on purpose.",
      restore:
        "The result of `{{call}}(...)` is dropped. A save that fails to load leaves the previous world in place, unnoticed. Check it: `const restored = {{call}}(data); if (!restored.ok) ...` (`restored.error` says what was invalid). Write `void {{call}}(...)` to ignore it on purpose.",
      rewind:
        "The result of `{{call}}(...)` is dropped. A checkpoint the runtime let go of (older than its window, or taken before a rewind to an older one or a restore) changes nothing, so the ticks run next are run on top of the present instead of again, unnoticed. Check it: `const rewound = {{call}}(checkpoint); if (!rewound.ok) ...` (`rewound.error` says why), and resynchronize, for example by loading a peer's save. Write `void {{call}}(...)` to ignore it on purpose.",
      dropped:
        "The result of `{{call}}()` is dropped, so the call does nothing. Read it: `const saved = {{call}}(); if (saved.ok) ...`.",
      truthy:
        "`{{call}}(...)` returns a `Result`, an object, so as a condition it is always true and a failure goes unnoticed. Test its `.ok`: `if (!{{call}}(...).ok) ...`, or name it to read `.error` too: `const result = {{call}}(...); if (!result.ok) ...`.",
      unchecked:
        "`{{call}}(...)` returns a `Result`, and it is passed on unchecked: code that accepts any value (a save, a log, `JSON.stringify`) gets the `{ ok, value }` wrapper instead of the value, and a failure goes unnoticed. Check it first: `const result = {{call}}(...); if (result.ok) use(result.value)`. A helper that takes the `Result` itself gets it once it is named: `const result = {{call}}(...); helper(result)`."
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

    /** Whether `node` is a `Game.Runtime.make(...)` call (`Runtime.make(...)` too), or a `const` that holds one. */
    const isMake = (raw: ESTree.Node): boolean => {
      const node = unwrap(raw)
      const value = constValue(context, node)
      if (value !== undefined) return isMake(value)
      return node.type === "CallExpression" && calledMethod(node) === "make" && node.callee.type === "MemberExpression" && receiverName(node.callee.object) === "Runtime"
    }

    /** Whether `node` is a runtime: named like one, or the `.value` of a `Game.Runtime.make(...)` in the file, also through a `const`. */
    const isRuntime = (raw: ESTree.Node): boolean => {
      const node = unwrap(raw)
      const name = receiverName(node)
      if (name !== undefined && runtime.test(name)) return true
      const value = constValue(context, node)
      if (value !== undefined) return isRuntime(value)
      return node.type === "MemberExpression" && propertyName(node) === "value" && isMake(node.object)
    }

    /** The runtime method a call invokes: `runtime.tick(...)`, or `tick(...)` after `const { tick } = runtime`. */
    const methodOf = (call: ESTree.CallExpression): string | undefined => {
      if (call.callee.type === "MemberExpression") return isRuntime(call.callee.object) ? calledMethod(call) : undefined
      if (call.callee.type !== "Identifier") return undefined
      const variable = context.sourceCode.getScope(call.callee).references.find((reference) => reference.identifier === call.callee)?.resolved
      const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined
      if (definition?.type !== "Variable" || definition.parent?.type !== "VariableDeclaration" || definition.parent.kind !== "const") return undefined
      const binding = definition.name.parent
      const property = binding?.type === "AssignmentPattern" ? binding.parent : binding
      if (property?.type !== "Property" || property.parent.type !== "ObjectPattern") return undefined
      const declarator = property.parent.parent
      if (declarator.type !== "VariableDeclarator" || declarator.init === null || !isRuntime(declarator.init)) return undefined
      return propertyKey(property)
    }

    /** Whether a function's caller drops what it returns: `forEach`, a timer, an event listener. */
    const dropsReturn = (callback: ESTree.Node): boolean => {
      const call = callback.parent
      if (call?.type !== "CallExpression" || !call.arguments.some((argument) => argument === callback)) return false
      const method = calledMethod(call)
      if (method !== undefined && droppingMethods.has(method)) return true
      const path = globalPath(context, call.callee)
      return path !== undefined && droppingGlobals.has(path)
    }

    return {
      CallExpression(call) {
        const method = methodOf(call)
        const takes = method === undefined ? undefined : methods.get(method)
        if (takes === undefined) return
        // `run.tick()` and `replay.rewind()` without arguments are other libraries' methods.
        if (takes === "arguments" && call.arguments.length === 0) return
        if (takes === "none" && call.arguments.length > 0) return
        const data = { call: context.sourceCode.getText(call.callee) }
        const drop = (node: ESTree.Node) =>
          context.report({ node, messageId: takes === "none" ? "dropped" : method === "restore" || method === "rewind" ? method : "tick", data })

        let node: ESTree.Node = call
        let parent: ESTree.Node | null | undefined = node.parent
        // A Result is an object: a condition on it is always true.
        const tested = (): boolean =>
          parent != null && (
            (parent.type === "UnaryExpression" && parent.operator === "!") ||
            (parent.type === "ConditionalExpression" && parent.test === node) ||
            (parent.type === "LogicalExpression" && parent.operator !== "??" && parent.left === node) ||
            (tests.has(parent.type) && "test" in parent && parent.test === node)
          )
        while (parent != null && passesThrough.has(parent.type) && !tested()) {
          node = parent
          parent = node.parent
        }
        if (parent == null) return
        if (tested()) {
          context.report({ node: call, messageId: "truthy", data })
          return
        }
        if (parent.type === "ExpressionStatement") {
          drop(parent)
          return
        }
        // `runtime.tick(update), draw()`: a sequence keeps only its last value.
        if (parent.type === "SequenceExpression" && parent.expressions.at(-1) !== node) {
          drop(call)
          return
        }
        // `updates.forEach((u) => runtime.tick(u))`: the arrow returns the Result to a caller that drops it.
        if (parent.type === "ArrowFunctionExpression" && parent.body === node && dropsReturn(parent)) {
          drop(call)
          return
        }
        if (!unchecked.has(parent.type)) return
        // The callee of a call is a method read on the result, not a hand-off (`runtime.snapshot().toString()` would not compile anyway).
        if (parent.type === "CallExpression" && parent.callee === node) return
        // A property key is not a use of the value.
        if (parent.type === "Property" && parent.value !== node) return
        // A tick, restore, or rewind handed to a function goes to a helper that checks it, unless the function only prints or encodes.
        // snapshot() and checksum() are data on their way somewhere, so a function that takes them unchecked is reported.
        if ((parent.type === "CallExpression" || parent.type === "NewExpression") && takes === "arguments") {
          const name = calleeName(parent.callee)
          if (name === undefined || !sinks.has(name)) return
        }
        context.report({ node: call, messageId: "unchecked", data })
      }
    }
  }
})
