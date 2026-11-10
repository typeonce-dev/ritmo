import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["no-infinity-in-simulation-data"]!

tester.run("no-infinity-in-simulation-data", rule, {
  valid: [
    "const dash = { since: null, charges: 2 }",
    "const pool = { timer: null }",
    // Local search seeds are not data.
    "let best = Infinity; for (const d of distances) best = Math.min(best, d)",
    "const nearest = distances.reduce((a, b) => Math.min(a, b), Infinity)",
    "if (range === Infinity) unlimited()",
    "function find() { let nearest = { distance: Infinity, id: -1 }; for (const t of targets) if (t.d < nearest.distance) nearest = { distance: t.d, id: t.id }; return nearest.id }",
    "let bounds = [Infinity, -Infinity]",
    // A fallback that is only compared.
    "function first() { const hit = sweep ?? { time: Infinity }; return hit.time < limit }",
    "if ((sweep ?? { time: Infinity }).time < best.time) best = sweep",
    // Values tried one by one (integration/algorithms spatialGrid.test.ts).
    "for (const cellSize of [0, -4, Number.NaN, Infinity]) expect(make(cellSize).ok).toBe(false)",
    // A seed checked before it is stored.
    "function find() { let best = Infinity; for (const d of distances) best = Math.min(best, d); return best === Infinity ? null : { distance: best } }",
    "function find() { let best = Infinity; for (const d of distances) best = Math.min(best, d); return Number.isFinite(best) ? { distance: best } : null }",
    // Math with Infinity as an argument gives a finite number for a finite input.
    "const clamped = { x: Math.min(x, Infinity) }",
    "const value = { x: make(limit) }",
    "const ratio = { half: 1 / 2 }",
    "const bounds = { min: Math.min(...xs) }",
    // A local named Infinity is not the global.
    "const Infinity = 5; const limit = { max: Infinity }"
  ],
  invalid: [
    {
      // spirit-call src/features/team.ts
      code: "const fresh = () => ({ dash: { remaining: 0, since: Infinity, perfect: false } })",
      errors: [{ messageId: "nonFinite", data: { text: "since: Infinity" } }]
    },
    {
      // spirit-call src/features/arena.ts
      code: "commands.spawnIn(RunScope, Game.Command.spawn([Ground, { remaining: Infinity, duration: Infinity, permanent: true }]))",
      errors: [
        { messageId: "nonFinite", data: { text: "remaining: Infinity" } },
        { messageId: "nonFinite", data: { text: "duration: Infinity" } }
      ]
    },
    {
      // spirit-call src/features/combat.ts
      code: "resources.passiveCooldowns.set({ ...cooldowns, [windKey]: Infinity })",
      errors: [{ messageId: "nonFinite", data: { text: "[windKey]: Infinity" } }]
    },
    { code: "const floor = { min: -Infinity }", errors: [{ messageId: "nonFinite", data: { text: "min: -Infinity" } }] },
    { code: "const unknown = { score: NaN }", errors: [{ messageId: "nonFinite", data: { text: "score: NaN" } }] },
    { code: "const lob = { maxRange: Number.POSITIVE_INFINITY }", errors: [{ messageId: "nonFinite", data: { text: "maxRange: Number.POSITIVE_INFINITY" } }] },
    // Infinity written another way.
    { code: "const dash = { since: 1 / 0 }", errors: [{ messageId: "nonFinite", data: { text: "since: 1 / 0" } }] },
    { code: "const dash = { since: Math.min() }", errors: [{ messageId: "nonFinite", data: { text: "since: Math.min()" } }] },
    // In an array.
    { code: "data.range.set(entity, [0, Infinity])", errors: [{ messageId: "nonFinite", data: { text: "Infinity" } }] },
    // Through a call whose result is stored.
    { code: "commands.spawn([Dash, { dash: make(Infinity) }])", errors: [{ messageId: "nonFinite", data: { text: "dash: make(Infinity)" } }] },
    // A seed stored unchecked: it stays Infinity when the search finds nothing.
    {
      code: "function nearest() { let best = Infinity; for (const d of distances) best = Math.min(best, d); return { distance: best } }",
      errors: [{ messageId: "seed", data: { text: "distance: best", name: "best", value: "Infinity" } }]
    },
    {
      code: "function nearest() { let best = Infinity; for (const d of distances) best = Math.min(best, d); data.target.set(entity, [best]) }",
      errors: [{ messageId: "seed", data: { text: "best", name: "best", value: "Infinity" } }]
    },
    { code: "const LIMIT = Infinity\nconst pool = { max: LIMIT }", errors: [{ messageId: "nonFinite", data: { text: "max: LIMIT" } }] },
    {
      // A nested literal in a seed is still the seed's.
      code: "let nearest = { at: { distance: Infinity } }\nconst found = { since: 1 / 0, distance: nearest }",
      errors: [{ messageId: "nonFinite", data: { text: "since: 1 / 0" } }]
    },
    {
      // A fallback that is stored, not only compared.
      code: "function first() { const hit = sweep ?? { time: Infinity }; data.hit.set(entity, hit) }",
      errors: [{ messageId: "nonFinite", data: { text: "time: Infinity" } }]
    }
  ]
})
