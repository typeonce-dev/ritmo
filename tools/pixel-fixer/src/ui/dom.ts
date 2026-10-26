/** A tiny element builder: the tool is a single page and needs no framework. */

type Child = Node | string | number | null | undefined | false

export interface Props {
  readonly class?: string
  readonly title?: string | undefined
  readonly on?: { readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void }
  readonly attrs?: Readonly<Record<string, string | number | boolean | undefined>>
  /** Properties set directly on the element (`value`, `checked`, `type`, ...). */
  readonly props?: Readonly<Record<string, unknown>>
}

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Props = {},
  ...children: Array<Child | ReadonlyArray<Child>>
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)
  if (options.class !== undefined) element.className = options.class
  if (options.title !== undefined) element.title = options.title
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === false) continue
    element.setAttribute(name, value === true ? "" : String(value))
  }
  for (const [name, value] of Object.entries(options.props ?? {})) Reflect.set(element, name, value)
  const on = options.on ?? {}
  for (const name of Object.keys(on) as Array<keyof HTMLElementEventMap>) {
    const listener = on[name]
    if (listener !== undefined) element.addEventListener(name, listener as EventListener)
  }
  append(element, children)
  return element
}

const append = (element: Node, children: ReadonlyArray<Child | ReadonlyArray<Child>>): void => {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (Array.isArray(child)) append(element, child)
    else element.appendChild(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

/** Replaces an element's children. */
export const replace = (element: Element, ...children: Array<Child | ReadonlyArray<Child>>): void => {
  element.replaceChildren()
  append(element, children)
}
