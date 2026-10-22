---
"@typeonce/ritmo": minor
"@typeonce/ritmo-math": minor
"@typeonce/ritmo-browser": minor
"@typeonce/ritmo-render": minor
"@typeonce/ritmo-devtools": minor
"@typeonce/oxlint-plugin-ritmo": minor
---

**`Result` has Effect's field names, and every failure a host sees is tagged.**

- **Breaking: a result is `{ _tag: "Success", success }` or `{ _tag: "Failure", failure }`**, the same plain data as Effect's `Result`. An Effect result (`Schema.decodeUnknownResult(schema)(raw)`, say) is now a Ritmo result as it is, so Effect's functions plug into descriptors without an adapter. Every API that returned `{ ok, value }` / `{ ok, error }` returns the new shape. The fix:

  ```diff
  -if (!ran.ok) console.error(ran.error)
  +if (ran._tag === "Failure") console.error(ran.failure)
  -const runtime = made.value
  +const runtime = made.success
  -return Result.success(value)
  +return Result.succeed(value)
  -return Result.failure(error)
  +return Result.fail(error)
  ```

  `Result.isSuccess`, `isFailure`, `match`, and `all` keep their names and behavior. A hand-written result type (`{ readonly ok: true; readonly value: A }`) becomes `{ readonly _tag: "Success"; readonly success: A }`.
- **Breaking: a failed tick's `SystemFailure` is tagged `_tag: "SystemFailure"`** in place of `kind: "SystemFailure"` (`failure.kind` becomes `failure._tag`; `system` and `error` are unchanged).
- **`Game.Runtime.make`'s failure is tagged `_tag: "RuntimeConstructionError"`**, beside its `resources`.
- **Breaking: `Descriptor.fromStandardSchema` fails with `{ _tag: "StandardSchemaIssues", issues }`** in place of the bare issues array (`error` becomes `failure.issues`).
- Debug runtimes: a failed tick result counts as read when its `_tag` is read (it was `ok`).
- `oxlint-plugin-ritmo`: `handle-tick-result`'s messages show the new check (`if (ran._tag === "Failure")`).
