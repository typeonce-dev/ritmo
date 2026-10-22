# Using Ritmo with Effect

Ritmo does not depend on Effect, but its shapes match Effect's: a `Result` is `{ _tag: "Success", success }` or `{ _tag: "Failure", failure }`, and every failure a host sees has a `_tag`. Effect stays outside the simulation: systems are synchronous and deterministic, and Effect runs in the host, between ticks.

1. Import Ritmo's modules under an alias next to Effect's. Both export `Schema`, `Schedule`, `Clock`, and `Result`:

   ```ts
   import * as Effect from "effect/Effect"
   import * as Schema from "effect/Schema"
   import * as Ritmo from "@typeonce/ritmo"
   ```

2. To hold a value an Effect schema describes, give its descriptor the schema's functions. They return Effect's `Result`, which a constructor accepts as it is. Decode and encode with `Schema.toCodecJson(schema)`, so a snapshot holds JSON (an `Option` or a `ReadonlySet` saves as JSON and reads back):

   ```ts
   const Target = Schema.Struct({ enemy: Schema.Option(Schema.Number), seen: Schema.ReadonlySet(Schema.String) })
   const TargetJson = Schema.toCodecJson(Target)
   const TargetResource = Ritmo.Descriptor.ConstructedResource({
     result: Schema.decodeResult(Target),
     decode: Schema.decodeUnknownResult(TargetJson),
     encode: Schema.encodeResult(TargetJson)
   })("Game/Target")
   ```

   Do not pass an Effect schema to `Descriptor.fromStandardSchema`: it has no Standard Schema interface until `Schema.toStandardSchemaV1(schema)`, and the three functions above also encode.

3. To use a Ritmo `Result` in an Effect, convert it with one helper. Effect's `Result` carries members a plain object lacks, so `Effect.fromResult` does not accept it:

   ```ts
   const fromRitmo = <A, E>(result: Ritmo.Result.Result<A, E>): Effect.Effect<A, E> =>
     result._tag === "Success" ? Effect.succeed(result.success) : Effect.fail(result.failure)
   ```

   Failures then work with `Effect.catchTag`: `"RuntimeConstructionError"` from `Runtime.make`, `"SystemFailure"`, `"MissingRuntimeRequirements"`, and `"TickOrderViolation"` from `runtime.tick`, `"UnencodableResource"` and `"UnencodableComponent"` from `runtime.snapshot()`.

4. Keep Effect out of systems. A system that needs host data reads a resource or an event; the host fills it between ticks (`runtime.send(...)`, or a resource it writes before `tick`). A service that does I/O is a synchronous interface: the host implements it over a `ManagedRuntime` (or queues the work and sends the answer back as an event), and a system calls only that interface.

5. Save and load in Effect: `runtime.snapshot()` and `runtime.restore(...)` return Results, so `yield* fromRitmo(runtime.snapshot())` gives the snapshot to store with `KeyValueStore` or any other service.

6. Own what keeps running in a `Scope`: `Effect.acquireRelease` around `FixedLoop.start(...)` (released with `driver.stop()`) and around each input source (released with `dispose()`), so closing the scope stops the loop and removes its listeners.

**Done when** a snapshot holding a schema's value survives `JSON.stringify`, restores to the same value, and no file under the simulation imports `effect`.
