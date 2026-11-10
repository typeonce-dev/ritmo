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
    "let kept\nconst keep = (entity) => { kept = entity }",
    // Ids, in every form that keeps entities.
    system("local.ids = Array.from(queries.targets.each(), (entity) => entity.id)"),
    system("local.ids = queries.targets.each().map((entity) => entity.id)"),
    system("local.total = queries.targets.each().reduce((sum, entity) => sum + queries.targets.data.health.get(entity), 0)"),
    system("const [first] = queries.targets.each()\nlocal.target = first?.id"),
    system("Object.assign(local, { target: queries.targets.each()[0]?.id })"),
    `Game.System("Game/S", { queries: { targets: Targets } }, ({ queries: q, local }) => { local.target = q.targets.each()[0]?.id })`,
    `Game.System("Game/S", { queries: { targets: Targets } }, ({ queries: { targets }, local }) => { local.at = targets.data.position.get(targets.each()[0]) })`,
    `Game.System("Game/S", { queries: { targets: Targets } }, (ctx) => { ctx.local.target = ctx.queries.targets.each()[0]?.id })`,
    "const cache = new Map()\nconst run = ({ queries }) => { for (const entity of queries.targets.each()) cache.set(entity.id, 1) }\nGame.System(\"Game/S\", { queries: { targets: Targets } }, run)",
    // A function not passed to a system is a helper.
    "const cache = new Map()\nconst run = ({ queries }) => { cache.set(1, queries.targets.each()[0]) }",
    // A service may keep what it is given: the rule cannot see what it does.
    system("services.cache.remember(queries.targets.each()[0])")
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
    // Entities copied into another array, or picked by a callback.
    {
      code: system("local.list = Array.from(queries.targets.each())"),
      errors: [{ messageId: "entity", data: { name: "Array.from(queries.targets.each())", id: "its `id`" } }]
    },
    {
      code: system("local.list = queries.targets.each().map((e) => e)"),
      errors: [{ messageId: "entity", data: { name: "queries.targets.each().map((e) => e)", id: "its `id`" } }]
    },
    {
      code: system("local.pairs = queries.targets.each().map((entity) => ({ entity, hp: 1 }))"),
      errors: [{ messageId: "entity", data: { name: "queries.targets.each().map((entity) => ({ entity, hp: 1 }))", id: "its `id`" } }]
    },
    {
      code: system("kept = queries.targets.each().reduce((best, e) => (e.id > best.id ? e : best))", "let kept"),
      errors: [{ messageId: "entity", data: { name: "queries.targets.each().reduce((best, e) => (e.id > best.id ? e : best))", id: "its `id`" } }]
    },
    {
      code: system("const [first] = queries.targets.each()\nlocal.target = first"),
      errors: [{ messageId: "entity", data: { name: "first", id: "`first.id`" } }]
    },
    {
      code: system("Object.assign(local, { target: queries.targets.each()[0] })"),
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()[0]", id: "its `id`" } }]
    },
    // Contexts destructured another way.
    {
      code: `Game.System("Game/S", { queries: { targets: Targets } }, ({ queries: q, local }) => { local.slots = q.targets.data })`,
      errors: [{ messageId: "data", data: { name: "q.targets.data" } }]
    },
    {
      code: `Game.System("Game/S", { queries: { targets: Targets } }, ({ queries: { targets }, local }) => { local.slots = targets.data })`,
      errors: [{ messageId: "data", data: { name: "targets.data" } }]
    },
    {
      code: `Game.System("Game/S", { queries: { targets: Targets } }, (ctx) => { ctx.local.target = ctx.queries.targets.each()[0] })`,
      errors: [{ messageId: "entity", data: { name: "ctx.queries.targets.each()[0]", id: "its `id`" } }]
    },
    {
      code: `Game.System("Game/S", { queries: { targets: Targets } }, ({ queries, local: kept }) => { kept.target = queries.targets.each()[0] })`,
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()[0]", id: "its `id`" } }]
    },
    {
      // A system function declared apart and passed by name.
      code: "const cache = new Map()\nconst run = ({ queries }) => { for (const entity of queries.targets.each()) cache.set(1, entity) }\nGame.System(\"Game/S\", { queries: { targets: Targets } }, run)",
      errors: [{ messageId: "entity", data: { name: "entity", id: "`entity.id`" } }]
    },
    {
      code: "const cache = new Map()\nfunction run({ queries }) { cache.set(1, queries.targets.each()[0]) }\nexport const S = Game.System(\"Game/S\", { queries: { targets: Targets } }, run)",
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()[0]", id: "its `id`" } }]
    },
    {
      code: `let kept\nGame.Inspector("Game/I", { queries: { targets: Targets } }, ({ queries }) => { kept = queries.targets.each() })`,
      errors: [{ messageId: "entity", data: { name: "queries.targets.each()", id: "its `id`" } }]
    }
  ]
})
