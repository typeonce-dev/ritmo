import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["handle-runtime-result"]!

tester.run("handle-runtime-result", rule, {
  valid: [
    "const ran = runtime.tick(update); if (!ran.ok) report(ran.error)",
    "if (!runtime.tick(setup).ok) throw new Error(\"setup failed\")",
    "const restored = runtime.restore(save); if (!restored.ok) showError(restored.error)",
    "void runtime.tick(render)",
    "const rewound = runtime.rewind(checkpoint); if (!rewound.ok) resync(rewound.error)",
    "replay.rewind(5)",
    "const step = () => runtime.tick(update)",
    // Game wrappers and other libraries with methods of the same name (inkline-town headless.ts, spirit-call tests).
    "town.restore(snapshot)",
    "run.tick(60)",
    "app.ticker.tick()",
    "runtime.tick()",
    // Kept as a Result, or read through it
    "const saved = runtime.snapshot(); if (saved.ok) persist(saved.value)",
    "if (runtime.checksum().ok) mark()",
    "state.save = runtime.snapshot()",
    "const load = () => runtime.restore(save)",
    "function save() { return runtime.snapshot() }",
    "const saved = cached ?? runtime.snapshot()",
    "void runtime.snapshot()",
    // Other libraries' methods of the same name
    "persist(store.snapshot())",
    "log(`${runtime.checksum(file)}`)",
    // A helper that takes the Result checks it (spirit-call tests and main.ts)
    "expectOk(run.runtime.tick(Game.Schedule(FaceNorth)))",
    "orCrash(runtime.tick(setup), \"Setup\")",
    "assertRestored(runtime.restore(save))",
    // A callback whose result its caller keeps.
    "const results = updates.map((u) => runtime.tick(u))",
    "loop.start(() => runtime.tick(update))",
    // The last expression of a sequence is its value.
    "const ran = (draw(), runtime.tick(update))",
    // `.ok` read through a test, `void` in a callback.
    "if (runtime.restore(save).ok) resume()",
    "requestAnimationFrame(() => void runtime.tick(update))",
    "updates.forEach((u) => { const ran = runtime.tick(u); if (!ran.ok) report(ran.error) })",
    // Destructured from something not named like a runtime, or not a Result method.
    "const { tick } = clock\ntick(update)",
    "const { debug } = runtime\ndebug.nameSchedules({})",
    "const { restore: load } = t.runtime\nexpectOk(load(save))",
    // Receivers that cannot be told from a runtime by syntax.
    "game.tick(update)",
    "const rt = makeRuntime()\nrt.tick(update)",
    "let made = Game.Runtime.make(options)\nmade = other\nmade.value.tick(update)",
    "const world = Game.Runtime.make(options)\nworld.tick(update)"
  ],
  invalid: [
    {
      // spirit-call src/main.ts
      code: "runtime.tick(setup)\nruntime.tick(fixedUpdate)",
      errors: [
        { messageId: "tick", data: { call: "runtime.tick" } },
        { messageId: "tick", data: { call: "runtime.tick" } }
      ]
    },
    {
      // inkline-town src/main.ts
      code: "for (let i = 0; i < steps; i++) runtime.tick(simulate)",
      errors: [{ messageId: "tick", data: { call: "runtime.tick" } }]
    },
    { code: "t.runtime.restore(save)", errors: [{ messageId: "restore", data: { call: "t.runtime.restore" } }] },
    { code: "runtime.rewind(history.get(wrong))", errors: [{ messageId: "rewind", data: { call: "runtime.rewind" } }] },
    { code: "this.runtime.tryTick(schedule)", errors: [{ messageId: "tick", data: { call: "this.runtime.tryTick" } }] },
    { code: "gameRuntime.tick(update)", errors: [{ messageId: "tick", data: { call: "gameRuntime.tick" } }] },
    {
      // inkline-town: a save written through a parameter typed unknown saved the Result itself
      code: "persist(runtime.snapshot())",
      errors: [{ messageId: "unchecked", data: { call: "runtime.snapshot" } }]
    },
    { code: "storage.setItem(\"save\", JSON.stringify(runtime.snapshot()))", errors: [{ messageId: "unchecked", data: { call: "runtime.snapshot" } }] },
    { code: "log(`hash ${runtime.checksum()}`)", errors: [{ messageId: "unchecked", data: { call: "runtime.checksum" } }] },
    { code: "send({ hash: runtime.checksum() })", errors: [{ messageId: "unchecked", data: { call: "runtime.checksum" } }] },
    { code: "upload(runtime.snapshot() as unknown)", errors: [{ messageId: "unchecked", data: { call: "runtime.snapshot" } }] },
    { code: "console.log(runtime.tick(update))", errors: [{ messageId: "unchecked", data: { call: "runtime.tick" } }] },
    { code: "JSON.stringify(runtime.restore(save))", errors: [{ messageId: "unchecked", data: { call: "runtime.restore" } }] },
    { code: "results.push({ ran: runtime.tick(update) })", errors: [{ messageId: "unchecked", data: { call: "runtime.tick" } }] },
    { code: "expectOk(runtime.snapshot())", errors: [{ messageId: "unchecked", data: { call: "runtime.snapshot" } }] },
    { code: "\"hash \" + runtime.checksum()", errors: [{ messageId: "unchecked", data: { call: "runtime.checksum" } }] },
    { code: "runtime.snapshot()", errors: [{ messageId: "dropped", data: { call: "runtime.snapshot" } }] },
    // A callback whose caller drops what it returns.
    {
      code: "updates.forEach((u) => runtime.tick(u))",
      errors: [{ messageId: "tick", data: { call: "runtime.tick" } }]
    },
    {
      code: "requestAnimationFrame(() => runtime.tick(update))",
      errors: [{ messageId: "tick", data: { call: "runtime.tick" } }]
    },
    {
      code: "window.addEventListener(\"load\", () => runtime.restore(save))",
      errors: [{ messageId: "restore", data: { call: "runtime.restore" } }]
    },
    {
      code: "setTimeout(() => runtime.snapshot(), 100)",
      errors: [{ messageId: "dropped", data: { call: "runtime.snapshot" } }]
    },
    // A sequence drops every value but its last.
    {
      code: "runtime.tick(update), draw()",
      errors: [{ messageId: "tick", data: { call: "runtime.tick" } }]
    },
    {
      code: "for (let i = 0; i < 3; runtime.tick(update), i++) draw()",
      errors: [{ messageId: "tick", data: { call: "runtime.tick" } }]
    },
    // A Result is an object: tested as a boolean, it is always true.
    {
      code: "if (!runtime.tick(update)) stop()",
      errors: [{ messageId: "truthy", data: { call: "runtime.tick" } }]
    },
    {
      code: "if (runtime.restore(save)) resume()",
      errors: [{ messageId: "truthy", data: { call: "runtime.restore" } }]
    },
    {
      code: "const ok = runtime.rewind(checkpoint) ? \"rewound\" : \"stale\"",
      errors: [{ messageId: "truthy", data: { call: "runtime.rewind" } }]
    },
    {
      code: "while (runtime.tryTick(update) && frames-- > 0) draw()",
      errors: [{ messageId: "truthy", data: { call: "runtime.tryTick" } }]
    },
    // A method destructured from a runtime.
    {
      code: "const { tick } = runtime\ntick(update)",
      errors: [{ messageId: "tick", data: { call: "tick" } }]
    },
    {
      code: "const { restore: load } = t.runtime\nload(save)",
      errors: [{ messageId: "restore", data: { call: "load" } }]
    },
    {
      code: "const { snapshot } = runtime\npersist(snapshot())",
      errors: [{ messageId: "unchecked", data: { call: "snapshot" } }]
    },
    // A const made by Game.Runtime.make in the file, whatever its name.
    {
      code: "const made = Game.Runtime.make(options)\nmade.value.tick(update)",
      errors: [{ messageId: "tick", data: { call: "made.value.tick" } }]
    },
    {
      code: "const made = Game.Runtime.make(options)\nconst game = made.value\ngame.tick(update)\nif (game.restore(save)) resume()",
      errors: [
        { messageId: "tick", data: { call: "game.tick" } },
        { messageId: "truthy", data: { call: "game.restore" } }
      ]
    },
    {
      code: "world.tick(update)",
      options: [{ runtimePattern: "^world$" }],
      errors: [{ messageId: "tick", data: { call: "world.tick" } }]
    }
  ]
})
