import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["use-clock-for-time"]!

tester.run("use-clock-for-time", rule, {
  valid: [
    "const seconds = Clock.elapsed(resources.time.get())",
    "const due = Clock.deadline(time, Clock.duration(step, 0.5))",
    "if (Clock.every(time, spawnEvery)) spawn()",
    // Formatting a timestamp the game was given reads no clock.
    "const day = new Date(save.createdAt).getUTCDate()",
    // Local names that shadow the globals.
    "const Date = { now: () => 0 }; Date.now()",
    "const performance = sample(); performance.now()",
    "function run(setTimeout: (f: () => void) => void) { setTimeout(() => {}) }",
    // A method of the same name on another object.
    "scheduler.setTimeout(tick, 10)"
  ],
  invalid: [
    { code: "if (Date.now() - started > 3000) open()", errors: [{ messageId: "wallClock", data: { call: "Date.now()" } }] },
    { code: "const t = performance.now()", errors: [{ messageId: "wallClock", data: { call: "performance.now()" } }] },
    { code: "const today = new Date()", errors: [{ messageId: "wallClock", data: { call: "new Date()" } }] },
    { code: "setTimeout(() => spawnWave(), 500)", errors: [{ messageId: "timer", data: { call: "setTimeout" } }] },
    { code: "const id = setInterval(step, 16)", errors: [{ messageId: "timer", data: { call: "setInterval" } }] },
    { code: "requestAnimationFrame(loop)", errors: [{ messageId: "timer", data: { call: "requestAnimationFrame" } }] },
    { code: "queueMicrotask(() => flush())", errors: [{ messageId: "timer", data: { call: "queueMicrotask" } }] }
  ]
})
