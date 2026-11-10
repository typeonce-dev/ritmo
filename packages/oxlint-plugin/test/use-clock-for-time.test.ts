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
    "scheduler.setTimeout(tick, 10)",
    // Locals, parameters, and imports named like the globals.
    "const Date = makeDate(); Date.now(); new Date(); Date()",
    "const read = (performance: Stats) => performance.now()",
    "import { performance } from \"./stats.ts\"; const { now } = performance",
    "const self = worker(); self.setTimeout(tick, 10); self.Date.now()",
    // A field of the same name on another object.
    "const t = config.Date.now() + game.performance.now() + game.process.hrtime()",
    // Types never run.
    "let at: Date; type Now = typeof performance.now",
    // Date's static helpers only compute with the values they are given.
    "const start = Date.UTC(2026, 0, 1); const { UTC, parse } = Date",
    "const { setTimeout } = scheduler; setTimeout(tick)"
  ],
  invalid: [
    { code: "if (Date.now() - started > 3000) open()", errors: [{ messageId: "wallClock", data: { call: "Date.now()" } }] },
    { code: "const t = performance.now()", errors: [{ messageId: "wallClock", data: { call: "performance.now()" } }] },
    { code: "const today = new Date()", errors: [{ messageId: "wallClock", data: { call: "new Date()" } }] },
    { code: "setTimeout(() => spawnWave(), 500)", errors: [{ messageId: "timer", data: { call: "setTimeout" } }] },
    { code: "const id = setInterval(step, 16)", errors: [{ messageId: "timer", data: { call: "setInterval" } }] },
    { code: "requestAnimationFrame(loop)", errors: [{ messageId: "timer", data: { call: "requestAnimationFrame" } }] },
    { code: "queueMicrotask(() => flush())", errors: [{ messageId: "timer", data: { call: "queueMicrotask" } }] },
    { code: "setImmediate(() => flush())", errors: [{ messageId: "timer", data: { call: "setImmediate" } }] },
    { code: "const today = Date()", errors: [{ messageId: "wallClock", data: { call: "Date()" } }] },
    { code: "const t = process.hrtime.bigint()", errors: [{ messageId: "wallClock", data: { call: "process.hrtime()" } }] },
    { code: "const origin = performance.timeOrigin", errors: [{ messageId: "wallClock", data: { call: "performance.timeOrigin" } }] },
    { code: "performance.mark(\"wave\")", errors: [{ messageId: "wallClock", data: { call: "performance.mark()" } }] },
    { code: "const at = Temporal.Now.instant()", errors: [{ messageId: "wallClock", data: { call: "Temporal.Now" } }] },
    { code: "const offset = new Date(save.createdAt).getTimezoneOffset()", errors: [{ messageId: "wallClock", data: { call: "getTimezoneOffset()" } }] },
    // Reached through a global object, an alias, or destructuring.
    { code: "const t = globalThis.Date.now()", errors: [{ messageId: "wallClock", data: { call: "Date.now()" } }] },
    { code: "const t = globalThis.performance.now()", errors: [{ messageId: "wallClock", data: { call: "performance.now()" } }] },
    { code: "const t = self.performance.now() - window.Date.now()", errors: [{ messageId: "wallClock" }, { messageId: "wallClock" }] },
    { code: "globalThis.setTimeout(() => spawnWave(), 500)", errors: [{ messageId: "timer", data: { call: "setTimeout" } }] },
    { code: "const wait = setTimeout; wait(spawnWave, 500)", errors: [{ messageId: "timer", data: { call: "setTimeout" } }] },
    { code: "const D = globalThis.Date; const today = new D()", errors: [{ messageId: "wallClock", data: { call: "new Date()" } }] },
    // Reported once, where the global is read.
    { code: "const { now } = Date; const t = now()", errors: [{ messageId: "wallClock", data: { call: "Date.now()" } }] },
    { code: "const { now: n } = performance", errors: [{ messageId: "wallClock", data: { call: "performance.now()" } }] },
    { code: "const { performance: { now } } = globalThis", errors: [{ messageId: "wallClock", data: { call: "performance.now()" } }] },
    { code: "const { setTimeout: later } = globalThis; later(spawnWave, 500)", errors: [{ messageId: "timer", data: { call: "setTimeout" } }] }
  ]
})
