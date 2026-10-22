import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["handle-tick-result"]!

tester.run("handle-tick-result", rule, {
  valid: [
    "const ran = runtime.tick(update); if (ran._tag === \"Failure\") report(ran.failure)",
    "if (runtime.tick(setup)._tag === \"Failure\") throw new Error(\"setup failed\")",
    "const restored = runtime.restore(save); if (restored._tag === \"Failure\") showError(restored.failure)",
    "void runtime.tick(render)",
    "const step = () => runtime.tick(update)",
    // Game wrappers and other libraries with methods of the same name (inkline-town headless.ts, spirit-call tests).
    "town.restore(snapshot)",
    "run.tick(60)",
    "app.ticker.tick()",
    "runtime.tick()"
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
    { code: "this.runtime.tryTick(schedule)", errors: [{ messageId: "tick", data: { call: "this.runtime.tryTick" } }] },
    { code: "gameRuntime.tick(update)", errors: [{ messageId: "tick", data: { call: "gameRuntime.tick" } }] },
    {
      code: "world.tick(update)",
      options: [{ runtimePattern: "^world$" }],
      errors: [{ messageId: "tick", data: { call: "world.tick" } }]
    }
  ]
})
