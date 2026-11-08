import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["no-kept-query-values"]!

/** A system around `body`, with `queries` and `local` in scope. */
const system = (body: string, before = "") =>
  `${before}\nGame.System("Game/S", { queries: { targets: Targets } }, ({ queries, local }) => {\n${body}\n})`

tester.run("no-kept-query-values", rule, {
  valid: [
    // Ids and plain values are what a run keeps.
    system("local.target = queries.targets.each()[0]?.id"),
    system("for (const entity of queries.targets.each()) local.ids.push(entity.id)"),
    system("local.rows = queries.targets.rows()"),
    system("const { data } = queries.targets\nfor (const entity of queries.targets.each()) local.positions.push(data.position.get(entity))"),
    // spirit-call's scratch buffers: rebuilt each run from plain values.
    system("const { grid, targets } = local\ngrid.clear()\nfor (const entity of queries.targets.each()) targets.push({ id: entity.id, at: queries.targets.data.position.get(entity) })"),
    system("local.count = queries.targets.each().length"),
    system("local.positions = queries.targets.each().map((entity) => queries.targets.data.position.get(entity))"),
    // A variable of the run itself.
    system("let best\nfor (const entity of queries.targets.each()) best = entity\nif (best) commands.despawn(best)"),
    system("let best\nqueries.targets.each().forEach((entity) => { best = entity })"),
    // Helpers outside a system are not judged: they get their entities from the system.
    "let kept\nconst keep = (entity) => { kept = entity }"
  ],
  invalid: [
    {
      code: system("local.target ??= queries.targets.each()[0]"),
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()[0]", id: "its `id`" } }]
    },
    {
      code: system("for (const entity of queries.targets.each()) local.targets.push(entity)"),
      errors: [{ messageId: "entity", data: { name: "entity", id: "`entity.id`" } }]
    },
    {
      code: system("const first = queries.targets.each().find((entity) => entity.id === 3)\nlocal.target = first"),
      errors: [{ messageId: "entity", data: { name: "first", id: "`first.id`" } }]
    },
    {
      code: system("queries.targets.each().forEach((entity) => local.byId.set(entity.id, entity))"),
      errors: [{ messageId: "entity", data: { name: "entity", id: "`entity.id`" } }]
    },
    {
      code: system("const { targets } = local\nfor (const entity of queries.targets.each()) targets.push(entity)"),
      errors: [{ messageId: "entity", data: { name: "entity", id: "`entity.id`" } }]
    },
    {
      code: system("for (const entity of queries.targets.each()) local.chased = { entity, since: 0 }"),
      errors: [{ messageId: "entity", data: { name: "entity", id: "`entity.id`" } }]
    },
    {
      // The kept closure of core's stale-entity test.
      code: system("const entity = queries.targets.each()[0]!\nlocal.held = () => queries.targets.data.position.get(entity)"),
      errors: [{ messageId: "entity", data: { name: "entity", id: "`entity.id`" } }]
    },
    {
      // A variable outside the system lives as long as the module.
      code: system("kept = queries.targets.each()[0]", "let kept"),
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()[0]", id: "its `id`" } }]
    },
    {
      code: system("local.slots = queries.targets.data"),
      errors: [{ messageId: "data", data: { name: "queries.targets.data" } }]
    },
    {
      code: system("const { data } = queries.targets\nlocal.data = data"),
      errors: [{ messageId: "data", data: { name: "data" } }]
    },
    {
      code: system("const { data } = queries.targets\nlocal.read = (entity) => data.position.get(entity)"),
      errors: [{ messageId: "data", data: { name: "data" } }]
    },
    {
      code: system("slots = queries.targets.data", "let slots"),
      errors: [{ messageId: "data", data: { name: "queries.targets.data" } }]
    },
    {
      code: `let kept\nGame.Inspector("Game/I", { queries: { targets: Targets } }, ({ queries }) => { kept = queries.targets.each() })`,
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()", id: "its `id`" } }]
    }
  ]
})
