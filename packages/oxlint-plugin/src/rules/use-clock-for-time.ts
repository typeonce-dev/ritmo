import { defineRule } from "@oxlint/plugins"

import { docsUrl, globalMember, isGlobalIdentifier, isGlobalReference } from "../internal/ast.ts"

const timers = ["setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback", "queueMicrotask"]

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
    return {
      MemberExpression(node) {
        for (const object of ["Date", "performance"]) {
          if (globalMember(context, node, object) === "now") {
            context.report({ node, messageId: "wallClock", data: { call: `${object}.now()` } })
          }
        }
      },
      NewExpression(node) {
        if (node.arguments.length === 0 && isGlobalIdentifier(context, node.callee, "Date")) {
          context.report({ node, messageId: "wallClock", data: { call: "new Date()" } })
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== "Identifier" || !timers.includes(callee.name)) return
        if (!isGlobalReference(context, callee)) return
        context.report({ node, messageId: "timer", data: { call: callee.name } })
      }
    }
  }
})
