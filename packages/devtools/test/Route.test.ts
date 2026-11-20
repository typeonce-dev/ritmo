import { describe, expect, it } from "vitest"

import type * as RouteModule from "../src/internal/route.ts"

// The route is internal to the CLI (the package exports no `internal/*`): load its source.
const Route = await import(new URL("../src/internal/route.ts", import.meta.url).href) as typeof RouteModule

const error = (value: unknown) => {
  const parsed = Route.parseRoute(value)
  return parsed.ok ? undefined : parsed.error
}

describe("route", () => {
  it("fills in a screen's and the route's defaults", () => {
    expect(Route.parseRoute({ screens: [{ name: "title" }] })).toEqual({
      ok: true,
      value: { screens: [{ name: "title", path: "", steps: [], noPress: [], allow: [] }], viewports: Route.defaultViewports, minTarget: 44, allow: [] }
    })
  })

  it("keeps every kind of step and both kinds of noPress", () => {
    const parsed = Route.parseRoute({
      screens: [
        { name: "play", path: "?map=8", steps: [{ press: "Escape" }, { type: "Ada" }, { click: { role: "button", name: "Play" } }, { waitFor: { role: "button", name: "Resume" } }, { wait: 500 }], noPress: [{ name: "Start over", role: "button" }] },
        { name: "end", noPress: true }
      ]
    })
    expect(parsed.ok && parsed.value.screens).toEqual([
      { name: "play", path: "?map=8", steps: [{ press: "Escape" }, { type: "Ada" }, { click: { role: "button", name: "Play" } }, { waitFor: { role: "button", name: "Resume" } }, { wait: 500 }], noPress: [{ name: "Start over", role: "button" }], allow: [] },
      { name: "end", path: "", steps: [], noPress: true, allow: [] }
    ])
  })

  it("keeps the layout audit's fields", () => {
    const parsed = Route.parseRoute({
      screens: [{ name: "home", allow: [{ check: "overlap", selector: ".card .badge" }] }],
      viewports: [{ name: "phone", width: 844, height: 390, touch: true, insets: { left: 47, right: 47 } }, { name: "desktop", width: 1280, height: 800 }],
      minTarget: 42,
      allow: [{ check: "truncated-text", selector: ".name" }]
    })
    expect(parsed).toEqual({
      ok: true,
      value: {
        screens: [{ name: "home", path: "", steps: [], noPress: [], allow: [{ check: "overlap", selector: ".card .badge" }] }],
        viewports: [
          { name: "phone", width: 844, height: 390, touch: true, insets: { top: 0, right: 47, bottom: 0, left: 47 } },
          { name: "desktop", width: 1280, height: 800, touch: false, insets: { top: 0, right: 0, bottom: 0, left: 0 } }
        ],
        minTarget: 42,
        allow: [{ check: "truncated-text", selector: ".name" }]
      }
    })
  })

  it("names the field that is wrong", () => {
    expect(error([])).toBe("the route must be an object { \"screens\": [...] }")
    expect(error({ screens: [] })).toBe("route.screens must be a non-empty array")
    expect(error({ screens: [{ name: "a" }], extra: 1 })).toBe("route.extra is not a field (expected screens, viewports, minTarget, allow)")
    expect(error({ screens: [{ name: "" }] })).toBe("route.screens[0].name must be a non-empty string")
    expect(error({ screens: [{ name: "a" }, { name: "a" }] })).toBe("route.screens[1].name \"a\" is already the name of another screen")
    expect(error({ screens: [{ name: "a", url: "/" }] })).toBe("route.screens[0].url is not a field (expected name, path, steps, noPress, allow)")
    expect(error({ screens: [{ name: "a", steps: [{ click: { role: "button" } }] }] })).toBe("route.screens[0].steps[0].click.name must be a non-empty string: the control's accessible name")
    expect(error({ screens: [{ name: "a", steps: [{ waitFor: { name: "Play" } }] }] })).toBe("route.screens[0].steps[0].waitFor.role must be a non-empty string: an ARIA role such as \"button\"")
    expect(error({ screens: [{ name: "a", steps: [{ wait: 1.5 }] }] })).toBe("route.screens[0].steps[0].wait must be a whole number of milliseconds from 0 to 60000")
    expect(error({ screens: [{ name: "a", steps: [{ press: "a", wait: 1 }] }] })).toMatch(/^route\.screens\[0\]\.steps\[0\] must be one of/)
    expect(error({ screens: [{ name: "a", steps: [{ drag: "abc" }] }] })).toMatch(/drag is not a step$/)
    expect(error({ screens: [{ name: "a", steps: [{ type: "" }] }] })).toBe("route.screens[0].steps[0].type must be the text to type into the focused field (\"Ada\")")
    expect(error({ screens: [{ name: "a", noPress: [{ role: "button" }] }] })).toBe("route.screens[0].noPress[0].name must be a non-empty string: the control's accessible name")
    expect(error({ screens: [{ name: "a", noPress: false }] })).toBe("route.screens[0].noPress must be true (press nothing on this screen) or an array of { \"name\", \"role\"? }")
    expect(error({ screens: [{ name: "a", allow: [{ check: "overlaps", selector: ".a" }] }] })).toBe(`route.screens[0].allow[0].check must be one of ${Route.layoutChecks.join(", ")}`)
    expect(error({ screens: [{ name: "a", allow: [{ check: "overlap" }] }] })).toBe("route.screens[0].allow[0].selector must be a CSS selector of the element the finding names, such as \".card .badge\"")
    expect(error({ screens: [{ name: "a" }], viewports: [] })).toBe("route.viewports must be a non-empty array of { \"name\", \"width\", \"height\", \"touch\"?, \"insets\"? }")
    expect(error({ screens: [{ name: "a" }], viewports: [{ name: "p", width: 100, height: 400 }] })).toBe("route.viewports[0].width must be a whole number of CSS pixels from 200 to 4000")
    expect(error({ screens: [{ name: "a" }], viewports: [{ name: "p", width: 400, height: 400, insets: { left: -1 } }] })).toBe("route.viewports[0].insets.left must be a whole number of CSS pixels from 0 to 200")
    expect(error({ screens: [{ name: "a" }], viewports: [{ name: "p", width: 400, height: 400 }, { name: "p", width: 500, height: 400 }] })).toBe("route.viewports[1].name \"p\" is already the name of another viewport")
    expect(error({ screens: [{ name: "a" }], minTarget: 0 })).toBe("route.minTarget must be a whole number of CSS pixels from 1 to 200 (the smallest tap area either side)")
  })
})
