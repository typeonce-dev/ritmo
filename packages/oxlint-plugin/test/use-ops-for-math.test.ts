import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["use-ops-for-math"]!

tester.run("use-ops-for-math", rule, {
  valid: [
    "import { Ops } from \"@typeonce/ritmo\"; const turn = Ops.atan2(Ops.sin(b - a), Ops.cos(b - a))",
    // Exact everywhere.
    "const d = Math.sqrt(dx * dx + dy * dy) + Math.abs(x) + Math.min(a, b) + Math.floor(t) + Math.sign(v)",
    "const tau = Math.PI * 2",
    "const low = Math[\"floor\"](x)",
    "const area = radius ** 2",
    "let s = side; s **= 2",
    // Destructuring only exact members hides nothing.
    "const { abs, min, PI } = Math",
    "const { sqrt: root = fallback } = Math",
    "let floor; ({ floor } = Math)",
    "const has = \"fround\" in Math",
    // Types never run.
    "type Lib = typeof Math; let sin: typeof Math.sin",
    // A local Math is not the global.
    "const Math = { sin: (x: number) => x }; Math.sin(1)",
    "function f(Math: { sin(x: number): number }) { const M = Math; return M.sin(1) + Math[key]!(1) }"
  ],
  invalid: [
    {
      // inkline-town mapgen.ts: several reports in one file add the import once, in one pass.
      code: "const turn = Math.atan2(Math.sin(b - a), Math.cos(b - a))",
      output: "import { Ops } from \"@typeonce/ritmo\"\nconst turn = Ops.atan2(Ops.sin(b - a), Ops.cos(b - a))",
      errors: [
        { messageId: "math", data: { name: "atan2" } },
        { messageId: "math", data: { name: "sin" } },
        { messageId: "math", data: { name: "cos" } }
      ]
    },
    {
      // The import goes after the last import, with the file's semicolons.
      code: "import { Clock } from \"@typeonce/ritmo\";\nimport { Vec2 } from \"@typeonce/ritmo-math\";\n\nconst length = Math.hypot(dx, dy);\nconst bits = Math.log2(size);",
      output:
        "import { Clock } from \"@typeonce/ritmo\";\nimport { Vec2 } from \"@typeonce/ritmo-math\";\nimport { Ops } from \"@typeonce/ritmo\";\n\nconst length = Ops.hypot(dx, dy);\nconst bits = Ops.log2(size);",
      errors: [{ messageId: "math", data: { name: "hypot" } }, { messageId: "math", data: { name: "log2" } }]
    },
    {
      code: "const beauty = base * repeat ** n",
      output: "import { Ops } from \"@typeonce/ritmo\"\nconst beauty = base * Ops.pow(repeat, n)",
      errors: [{ messageId: "power", data: { operator: "a ** b" } }]
    },
    {
      code: "\"use strict\"\nconst scale = 2 ** level",
      output: "\"use strict\"\nimport { Ops } from \"@typeonce/ritmo\"\nconst scale = Ops.pow(2, level)",
      errors: [{ messageId: "power", data: { operator: "a ** b" } }]
    },
    {
      // A fix holding another one applies both, in the same pass.
      code: "const decay = Math.exp(-k) ** steps\nw **= Math.log(2) ** e",
      output: "import { Ops } from \"@typeonce/ritmo\"\nconst decay = Ops.pow(Ops.exp(-k), steps)\nw = Ops.pow(w, Ops.pow(Ops.log(2), e))",
      errors: [
        { messageId: "power", data: { operator: "a ** b" } },
        { messageId: "math", data: { name: "exp" } },
        { messageId: "power", data: { operator: "a **= b" } },
        { messageId: "power", data: { operator: "a ** b" } },
        { messageId: "math", data: { name: "log" } }
      ]
    },
    {
      code: "let v = x; v **= 3",
      output: "import { Ops } from \"@typeonce/ritmo\";\nlet v = x; v = Ops.pow(v, 3)",
      errors: [{ messageId: "power", data: { operator: "a **= b" } }]
    },
    {
      // Rewriting a member target would evaluate its object twice.
      code: "body.speed **= 1.5",
      errors: [{ messageId: "power", data: { operator: "a **= b" } }]
    },
    {
      code: "import { Ops } from \"@typeonce/ritmo\"\nconst damping = Math.exp(-friction * dt)",
      output: "import { Ops } from \"@typeonce/ritmo\"\nconst damping = Ops.exp(-friction * dt)",
      errors: [{ messageId: "math", data: { name: "exp" } }]
    },
    {
      code: "import { Ops as M } from \"@typeonce/ritmo\"\nconst y = (a + b) ** 1.5",
      output: "import { Ops as M } from \"@typeonce/ritmo\"\nconst y = M.pow(a + b, 1.5)",
      errors: [{ messageId: "power", data: { operator: "a ** b" } }]
    },
    {
      code: "import * as Ops from \"@typeonce/ritmo/Ops\"\nconst a = Math.atan2(y, x)",
      output: "import * as Ops from \"@typeonce/ritmo/Ops\"\nconst a = Ops.atan2(y, x)",
      errors: [{ messageId: "math", data: { name: "atan2" } }]
    },
    {
      code: "import * as Ops from \"../Ops.ts\"\nconst a = Math[\"atan2\"](y, x)",
      output: "import * as Ops from \"../Ops.ts\"\nconst a = Ops.atan2(y, x)",
      errors: [{ messageId: "math", data: { name: "atan2" } }]
    },
    {
      code: "const a = globalThis.Math.sin(t)",
      output: "import { Ops } from \"@typeonce/ritmo\"\nconst a = Ops.sin(t)",
      errors: [{ messageId: "math", data: { name: "sin" } }]
    },
    {
      // CommonJS gets a require, and an existing one is used.
      code: "const fs = require(\"node:fs\")\nconst a = Math.cos(t)\nmodule.exports = { a }",
      output: "const fs = require(\"node:fs\")\nconst { Ops } = require(\"@typeonce/ritmo\")\nconst a = Ops.cos(t)\nmodule.exports = { a }",
      errors: [{ messageId: "math", data: { name: "cos" } }]
    },
    {
      code: "const { Ops: O } = require(\"@typeonce/ritmo\")\nconst a = Math.cos(t)",
      output: "const { Ops: O } = require(\"@typeonce/ritmo\")\nconst a = O.cos(t)",
      errors: [{ messageId: "math", data: { name: "cos" } }]
    },
    {
      code: "const Ops = require(\"@typeonce/ritmo/Ops\")\nconst a = Math.tan(t)",
      output: "const Ops = require(\"@typeonce/ritmo/Ops\")\nconst a = Ops.tan(t)",
      errors: [{ messageId: "math", data: { name: "tan" } }]
    },
    {
      // A type-only import holds no value, and a second import of the same name would clash.
      code: "import type { Ops } from \"@typeonce/ritmo\"\nconst s = Math.sin(t)",
      errors: [{ messageId: "math", data: { name: "sin" } }]
    },
    {
      // A local named Ops where the call is: the fix would call it.
      code: "function step(Ops: number) { return Math.sin(Ops) }",
      errors: [{ messageId: "math", data: { name: "sin" } }]
    },
    {
      // The old package no longer provides Ops: the fix adds the new import.
      code: "import { Vec2 } from \"@typeonce/ritmo-math\"\nconst s = Math.sin(t)",
      output: "import { Vec2 } from \"@typeonce/ritmo-math\"\nimport { Ops } from \"@typeonce/ritmo\"\nconst s = Ops.sin(t)",
      errors: [{ messageId: "math", data: { name: "sin" } }]
    },
    // Aliases hide the call from the rule.
    { code: "const { sin, cos } = Math", errors: [{ messageId: "alias" }] },
    { code: "const { abs, ...rest } = Math", errors: [{ messageId: "alias" }] },
    { code: "const M = Math; M.sin(t)", errors: [{ messageId: "alias" }] },
    { code: "const M = globalThis.Math", errors: [{ messageId: "alias" }] },
    { code: "const wave = apply(Math, \"sin\", t)", errors: [{ messageId: "alias" }] },
    { code: "const f = Math[name]", errors: [{ messageId: "alias" }] },
    {
      code: "const { sin } = globalThis.Math; const y = globalThis.Math[op](x)",
      errors: [{ messageId: "alias" }, { messageId: "alias" }]
    }
  ]
})
