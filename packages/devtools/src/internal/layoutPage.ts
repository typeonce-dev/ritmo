/**
 * The page side of `ritmo-devtools layout`: a script installed before the
 * game's own scripts on every page the audit opens. It runs in the browser,
 * so it is plain JavaScript in a string: Node never runs it, and the package
 * config has no DOM types.
 *
 * It installs `__ritmoLayout` with:
 *
 * - `snapshot()`: every measured element's layout box, ignoring transforms,
 *   for the walk to tell when the screen holds still (a transform animation
 *   is motion, not layout, so a pulsing button still settles);
 * - `audit(options)`: the findings of each check over what the page shows
 *   now (the open modal only, when there is one), and how many items it
 *   measured;
 * - `steady()` and `shifts(allow)`: Chromium's own layout-shift entries
 *   recorded since `steady()`, with the elements that moved;
 * - `pad()`: makes every text on the page about 40% longer, and keeps it so
 *   as the game renders new text, for the longer-text pass;
 * - `mark(boxes)` and `unmark()`: numbered boxes over the findings, in the
 *   top layer, for a screenshot.
 *
 * What it measures: each line of visible text (`Range.getClientRects`, the
 * text itself rather than the box around it), each visible control (the
 * elements the keyboard walk calls controls), and each button of a
 * `Touch.actions` layout (read from the element it is attached to). Boxes
 * come in viewport pixels after every transform, so a UI scaled as one piece
 * is measured as it is shown.
 *
 * It changes nothing on the game's page except in `pad()` (a pass of its
 * own, on its own page load), and while `audit` runs, when a style that
 * makes every element answer hit tests lets it see what is drawn on top
 * (removed before it returns).
 */
