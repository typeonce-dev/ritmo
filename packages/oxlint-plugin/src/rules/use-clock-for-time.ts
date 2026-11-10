import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

import { calledMethod, docsUrl, globalPath, globalRead } from "../internal/ast.ts"

const timers = new Set(["setTimeout", "setInterval", "setImmediate", "requestAnimationFrame", "requestIdleCallback", "queueMicrotask"])

/** The globals that read the wall clock, by path, with the call named in the report. */
const wallClocks = new Map([
  ["Date.now", "Date.now()"],
  ["performance.now", "performance.now()"],
  ["performance.timeOrigin", "performance.timeOrigin"],
  ["performance.mark", "performance.mark()"],
  ["process.hrtime", "process.hrtime()"],
  ["Temporal.Now", "Temporal.Now"]
])

/**
 * Simulation code reads time from the world's Clock, never from the wall
 * clock or a host timer, so a run replays exactly.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Read time from the Clock resource in simulation code, not the wall clock or host timers.",
      url: docsUrl("use-clock-for-time")
    },
    messages: {
      wallClock:
        "{{call}} reads the wall clock, so the simulation plays differently on every run and replays diverge. For time since the start, read the Clock resource (`Clock.elapsed(time)` in seconds, `time.step` in steps). For today's date, read it in host code and pass it in with `runtime.send(...)` or a resource, so the replay records it.",
      timer:
        "{{call}}() runs its callback outside the tick, at a moment a replay cannot reproduce. Count steps instead: store the step it fires at (`Clock.deadline(time, Clock.duration(step, seconds))`) in a component or resource and check it each tick with `Clock.reached(time, due)`, or use `Clock.every(time, duration)` for something that repeats."
    },
    schema: []
  },
  create(context) {
    /** Reports a read of a wall clock: a member (`globalThis.Date.now`) or a destructured property (`const { now } = Date`). */
    const check = (node: ESTree.Node): void => {
      const path = globalRead(context, node)?.path
      const call = path === undefined ? undefined : wallClocks.get(path)
      if (call !== undefined) context.report({ node, messageId: "wallClock", data: { call } })
    }
    return {
      MemberExpression: check,
      Property: check,
      NewExpression(node) {
        if (node.arguments.length === 0 && globalPath(context, node.callee) === "Date") {
          context.report({ node, messageId: "wallClock", data: { call: "new Date()" } })
        }
      },
      CallExpression(node) {
        // The host's time zone, which a replay on another device does not share.
        if (calledMethod(node) === "getTimezoneOffset") {
          context.report({ node, messageId: "wallClock", data: { call: "getTimezoneOffset()" } })
          return
        }
        const callee = globalPath(context, node.callee)
        // `Date()` without `new` returns the current time as a string, whatever its arguments.
        if (callee === "Date") context.report({ node, messageId: "wallClock", data: { call: "Date()" } })
        if (callee !== undefined && timers.has(callee)) context.report({ node, messageId: "timer", data: { call: callee } })
      }
    }
  }
})
