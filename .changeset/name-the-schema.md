---
"@typeonce/ritmo": patch
---

The docs show how to name a game's schema type, so type errors print `QueryEntity<GameSchema, ...>` instead of every component, resource, and event the game declares. In a game of 64 components an error used to start with `SchemaDefinition<{ readonly Position: Descriptor<...>; ... 62 more ...` and was cut off before it reached the query. `SETUP.md` (step 4) and `Schema.bind` show the pattern; a game that already binds works unchanged, and type-checking takes the same time:

```ts
const schema = Schema.fragment({ components: { Position, Velocity } }) // or Schema.bind(Core, Combat, Root).schema
type SchemaOf = typeof schema
export interface GameSchema extends SchemaOf {}
const named: GameSchema = schema
export const Game = Schema.bind(named, Root)
```

A helper that takes a query's entities and its `data` is typed with the existing `QueryIteration<GameSchema, typeof Walls>` (from `@typeonce/ritmo/System`) and passed `queries.walls`, as the `QueryEntity` and `QueryIteration` docs now say, instead of a hand-written `{ each(): ...; data: ... }` type.

The 0.21.0 entry now says it replaces 0.17's optional-slot fix, so a game upgrading from 0.16 rewrites `data.x.present` straight to `data.x.has(entity)`.
