import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree } from "@oxlint/plugins"

import { constValue, docsUrl, globalPath, stringValue } from "../internal/ast.ts"

/** The listeners on the whole page, by the path `globalPath` gives (`window.addEventListener` is `addEventListener`). */
const pageListeners = new Set(["addEventListener", "document.addEventListener", "document.body.addEventListener", "document.documentElement.addEventListener"])

const keyEvents = new Set(["keydown", "keyup", "keypress"])

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function

const isFunction = (node: ESTree.Node | null | undefined): node is FunctionNode =>
  node !== null && node !== undefined && (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration")

/** The function a listener argument is: written inline, or a `const` or function declaration of the file it names. */
const listenerFunction = (context: Context, node: ESTree.Node): FunctionNode | undefined => {
  if (isFunction(node)) return node
  if (node.type !== "Identifier") return undefined
  const value = constValue(context, node)
  if (isFunction(value)) return value
  const variable = context.sourceCode.getScope(node).references.find((reference) => reference.identifier === node)?.resolved
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined
  return definition?.type === "FunctionName" && isFunction(definition.node) ? definition.node : undefined
}

/** Whether a parameter list binds `name`, so the event of an outer listener is shadowed inside. */
const binds = (params: ReadonlyArray<ESTree.ParamPattern>, name: string): boolean =>
  params.some((param) => param.type === "Identifier" && param.name === name)

/** Whether `node` calls `<name>.preventDefault()` anywhere inside, outside nested functions that rebind `name`. */
const preventsDefault = (node: ESTree.Node, name: string): boolean => {
  if (node.type === "CallExpression") {
    const callee = node.callee
    if (
      callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "preventDefault" &&
      callee.object.type === "Identifier" && callee.object.name === name
    ) return true
  }
  if (isFunction(node) && binds(node.params, name)) return false
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue
    const children: ReadonlyArray<unknown> = Array.isArray(value) ? value : [value]
    for (const child of children) {
      if (typeof child === "object" && child !== null && typeof (child as { readonly type?: unknown }).type === "string" && preventsDefault(child as ESTree.Node, name)) return true
    }
  }
  return false
}

/**
 * Host code takes game keys through `Keyboard.actions` / `Keyboard.presses`,
 * which leave keys the page is using (a focused control, an open dialog, a
 * form field) to the page, not through a key listener on the whole page
 * that prevents their default.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Take game keys with Keyboard.actions, not a key listener on window or document that calls preventDefault().",
      url: docsUrl("use-keyboard-for-game-keys")
    },
    messages: {
      pageListener:
        "A `{{type}}` listener on the whole page that calls `preventDefault()` also takes Enter, Space, and the arrows from a focused button, link, or open dialog, so the page's controls stop working by keyboard (games hide this with `tabIndex = -1` or `blur()`). Bind the key with `Keyboard.actions(window, bindings)` from `@typeonce/ritmo-browser` and read its `pressed` edge each frame (one-shot keys like Escape or M too; `Keyboard.presses(window)` for any key): it leaves keys the page is using to the page. A key for one piece of UI (a dialog's Escape, a menu's arrows) listens on that element instead."
    },
    schema: []
  },
  create(context) {
    return {
      CallExpression(node) {
        const path = globalPath(context, node.callee)
        if (path === undefined || !pageListeners.has(path)) return
        const type = stringValue(node.arguments[0])
        const listener = node.arguments[1]
        if (type === undefined || !keyEvents.has(type) || listener === undefined) return
        const handler = listenerFunction(context, listener)
        const event = handler?.params[0]
        if (handler === undefined || handler.body === null || event === undefined || event.type !== "Identifier") return
        if (preventsDefault(handler.body, event.name)) context.report({ node, messageId: "pageListener", data: { type } })
      }
    }
  }
})
