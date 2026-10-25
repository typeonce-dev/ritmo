---
"@typeonce/ritmo": patch
"@typeonce/ritmo-browser": patch
"@typeonce/ritmo-devtools": patch
"@typeonce/oxlint-plugin-ritmo": patch
---

Docs from upgrading two games across several versions:

- The skill's state-and-upgrades playbook lists the breaks that still compile, per version, and `SETUP.md` says a new lint rule is off until `.oxlintrc.json` lists it.
- The 0.13 `Decode` entry has a table from each `Decode` codec to Zod and Effect; handle schemas use `z.unknown().refine(Entity.isHandle(...))`, not `z.custom`.
- The `Snapshot.version` JSDoc says how to rewrite a format 2 save; `WorldSnapshot.relations` says targets are sorted by id while each target's sources keep their order.
- `ritmo-devtools lint`'s `uncovered-simulation-module` message names the usual cause: a host module imported at the top of the lint entry instead of inside `lintTarget`. The README shows a debug script reusing `lintTarget`.
- The `Replay` docs and the 0.15 changelog say how to keep a playtester's save button without the monitor: `recorder.save(reason)` from a key handler.
- `Touch.Layout` shows how to draw a layout with no `null` zones, and `Pointer.Actions` says to build test doubles with `Pointer.scripted`.
- The `use-ops-for-math` example uses `Angle.wrap` for a signed turn, and the spatial-grid reference defines its `made` helper.
