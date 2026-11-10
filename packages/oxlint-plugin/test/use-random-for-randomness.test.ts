import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["use-random-for-randomness"]!

tester.run("use-random-for-randomness", rule, {
  valid: [
    "const random = Random.draw(resources.rng); const crit = random.next() < 0.1",
    "const kind = Random.draw(resources.rng).pick(kinds)",
    "const Math = { random: () => 0.5 }; Math.random()",
    "const value = Math.floor(x) + Math.max(a, b)",
    "const id = counter.next()",
    // Locals, parameters, and imports named like the globals.
    "const Math = makeMath(); const { random } = Math; Math.random()",
    "function id(crypto: Ids) { return crypto.randomUUID() }",
    "import { crypto } from \"./ids.ts\"; crypto.getRandomValues(bytes)",
    "const self = worker(); self.Math.random()",
    // A field of the same name on another object.
    "const roll = stats.Math.random() + config.crypto.randomUUID()",
    // Types never run.
    "type Roll = typeof Math.random; let draw: typeof crypto.getRandomValues",
    "const { floor, abs } = globalThis.Math"
  ],
  invalid: [
    { code: "const crit = Math.random() < 0.1", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "const roll = Math[\"random\"]()", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "crypto.getRandomValues(bytes)", errors: [{ messageId: "random", data: { call: "crypto.getRandomValues()" } }] },
    { code: "const id = crypto.randomUUID()", errors: [{ messageId: "uuid" }] },
    // Reached through a global object, an alias, or destructuring.
    { code: "const crit = globalThis.Math.random() < 0.1", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "const crit = self.Math.random() + window.Math.random()", errors: [{ messageId: "random" }, { messageId: "random" }] },
    { code: "globalThis.crypto.getRandomValues(bytes)", errors: [{ messageId: "random", data: { call: "crypto.getRandomValues()" } }] },
    { code: "const roll = Math; roll.random()", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    // Reported once, where the global is read.
    { code: "const { random } = Math; const crit = random() < 0.1", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "const { random: draw } = globalThis.Math", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "const { Math: { random } } = globalThis", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "const M = globalThis.Math; const { random } = M", errors: [{ messageId: "random", data: { call: "Math.random()" } }] },
    { code: "const { randomUUID } = crypto", errors: [{ messageId: "uuid" }] }
  ]
})
