---
"@typeonce/ritmo": minor
---

**Breaking (debug runtimes only): a debug runtime checks each entity a query's `data` is given, and throws for one that matches none of the system's queries.** An entity kept from an earlier run (in `local` state or a closure) went on reading after it left its query (gained a `without` component, lost a `with` one, or a relation filter stopped matching), so a homing shot kept chasing a target that had died. Now, on a runtime made with `debug`, the read throws:

```
Game/Homing used Game/Position of entity 12, which matches none of its queries: an entity kept from an earlier run is not checked against its query again. Keep entity.id and resolve it with queries.x.get(id) in each run, which is fallible
```

An entity from another query of the same system still works, as before: the check passes when any of the system's queries matches. A despawned entity, and one that lost the slot's component, keep their own errors. Runtimes without `debug` read the entity as before. The check costs a few nanoseconds per slot call on a debug runtime (about 0.03 ms of a 0.30 ms debug step in a top-down shooter's crowd scene).

If your tests or devtools sessions now throw, keep the entity's id and resolve it in each run:

```diff
-local.target ??= queries.targets.each()[0]
-aimAt(queries.targets.data.position.get(local.target))
+local.target ??= queries.targets.each()[0]?.id
+const found = local.target === undefined ? undefined : queries.targets.get(local.target)
+if (found?.ok) aimAt(queries.targets.data.position.get(found.value))
```
