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
    "assertRestored(runtime.restore(save))"
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
    {
      code: "world.tick(update)",
      options: [{ runtimePattern: "^world$" }],
      errors: [{ messageId: "tick", data: { call: "world.tick" } }]
    }
  ]
})
