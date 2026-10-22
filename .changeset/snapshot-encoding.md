---
"@typeonce/ritmo": minor
"@typeonce/ritmo-devtools": minor
"@typeonce/oxlint-plugin-ritmo": minor
---

**Snapshots save encoded values, so a value that is not plain data restores.**

- **A constructor can carry `encode`** (`Descriptor.Encoder`), the inverse of `decode`: `runtime.snapshot()` saves what it returns, and `restore` decodes it as before. Values without one are saved as they are, so nothing changes for plain data. Give one to a value `JSON.stringify` cannot carry or `decode` does not read back (a `Map`, a `Set`, a class, a value a schema library transforms). With Effect Schema, `Schema.encodeResult(schema)` is one as it is:

  ```ts
  const Target = Descriptor.ConstructedComponent({
    result: Schema.decodeResult(TargetSchema),
    decode: Schema.decodeUnknownResult(TargetSchema),
    encode: Schema.encodeResult(TargetSchema)
  })("Game/Target")
  ```

  The encoder's parameter is checked against the descriptor's value. Migrations see values as saved (encoded).
- **`Decode.struct`, `array`, and `nullable` carry the `encode` of a codec inside them** that has one, so only that part is encoded. `Decode.Codec` has an optional `encode`.
- **`Descriptor.fromStandardSchema(schema, { encode })`** takes an encoder for a schema that transforms (Standard Schema only validates).
- **Breaking: `runtime.snapshot()` returns a `Result`**, failing with `Snapshot.SnapshotError` (`UnencodableComponent` with the entity, or `UnencodableResource`) when an encoder rejects a value. The fix:

  ```diff
  -localStorage.setItem("save", JSON.stringify(runtime.snapshot()))
  +const saved = runtime.snapshot()
  +if (saved._tag === "Success") localStorage.setItem("save", JSON.stringify(saved.success))
  ```
- `ritmo-devtools`: `Replay.Recordable`, `Replay.Target`, and `ReplaySession.snapshot` take the new `snapshot()`. A recorder skips a snapshot point the world cannot be saved at; `Replay.extract` fails with `SnapshotFailed`.
- `oxlint-plugin-ritmo`: `handle-tick-result` reports `runtime.snapshot()` passed straight to `JSON.stringify` or `structuredClone`, which would save the result's wrapper.
