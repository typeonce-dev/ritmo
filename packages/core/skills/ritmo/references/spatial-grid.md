# A broad phase: the spatial grid

When many bodies test each other every step (separation, pickups, hits, sensing), testing every pair is quadratic. Ritmo ships no broad phase: copy [`spatial-grid.ts`](spatial-grid.ts) into the simulation folder and keep it as game code, sized to the game's data. It uses only exact operations, so it replays the same on every engine, and the simulation lint rules cover it like the rest of the game. Its JSDoc explains `clear`, `insert`, `forEachIn`, and the cell size.

- Keep the grid in the system that queries it, in its `local`: it is rebuilt from the world every step, so it is never saved.
- Insert under the index of an array the system keeps (positions, entities), never an entity id: the grid relies on small, dense indices.
- The grid returns candidates; the exact test (`Collide2.overlapsCircleCircle`, `Box2.overlapsCircle`) decides.

```ts
const Separate = Game.System("Game/Separate", {
  local: () => ({ grid: made(SpatialGrid.make(32)), bodies: new Array<Vec2.Vec2>() }),
  queries: { bodies: Game.Query({ selection: { position: Game.Query.write(Position), body: Game.Query.read(Body) } }) }
}, ({ queries, local: { grid, bodies } }) => {
  grid.clear()
  bodies.length = 0
  for (const { data } of queries.bodies.each()) {
    const at = data.position.get()
    grid.insert(bodies.length, at.x, at.y, data.body.get().radius)
    bodies.push(at)
  }
  for (const [index, at] of bodies.entries()) {
    grid.forEachIn(at.x - range, at.y - range, at.x + range, at.y + range, (other) => {
      if (other !== index && Collide2.overlapsCircleCircle(at, radius, bodies[other]!, radius)) push(index, other)
    })
  }
})
```

`made` throws on a `Result` failure: the cell size is an authored constant, so a failure is a typo.

**Check:** a headless test compares `forEachIn` with a brute-force pass over all bodies on a seeded random world, and checks that a rebuild after `clear` forgets the previous step.