export const pageScript = String.raw`(() => {
  if (globalThis.__ritmoLayout) return
  const touchKey = Symbol.for("@typeonce/ritmo-browser/Touch.layout")
  const controlSelector = [
    "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "summary",
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
    '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]', '[role="treeitem"]',
    '[role="slider"]', '[role="spinbutton"]', '[role="combobox"]', '[role="textbox"]'
  ].join(", ")
  const marksId = "__ritmo_layout_marks"

  // Chromium's layout-shift entries, from the first paint on.
  const shiftLog = []
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        shiftLog.push({ time: entry.startTime, value: entry.value, nodes: (entry.sources || []).map((source) => source.node).filter((node) => node) })
      }
    }).observe({ type: "layout-shift", buffered: true })
  } catch (error) {}
  let steadyFrom = Infinity

  const shown = (element) => typeof element.checkVisibility === "function" && element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) === true
  const transparent = (color) => color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color)

  const selector = (element) => {
    const parts = []
    let at = element
    while (at !== null && at.nodeType === 1 && at !== document.documentElement) {
      if (at.id !== "" && document.querySelectorAll("#" + CSS.escape(at.id)).length === 1) {
        parts.unshift("#" + CSS.escape(at.id))
        break
      }
      let part = at.localName
      const classes = [...at.classList].filter((name) => !name.startsWith("__")).slice(0, 2)
      if (classes.length > 0) part += classes.map((name) => "." + CSS.escape(name)).join("")
      const parent = at.parentElement
      if (parent !== null) {
        const same = [...parent.children].filter((child) => child.localName === at.localName && classes.every((name) => child.classList.contains(name)))
        if (same.length > 1) part += ":nth-of-type(" + ([...parent.children].filter((child) => child.localName === at.localName).indexOf(at) + 1) + ")"
      }
      parts.unshift(part)
      if (parts.length >= 4) break
      at = parent
    }
    return parts.join(" > ")
  }

  const box = (rect) => ({ l: rect.left, t: rect.top, r: rect.right, b: rect.bottom })
  const meet = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) })
  const width = (a) => Math.max(0, a.r - a.l)
  const height = (a) => Math.max(0, a.b - a.t)
  const area = (a) => width(a) * height(a)
  const contains = (outer, inner) => outer.l <= inner.l + 1 && outer.t <= inner.t + 1 && outer.r >= inner.r - 1 && outer.b >= inner.b - 1
  const round = (a) => ({ l: Math.round(a.l), t: Math.round(a.t), r: Math.round(a.r), b: Math.round(a.b) })

  const clipsOverflow = (style) => style.overflowX !== "visible" || style.overflowY !== "visible"
  const scrolls = (style) => /auto|scroll/.test(style.overflowX) || /auto|scroll/.test(style.overflowY)
  const makesContainingBlock = (style, fixed) =>
    (!fixed && style.position !== "static") || style.transform !== "none" || style.perspective !== "none" ||
    style.filter !== "none" || /paint|layout|strict|content/.test(style.contain) || /transform/.test(style.willChange)
  /** The ancestor whose box a positioned element is placed in (null: the viewport). */
  const containingBlock = (element, fixed) => {
    for (let at = element.parentElement; at !== null && at !== document.documentElement; at = at.parentElement) {
      if (makesContainingBlock(getComputedStyle(at), fixed)) return at
    }
    return null
  }
  /**
   * The ancestors that clip what an element draws (its text, with self), in
   * order: overflow clips a descendant only when the descendant's containing
   * block is inside the clipping element, so an absolutely placed badge
   * escapes a parent that hides overflow, as it does on screen.
   */
  const clippers = (element, self) => {
    const out = []
    let escapeTo
    let at = element
    while (at !== null && at !== document.documentElement) {
      if (escapeTo !== undefined && at === escapeTo) escapeTo = undefined
      const style = getComputedStyle(at)
      // The body's overflow belongs to the viewport when the root's is visible: it clips nothing of its own.
      const propagated = at === document.body && getComputedStyle(document.documentElement).overflow === "visible"
      if (escapeTo === undefined && (at !== element || self) && !propagated && clipsOverflow(style)) {
        out.push({ element: at, box: box(at.getBoundingClientRect()), scroll: scrolls(style) })
      }
      if (style.position === "fixed" || style.position === "absolute") {
        const block = containingBlock(at, style.position === "fixed")
        if (block === null) break
        if (escapeTo === undefined) escapeTo = block
      }
      at = at.parentElement
    }
    return out
  }
  const nearestScroller = (clips) => clips.find((clip) => clip.scroll)

  const painted = (element) => {
    const style = getComputedStyle(element)
    if (/^(img|svg|canvas|video|input|select|textarea|progress|meter)$/.test(element.localName)) return true
    if (!transparent(style.backgroundColor) || style.backgroundImage !== "none" || style.boxShadow !== "none") return true
    if (style.backdropFilter !== undefined && style.backdropFilter !== "none") return true
    const borders = ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style["border" + side + "Width"]) > 0 && !transparent(style["border" + side + "Color"]))
    return borders
  }

  const scope = () => {
    const modals = [...document.querySelectorAll("dialog:modal")]
    if (modals.length > 0) return modals[modals.length - 1]
    const shownModals = [...document.querySelectorAll('[aria-modal="true"]')].filter(shown)
    return shownModals.length > 0 ? shownModals[shownModals.length - 1] : document.body
  }

  const textOf = (element) => (element.getAttribute("aria-label") || element.textContent || element.getAttribute("title") || element.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim()

  /** Everything the audit measures: lines of text, controls, and the buttons of a Touch layout. */
  const items = () => {
    const root = scope()
    const out = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.nodeValue.trim() === "") continue
      const parent = node.parentElement
      if (parent === null || parent.closest("script, style, noscript, template, #" + marksId) !== null || !shown(parent)) continue
      if (transparent(getComputedStyle(parent).color)) continue
      const control = parent.closest(controlSelector)
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue
        out.push({ kind: "text", element: parent, owner: control !== null && root.contains(control) ? control : parent, rect: box(rect), text: node.nodeValue.replace(/\s+/g, " ").trim() })
      }
    }
    for (const control of root.querySelectorAll(controlSelector)) {
      if (control.disabled || control.closest("[inert]") !== null || !shown(control)) continue
      const rect = control.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      out.push({ kind: "control", element: control, owner: control, rect: box(rect), text: textOf(control), painted: painted(control) || control.querySelector("img, svg, canvas, video") !== null })
    }
    for (const element of document.querySelectorAll("canvas, [style*='touch-action']")) {
      const read = element[touchKey]
      if (typeof read !== "function" || !shown(element)) continue
      const origin = element.getBoundingClientRect()
      let layout
      try { layout = read() } catch (error) { continue }
      for (const [name, zone] of Object.entries(layout.buttons || {})) {
        if (zone === null || zone === undefined) continue
        const x = origin.left + zone.center.x
        const y = origin.top + zone.center.y
        out.push({ kind: "touch", element, owner: element, rect: { l: x - zone.radius, t: y - zone.radius, r: x + zone.radius, b: y + zone.radius }, text: name, centre: { x, y }, radius: zone.radius })
      }
    }
    return out
  }

  /** The layout box of an element, transforms left out, in page pixels. */
  const layoutBox = (element) => {
    let left = 0
    let top = 0
    for (let at = element; at !== null && at instanceof HTMLElement; at = at.offsetParent) {
      left += at.offsetLeft
      top += at.offsetTop
    }
    return element instanceof HTMLElement ? [left, top, element.offsetWidth, element.offsetHeight] : [0, 0, 0, 0]
  }

  const snapshot = () => {
    const seen = new Set()
    const out = []
    for (const item of items()) {
      if (seen.has(item.element)) continue
      seen.add(item.element)
      out.push([selector(item.element), ...layoutBox(item.element), item.kind === "text" ? item.text.length : 0])
    }
    return JSON.stringify(out)
  }

  const describe = (item) => ({ kind: item.kind, selector: selector(item.element), text: item.text.slice(0, 60) })
  const allowed = (allow, check, elements) =>
    allow.some((entry) => entry.check === check && elements.some((element) => {
      try { return element !== null && element.closest(entry.selector) !== null } catch (error) { return false }
    }))

  const related = (owner, element) => element === owner || owner.contains(element)

  /**
   * Whether two owners really show over each other at the points of their
   * shared box: both hit there, and nothing drawn sits above both (a scrim
   * over a hidden button, a panel over the stage). Every element answers hit
   * tests while this runs, so text in a pointer-events: none layer counts.
   */
  const shownTogether = (a, b, boxA, boxB, shared) => {
    const points = []
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) points.push([shared.l + width(shared) * fx, shared.t + height(shared) * fy])
    let top = null
    let count = 0
    for (const [x, y] of points) {
      const stack = document.elementsFromPoint(x, y)
      const hitA = stack.findIndex((element) => related(a, element))
      const hitB = stack.findIndex((element) => related(b, element))
      if (hitA === -1 || hitB === -1) continue
      const first = Math.min(hitA, hitB)
      const covered = stack.slice(0, first).some((element) => element.id !== marksId && painted(element))
      if (covered) continue
      // A layer the upper one sits on (a scrim, a panel) that hides the whole lower one: the lower is behind it, not under the upper.
      const [upper, lower, lowerBox] = hitA < hitB ? [a, b, boxB] : [b, a, boxA]
      const layered = stack.slice(0, Math.max(hitA, hitB)).some((element) => element !== upper && !related(lower, element) && element.id !== marksId && painted(element) && contains(box(element.getBoundingClientRect()), lowerBox))
      if (layered) continue
      count++
      if (top === null) top = hitA < hitB ? "a" : "b"
    }
    return { count, top }
  }

  const tapExtent = (item, most) => {
    const x0 = item.rect.l + width(item.rect) / 2
    const y0 = item.rect.t + height(item.rect) / 2
    const hits = (x, y) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
      const found = document.elementFromPoint(x, y)
      return found !== null && related(item.element, found)
    }
    if (!hits(x0, y0)) return { width: 0, height: 0, box: null }
    const run = (dx, dy) => {
      let steps = 0
      while (steps < most && hits(x0 + dx * (steps + 1), y0 + dy * (steps + 1))) steps++
      return steps
    }
    const left = run(-1, 0), right = run(1, 0), up = run(0, -1), down = run(0, 1)
    return { width: left + right + 1, height: up + down + 1, box: { l: x0 - left, t: y0 - up, r: x0 + right + 1, b: y0 + down + 1 } }
  }

  const audit = (options) => {
    const insets = options.insets
    const minTarget = options.minTarget
    const allow = options.allow
    const checks = new Set(options.checks)
    // The screen's size, not the page's: on a phone, a page wider than the screen widens its layout and is zoomed out to fit.
    const screenWidth = options.width
    const screenHeight = options.height
    const viewport = { l: 0, t: 0, r: screenWidth, b: screenHeight }
    const safe = { l: insets.left, t: insets.top, r: screenWidth - insets.right, b: screenHeight - insets.bottom }
    const pageScrolls = document.documentElement.scrollHeight > screenHeight + 1
    const all = items()
    const findings = []
    let skipped = 0
    const add = (check, elements, finding) => {
      if (allowed(allow, check, elements)) { skipped++; return }
      findings.push({ check, ...finding })
    }
    for (const item of all) {
      item.clips = item.kind === "touch" ? [] : clippers(item.element, item.kind === "text")
      item.scroller = nearestScroller(item.clips)
      item.visible = item.clips.reduce((rect, clip) => meet(rect, clip.box), item.rect)
    }

    // overlap: two things drawn over each other, neither part of the other.
    if (checks.has("overlap")) {
      const force = document.createElement("style")
      force.textContent = "*, *::before, *::after { pointer-events: auto !important; }"
      document.documentElement.appendChild(force)
      try {
        const drawn = all.filter((item) => item.kind === "text" || (item.kind === "control" && item.painted))
        const reported = new Set()
        for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
          const a = drawn[i], b = drawn[j]
          if (a.owner === b.owner || a.owner.contains(b.owner) || b.owner.contains(a.owner)) continue
          const shared = meet(a.visible, b.visible)
          if (width(shared) <= 2 || height(shared) <= 2) continue
          const key = [selector(a.owner), selector(b.owner)].sort().join("|")
          if (reported.has(key)) continue
          const seen = shownTogether(a.owner, b.owner, a.visible, b.visible, shared)
          if (seen.count === 0) continue
          reported.add(key)
          const over = seen.top === "a" ? a : b
          const under = seen.top === "a" ? b : a
          // A control under the whole of the other is its backdrop ("tap anywhere", a clickable panel): what is on top takes its own taps.
          if (under.kind === "control" && contains(under.visible, over.visible)) continue
          add("overlap", [a.owner, b.owner], {
            element: describe(under),
            other: describe(over),
            box: round(shared),
            saw: "they overlap by " + Math.round(width(shared)) + " x " + Math.round(height(shared)) + " px, and the " + over.kind + " is drawn over the " + under.kind + (under.kind === "control" ? ", so a tap there reaches the wrong thing" : "")
          })
        }
      } finally {
        force.remove()
      }
    }

    // Touch buttons, with hit tests as a finger meets them: what takes a tap at each button's centre.
    const touches = all.filter((item) => item.kind === "touch")
    const taken = new Map(touches.map((touch) => {
      const found = document.elementFromPoint(touch.centre.x, touch.centre.y)
      return [touch, found === null || related(touch.element, found) ? null : found]
    }))
    for (const target of new Set(touches.map((touch) => touch.element))) {
      const mine = touches.filter((touch) => touch.element === target)
      // No button of the layout takes a tap: a screen covers the game (a menu, a pause screen), so none is in play.
      if (mine.every((touch) => taken.get(touch) !== null)) {
        for (const touch of mine) all.splice(all.indexOf(touch), 1)
        continue
      }
      if (!checks.has("overlap")) continue
      for (const touch of mine) {
        const found = taken.get(touch)
        if (found === null || found === undefined) continue
        add("overlap", [touch.element, found], { element: describe(touch), other: { kind: "control", selector: selector(found), text: textOf(found).slice(0, 60) }, box: round(touch.rect), saw: "a tap at the centre of the touch button " + JSON.stringify(touch.text) + " reaches " + selector(found) + " instead" })
      }
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i], b = mine[j]
        if (Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y) < a.radius + b.radius - 2) {
          add("overlap", [a.element], { element: describe(a), other: describe(b), box: round(meet(a.rect, b.rect)), saw: "touch buttons " + JSON.stringify(a.text) + " and " + JSON.stringify(b.text) + " share space, so a thumb between them presses either" })
        }
      }
    }

    // cut-text and truncated-text: text a clipping box hides part of.
    const cut = new Set()
    for (const item of all) {
      if (item.kind !== "text" || cut.has(item.element)) continue
      if (area(item.visible) < 1) continue
      for (const clip of item.clips) {
        if (clip.scroll) break
        const inside = meet(item.rect, clip.box)
        if (width(item.rect) - width(inside) <= 1 && height(item.rect) - height(inside) <= 1) continue
        cut.add(item.element)
        const style = getComputedStyle(clip.element)
        const meant = style.textOverflow === "ellipsis" || (style.webkitLineClamp !== undefined && style.webkitLineClamp !== "none")
        if (meant && checks.has("truncated-text")) {
          add("truncated-text", [item.element, clip.element], { element: describe(item), box: round(item.visible), saw: JSON.stringify(item.text.slice(0, 60)) + " is shortened with an ellipsis: " + Math.round(width(inside)) + " of its " + Math.round(width(item.rect)) + " px show" })
        } else if (!meant && checks.has("cut-text")) {
          add("cut-text", [item.element, clip.element], { element: describe(item), box: round(item.visible), saw: JSON.stringify(item.text.slice(0, 60)) + " is cut by the edge of " + selector(clip.element) + " (" + Math.round(width(inside)) + " x " + Math.round(height(inside)) + " of " + Math.round(width(item.rect)) + " x " + Math.round(height(item.rect)) + " px show), with nothing to say it is cut" })
        }
        break
      }
    }
    if (checks.has("truncated-text")) {
      for (const element of scope().querySelectorAll("*")) {
        if (cut.has(element) || !shown(element)) continue
        const style = getComputedStyle(element)
        if (style.webkitLineClamp === undefined || style.webkitLineClamp === "none" || element.scrollHeight <= element.clientHeight + 1) continue
        cut.add(element)
        add("truncated-text", [element], { element: { kind: "text", selector: selector(element), text: textOf(element).slice(0, 60) }, box: round(box(element.getBoundingClientRect())), saw: "the text is clamped to " + style.webkitLineClamp + " lines and the rest is hidden" })
      }
    }

    // off-screen, safe-area, scroll-edge: where the visible part of each item is.
    const scrollEdge = new Set()
    const edgeOf = (item, saw) => {
      const key = item.scroller.element
      if (scrollEdge.has(key)) return
      scrollEdge.add(key)
      add("scroll-edge", [item.owner, item.scroller.element], { element: describe(item), box: round(item.visible), saw })
    }
    const placed = new Set()
    // A control's own box first: its text is judged only when the box is fine.
    for (const item of [...all].sort((a, b) => (a.kind === "text" ? 1 : 0) - (b.kind === "text" ? 1 : 0))) {
      if (item.kind === "touch") {
        // The button is a circle: how far it reaches past each edge, with the same 2 px allowance as a box.
        const past = (edges) => Math.max(edges.l - (item.centre.x - item.radius), edges.t - (item.centre.y - item.radius), item.centre.x + item.radius - edges.r, item.centre.y + item.radius - edges.b)
        const out = past(viewport) > 2
        if (out && checks.has("off-screen")) add("off-screen", [item.element], { element: describe(item), box: round(item.rect), saw: "the touch button " + JSON.stringify(item.text) + " reaches past the edge of the screen" })
        else if (!out && checks.has("safe-area") && past(safe) > 2) add("safe-area", [item.element], { element: describe(item), box: round(item.rect), saw: "the touch button " + JSON.stringify(item.text) + " reaches " + Math.round(past(safe)) + " px into the space the device keeps (a notch, a home bar)" })
        continue
      }
      if (placed.has(item.owner) || area(item.visible) < 1) continue
      // A control that draws nothing (a touch area over the stage) has nothing to cut; its text is measured on its own.
      if (item.kind === "control" && !item.painted) continue
      // A box that spans the whole screen (the game's root, the body) cuts at the screen's edge: that is off-screen, not a cut.
      const shownPart = item.clips.filter((clip) => !contains(clip.box, viewport)).reduce((rect, clip) => meet(rect, clip.box), item.rect)
      if (area(shownPart) > area(item.visible) + 1) item.visible = shownPart
      const onScreen = meet(item.visible, viewport)
      if (area(onScreen) < 1) continue
      if (item.kind === "control" && item.scroller !== undefined && checks.has("scroll-edge")) {
        const shownShare = area(item.visible) / Math.max(1, area(item.rect))
        if (shownShare > 0.1 && shownShare < 0.9) {
          edgeOf(item, "only " + Math.round(shownShare * 100) + "% of it shows at the edge of a scrolling area")
        }
      }
      const past = area(onScreen) < area(item.visible) - 1
      if (past) {
        placed.add(item.owner)
        if (item.scroller !== undefined) {
          if (checks.has("scroll-edge")) edgeOf(item, "its scrolling area runs past the edge of the screen")
        } else if (pageScrolls && item.visible.t >= 0 && item.visible.l >= 0 && item.visible.r <= screenWidth + 1) {
          // Below the fold of a page that scrolls: not cut.
        } else if (checks.has("off-screen")) {
          add("off-screen", [item.owner], { element: describe(item), box: round(item.visible), saw: "it reaches past the " + ["left", "top", "right", "bottom"].filter((side, index) => [item.visible.l < -1, item.visible.t < -1, item.visible.r > screenWidth + 1, item.visible.b > screenHeight + 1][index]).join(" and ") + " edge of the screen" })
        }
        continue
      }
      if (item.scroller !== undefined || !checks.has("safe-area")) continue
      // A control over the whole safe area ("tap anywhere to start", a scrim) is meant to fill the screen; its text is judged on its own.
      if (item.kind === "control" && contains(onScreen, safe)) continue
      const inSafe = meet(onScreen, safe)
      if (area(inSafe) < area(onScreen) - 1) {
        placed.add(item.owner)
        const sides = ["left", "top", "right", "bottom"].filter((side, index) => [onScreen.l < safe.l - 1, onScreen.t < safe.t - 1, onScreen.r > safe.r + 1, onScreen.b > safe.b + 1][index])
        add("safe-area", [item.owner], { element: describe(item), box: round(onScreen), saw: "it reaches into the space the device keeps on the " + sides.join(" and ") + " (" + sides.map((side) => insets[side] + " px").join(", ") + ": a notch or the home bar)" })
      }
    }

    // small-target: the area that takes a tap, by hit tests through the control's centre.
    if (checks.has("small-target")) {
      for (const item of all) {
        if (item.kind === "touch") {
          if (item.radius * 2 < minTarget) add("small-target", [item.element], { element: describe(item), box: round(item.rect), saw: "the touch button " + JSON.stringify(item.text) + " is " + Math.round(item.radius * 2) + " px across (at least " + minTarget + ")" })
          continue
        }
        if (item.kind !== "control") continue
        if (width(item.rect) >= minTarget && height(item.rect) >= minTarget) continue
        if (area(item.visible) < area(item.rect) - 1 || area(meet(item.visible, viewport)) < area(item.visible) - 1) continue
        const tap = tapExtent(item, minTarget * 2)
        // Something else takes a tap at its centre: it is behind a layer now, not a target (overlap reports a partial cover).
        if (tap.box === null) continue
        if (tap.width >= minTarget && tap.height >= minTarget) continue
        add("small-target", [item.element], {
          element: describe(item),
          box: round(tap.box),
          saw: "a tap reaches it over " + tap.width + " x " + tap.height + " px (at least " + minTarget + " x " + minTarget + ")"
        })
      }
    }
    return { findings, measured: all.length, allowed: skipped }
  }

  const steady = () => { steadyFrom = performance.now() }
  const shifts = (allow) => {
    const out = []
    let skipped = 0
    const seen = new Set()
    for (const entry of shiftLog) {
      if (entry.time < steadyFrom) continue
      for (const node of entry.nodes) {
        const element = node.nodeType === 1 ? node : node.parentElement
        if (element === null || seen.has(element) || element.id === marksId) continue
        seen.add(element)
        if (allowed(allow, "layout-shift", [element])) { skipped++; continue }
        out.push({ check: "layout-shift", element: { kind: "text", selector: selector(element), text: textOf(element).slice(0, 60) }, box: round(box(element.getBoundingClientRect())), saw: "it moved while nothing was pressed (layout shift " + entry.value.toFixed(4) + ")" })
      }
    }
    return { findings: out, allowed: skipped }
  }

  // Longer text: about 40% more of every text, kept as the game renders new text.
  const written = new WeakMap()
  const padNode = (node) => {
    if (node.nodeValue.trim() === "" || written.get(node) === node.nodeValue) return
    const parent = node.parentElement
    if (parent === null || parent.closest("script, style, noscript, template, #" + marksId) !== null) return
    // The text's own letters, so the added width is the font's own: about 40% more.
    const longer = node.nodeValue.replace(/\S(?:[\s\S]*\S)?/, (text) => text + " " + text.repeat(2).slice(0, Math.ceil(text.length * 0.4)))
    written.set(node, longer)
    node.nodeValue = longer
  }
  const padAll = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node)
    nodes.forEach(padNode)
  }
  const pad = () => {
    padAll(document.body)
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") padNode(record.target)
        for (const added of record.addedNodes) {
          if (added.nodeType === 3) padNode(added)
          else if (added.nodeType === 1) padAll(added)
        }
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  }

  const unmark = () => document.getElementById(marksId)?.remove()
  const mark = (boxes) => {
    unmark()
    const layer = document.createElement("div")
    layer.id = marksId
    layer.setAttribute("popover", "manual")
    layer.style.cssText = "position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;height:100vh;max-width:none;max-height:none;background:transparent;overflow:visible;pointer-events:none"
    for (const entry of boxes) {
      const outline = document.createElement("div")
      outline.style.cssText = "position:fixed;box-sizing:border-box;left:" + entry.l + "px;top:" + entry.t + "px;width:" + Math.max(2, entry.r - entry.l) + "px;height:" + Math.max(2, entry.b - entry.t) + "px;border:2px solid " + entry.color + ";background:" + entry.color + "22"
      const tag = document.createElement("span")
      tag.textContent = String(entry.number)
      tag.style.cssText = "position:absolute;left:-2px;bottom:100%;font:700 11px/14px system-ui,sans-serif;color:#fff;background:" + entry.color + ";padding:0 4px"
      outline.appendChild(tag)
      layer.appendChild(outline)
    }
    document.body.appendChild(layer)
    if (typeof layer.showPopover === "function") layer.showPopover()
  }

  globalThis.__ritmoLayout = { snapshot, audit, steady, shifts, pad, mark, unmark }
})()`
