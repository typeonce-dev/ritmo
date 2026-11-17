/**
 * The page side of `ritmo-devtools keyboard`: a script installed before the
 * game's own scripts on every page the walk opens. It runs in the browser,
 * so it is plain JavaScript in a string: Node never runs it, and the package
 * config has no DOM types.
 *
 * It installs `__ritmoKeyboardWalk` with:
 *
 * - `state()`: the focused element and the open menu, each described;
 * - `signature()`: the page's clock and one string naming the open menu, the
 *   focused element, and every visible control, to tell when a screen has
 *   stopped changing;
 * - `controls(scope)`: the visible, enabled controls inside the menu (or the
 *   page), described;
 * - `groupStops(control, stops)`: the Tab stops in the smallest element that
 *   holds the control and at least one stop, for the arrow-key probe;
 * - `arm(stop)` and `result()`: around one key press, whether the focused
 *   control was pressed (a `click` reached it, or its `aria-checked`,
 *   `aria-pressed`, `aria-expanded`, or `aria-selected` changed) and whether
 *   a listener prevented the key; with `stop`, the click is stopped at
 *   `window` before any game listener runs, so a press through `click`
 *   changes nothing (a control that acts on keydown still acts);
 * - `element(id)`, `focus(id)`: an element by the id the walk gave it.
 *
 * Elements are identified through a `WeakMap`, so the game's DOM is never
 * changed.
 */
export const pageScript = String.raw`(() => {
  if (globalThis.__ritmoKeyboardWalk) return
  const ids = new WeakMap()
  const byId = new Map()
  let next = 1
  const idOf = (element) => {
    let id = ids.get(element)
    if (id === undefined) {
      id = next++
      ids.set(element, id)
      byId.set(id, new WeakRef(element))
    }
    return id
  }
  const element = (id) => byId.get(id)?.deref() ?? null
  const shown = (element) => typeof element.checkVisibility === "function" && element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) === true
  const visible = (element) => {
    if (!shown(element)) return false
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  const last = (list) => list.length === 0 ? null : list[list.length - 1]
  const openMenu = () =>
    last([...document.querySelectorAll("dialog:modal")])
      ?? last([...document.querySelectorAll('[aria-modal="true"]')].filter(shown))
      ?? last([...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]')].filter(shown))
  const selector = (element) => {
    const parts = []
    let at = element
    while (at !== null && at.nodeType === 1 && at !== document.documentElement) {
      if (at.id !== "" && document.querySelectorAll("#" + CSS.escape(at.id)).length === 1) {
        parts.unshift("#" + CSS.escape(at.id))
        break
      }
      let part = at.localName
      const parent = at.parentElement
      if (parent !== null) {
        const same = [...parent.children].filter((child) => child.localName === at.localName)
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(at) + 1) + ")"
      }
      parts.unshift(part)
      at = parent
    }
    return parts.join(" > ")
  }
  const nativeKeys = (element) => {
    const tag = element.localName
    const type = (element.getAttribute("type") ?? "").toLowerCase()
    if (tag === "button") return ["Enter", " "]
    if (tag === "input" && ["button", "submit", "reset", "image"].includes(type)) return ["Enter", " "]
    if (tag === "input" && ["checkbox", "radio"].includes(type)) return [" "]
    if (tag === "a" && element.hasAttribute("href")) return ["Enter"]
    if (tag === "summary") return ["Enter", " "]
    return []
  }
  const customRoles = ["button", "link", "checkbox", "switch", "radio", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option"]
  const describe = (element) => {
    const tag = element.localName
    const native = nativeKeys(element)
    const role = element.getAttribute("role") ?? ""
    const custom = native.length === 0 && customRoles.includes(role)
    return {
      id: idOf(element),
      tag: element.localName,
      selector: selector(element),
      keys: native.length > 0 ? native : custom ? (role === "link" ? ["Enter"] : ["Enter", " "]) : [],
      native: native.length > 0,
      external: tag === "a" && element.hasAttribute("href") && (() => {
        try {
          return new URL(element.href, location.href).origin !== location.origin
        } catch {
          return false
        }
      })(),
      canvas: element.localName === "canvas"
    }
  }
  const focused = () => {
    const active = document.activeElement
    return active === null || active === document.body || active === document.documentElement ? null : active
  }
  const controlSelector = [
    "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "summary",
    ...customRoles.map((role) => '[role="' + role + '"]'),
    '[role="slider"]', '[role="spinbutton"]', '[role="combobox"]', '[role="textbox"]'
  ].join(", ")
  const visibleControls = (root) => [...root.querySelectorAll(controlSelector)]
    .filter((control) => !control.disabled && control.closest("[inert]") === null && visible(control))
  // A custom control (a switch, a toggle) may act on keydown with no click: a change of its state attributes is a press too.
  const stateOf = (element) => element === null ? "" : ["aria-checked", "aria-pressed", "aria-expanded", "aria-selected"].map((name) => element.getAttribute(name) ?? "").join("|")
  let armed = null
  window.addEventListener("click", (event) => {
    if (armed === null) return
    armed.clicks.push(event.target)
    if (armed.stop) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  }, true)
  globalThis.__ritmoKeyboardWalk = {
    element: (id) => element(id),
    focus: (id) => {
      const found = element(id)
      if (found !== null) found.focus()
      return found !== null && document.activeElement === found
    },
    state: () => {
      const menu = openMenu()
      const active = focused()
      return {
        active: active === null ? null : describe(active),
        menu: menu === null ? null : describe(menu),
        inMenu: menu !== null && active !== null && menu.contains(active),
        url: location.href
      }
    },
    controls: (scope) => {
      const root = scope === null ? document.body : element(scope)
      if (root === null) return []
      return visibleControls(root).map(describe)
    },
    signature: () => {
      const menu = openMenu()
      const active = focused()
      return {
        now: performance.now(),
        key: [menu, active, ...(document.body === null ? [] : visibleControls(document.body))].map((element) => element === null ? "-" : idOf(element)).join(" ")
      }
    },
    groupStops: (control, stops) => {
      const target = element(control)
      if (target === null) return []
      const inside = (group) => stops.filter((stop) => {
        const found = element(stop)
        return found !== null && group.contains(found)
      })
      for (let group = target.parentElement; group !== null && group !== document.body && group !== document.documentElement; group = group.parentElement) {
        const found = inside(group)
        if (found.length > 0) return found
      }
      return []
    },
    arm: (stop) => {
      const target = document.activeElement
      const press = { stop, clicks: [], target, before: stateOf(target), keydown: null, keyup: null }
      armed = press
      const down = (event) => {
        press.keydown = event.defaultPrevented
        window.removeEventListener("keydown", down)
      }
      const up = (event) => {
        press.keyup = event.defaultPrevented
        window.removeEventListener("keyup", up)
      }
      window.addEventListener("keydown", down)
      window.addEventListener("keyup", up)
    },
    result: () => {
      const press = armed
      armed = null
      if (press === null) return { pressed: false, keydownPrevented: null, keyupPrevented: null }
      const target = press.target
      const clicked = target !== null && press.clicks.some((clicked) => clicked === target || (clicked instanceof Node && target.contains(clicked)))
      return {
        pressed: clicked || (target !== null && stateOf(target) !== press.before),
        keydownPrevented: press.keydown,
        keyupPrevented: press.keyup
      }
    }
  }
})()`
