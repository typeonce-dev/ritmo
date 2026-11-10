---
"@typeonce/ritmo-render": minor
---

**Breaking, and it still compiles: a renderable a system writes with a new value now destroys and makes its node again on every write.** Count your `create` calls after upgrading: a town whose houses, trees, and fields kept writing their renderables went from 142 nodes made in 5 minutes of play to 59,445, and every effect on those nodes restarted each time.

**A `RenderSync` node follows its renderable.** A node used to be made once per entity id from the renderable's value at that time and only applied after, so an entity whose renderable a system changed (a relabel, an evolve) kept the node of its old value, and after a rewind an entity spawned under an id already drawn (an enemy where a predicted bullet was) was drawn with the other entity's node for its whole life. Now, when an entity's renderable value is no longer the one its node was made from, `RenderSync.system` destroys the node, calls `create` with the new value, and then `apply`. Writing an equal value keeps the node and runs no extra `apply`: values are compared as plain data (arrays and plain objects by their entries). Nothing changes for a renderable that is set at spawn and never written.

What a game sees differently: a renderable written with a new value each tick now makes its node again each tick. Move data that changes while the node lives (an animation `frame`, a `tint`, a facing) out of the renderable into its own component, list it in `redrawOn`, and set it in `apply`:

```diff
-const Sprite = Descriptor.Component<{ texture: string; frame: number }>()("Game/Sprite")
+const Sprite = Descriptor.Component<{ texture: string }>()("Game/Sprite")
+const Frame = Descriptor.Component<number>()("Game/Frame")

 RenderSync.system(Game, {
   renderable: Sprite,
+  select: { frame: Game.Query.read(Frame) },
+  redrawOn: [Frame],
-  apply: (node, { renderable }) => node.gotoAndStop(renderable.frame)
+  apply: (node, { data }) => node.gotoAndStop(data.frame.get())
 })
```

Or key the sync on a component that never changes after spawn, and read the one systems write through a required `select` slot:

```diff
 RenderSync.system(Game, {
-  renderable: House,
+  renderable: Tile,
+  select: { house: Game.Query.read(House) },
+  redrawOn: [House],
-  apply: (node, { renderable }) => node.update(renderable)
+  apply: (node, { data }) => node.update(data.house.get())
 })
```

A game that listed its renderable in `redrawOn` and wrote an `apply` redoing what `create` did can drop both: a new value makes the node again.
