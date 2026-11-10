---
"@typeonce/ritmo-netcode": minor
---

**Breaking: the local input goes through the input schema, and one the schema rejects throws.** `advance(local)` (and `syncTest`'s `advance`) now encodes `local`, writes it as JSON, and decodes it with the seats' schema, as every other peer does with the message, and this peer simulates the decoded value. Before, the local peer simulated the raw value and the others its decoded form: a schema that normalizes (a clamp, a default, a strip) desynced the match on the first input it changed, and an input the schema rejects (an analog `dx` of `0.5` where the schema wants a whole number; it compiles as `number`) was dropped by every other peer, so the match stalled for good with no error.

An input the schema rejects now throws from `advance` with `Netcode: the local input does not decode with the input schema: <issues>`, like one that does not encode already did. The fix is to hand `advance` the schema's output type, for example:

```diff
-session.advance({ dx: stick.x, fire })
+session.advance({ dx: Math.round(stick.x), fire })
```

`Netcode.seats` checks `idle` the same way, so an `idle` that does not survive JSON fails there with `InvalidOptions`.
