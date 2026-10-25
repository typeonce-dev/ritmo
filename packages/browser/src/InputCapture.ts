/**
 * A system that copies host input into an ECS resource once per run.
 *
 * Input devices are host capabilities (services), but gameplay should read
 * input as world data: a resource every system can declare, inspect, and test
 * without the host. `InputCapture.system(...)` builds the one system that
 * bridges them. Place it at the start of the schedule that consumes input, so
 * every system in that run reads the same snapshot and press edges are
 * observed exactly once per run.
 *
 * The source is any service with `snapshot()`: one device such as
 * `Keyboard.actions(...)`, a `Controls` merge of several, or a
 * `Controls.players(...)` pool. The resource's
 * value type must be exactly the snapshot type (declare it as
 * `InputCapture.SnapshotOf<typeof Source>`): not a wider type, and not one
 * with extra optional fields.
 *
 * The system declares its access like any other: it writes the resource, so
 * a reader declared with `Game.System.thisTick(...)` placed before it does
 * not compile, and it consumes the source (`Game.System.consumeService`), so
 * `describe()` warns with `service-consumed-twice` when one source is
 * captured at more than one placement (in named schedules, or wherever a
 * debug runtime saw it run). Every input source marks `snapshot()` with
 * `System.Consumes`, so another system that declares the source with
 * `Game.System.service` (to rebind it, say) cannot call `snapshot()`.
 * Capture each source once and read the resource everywhere else.
 *
 * Declare the source service as {@link SourceOf} the device (only its
 * `snapshot()`), not as the device: the same descriptor then takes the live
 * device in the page, a scripted one in tests, and the recorded or fuzzed
 * input of `@typeonce/ritmo-devtools`' `Replay` and `Fuzz`.
 *
 * @module InputCapture
 * @docGroup browser
 *
 * @example
 * ```ts
 * const bindings = { left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"], jump: [" "] } as const
 *
 * const KeyboardInput = Descriptor.Service<InputCapture.SourceOf<Keyboard.Actions<typeof bindings>>>()("Game/Keyboard")
 * const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof KeyboardInput>>()("Game/Input")
 * const Game = Schema.bind(Schema.fragment({ resources: { Input } }))
 *
 * const CaptureInput = InputCapture.system(Game, { name: "Game/CaptureInput", source: KeyboardInput, resource: Input })
 * const Jump = Game.System("Game/Jump", { resources: { input: Game.System.readResource(Input) } }, ({ resources }) => {
 *   if (resources.input.get().actions.jump.pressed) console.log("jump")
 * })
 * const update = Game.Schedule(CaptureInput, Jump)
 *
 * const runtime = Game.Runtime.make({
 *   services: Game.Runtime.services(Game.Runtime.service(KeyboardInput, Keyboard.actions(window, bindings))),
 *   resources: { Input: Keyboard.idle(bindings) }
 * }).value
 * ```
 */
import type * as System from "@typeonce/ritmo/System"
import type { Descriptor } from "@typeonce/ritmo/Descriptor"
import type { Condition } from "@typeonce/ritmo/Machine"
import type { Schema } from "@typeonce/ritmo/Schema"

/**
 * Anything that produces one input snapshot per call. `snapshot()` drains
 * the source, so only a system that declares it with
 * `Game.System.consumeService` (like `InputCapture.system`) calls it.
 */
export interface Source<Value> extends System.Consumes<"snapshot"> {
  readonly snapshot: () => Value
}

/**
 * The input service a game declares: the `snapshot()` of a device, a
 * `Controls` merge, or a `Controls.players` pool, without its `rebind` and
 * `dispose`. Declare the source service with it
 * (`Descriptor.Service<InputCapture.SourceOf<typeof device>>()`), so the
 * same descriptor is provided by the live devices in the page, by scripted
 * devices in tests, by `playback.source(...)` in a replay, and by
 * `Fuzz.input(...)` in the fuzzer. Keep the device itself in the host to
 * rebind and dispose it. Use {@link Source} when the snapshot type is
 * written out instead of taken from a device.
 *
 * @example
 * ```ts
 * const Actions = Controls.actions({ buttons: ["jump"] })
 * const keys = { jump: [" "] } as const
 * const pad = { jump: ["south"] } as const
 * // ---cut---
 * const makeControls = (devices: { readonly keyboard: Keyboard.Actions<typeof keys>; readonly gamepad: Gamepad.Actions<typeof pad> }) =>
 *   Actions.merge(devices)
 * const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ReturnType<typeof makeControls>>>()("Game/Controls")
 * ```
 */
export type SourceOf<Device extends Source<unknown>> = Source<ReturnType<Device["snapshot"]>>

type ServiceDescriptor = Descriptor<"service", string, any>
type ResourceDescriptor = Descriptor<"resource", string, any>

/**
 * The snapshot type produced by a source service, or `never` when the
 * service has no `snapshot()`.
 */
export type SnapshotOf<Service extends ServiceDescriptor> =
  Descriptor.Value<Service> extends Source<infer Value> ? Value : never

/** Whether `A` and `B` are the same type, not merely assignable both ways. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** The resource when its value type is exactly the source's snapshot type, otherwise an error naming the fix. */
type MatchingResource<Resource extends ResourceDescriptor, Service extends ServiceDescriptor> =
  Same<Descriptor.Value<Resource>, SnapshotOf<Service>> extends true
    ? Resource
    : "The resource's value type must be exactly the source's snapshot type: declare it with InputCapture.SnapshotOf<typeof Source>"

/** Options for {@link system}. */
export interface Options<
  S extends Schema.Any,
  Service extends ServiceDescriptor,
  Resource extends Schema.ResourceDescriptor<S>,
  When extends ReadonlyArray<Condition> = readonly [],
  Name extends string = string
> {
  /** The system name. */
  readonly name: Name
  /** The service to read snapshots from; its value must have `snapshot()`. */
  readonly source: Descriptor.Value<Service> extends Source<any> ? Service : "The source service must provide snapshot()"
  /** The resource to write each snapshot into; its value type must be exactly the snapshot type. */
  readonly resource: MatchingResource<Resource, Service>
  /**
   * Run conditions, like a system's `when`. While they fail, snapshots are
   * not taken, so presses stay in the device until capture resumes (for
   * example during a pause or hit-stop).
   */
  readonly when?: When
}

/**
 * Builds the system that writes `source.snapshot()` into `resource`.
 */
export const system = <
  S extends Schema.Any,
  Root,
  const Service extends ServiceDescriptor,
  const Resource extends Schema.ResourceDescriptor<S>,
  const When extends ReadonlyArray<Condition<Root>> = readonly [],
  const Name extends string = string
>(
  Game: Schema.Game<S, Root>,
  options: Options<S, Service, Resource, When, Name>
) =>
  Game.System(options.name, {
    resources: { input: Game.System.writeResource(options.resource as Resource) },
    services: { source: Game.System.consumeService(options.source as Service) },
    when: (options.when ?? []) as When
  }, ({ resources, services }) => {
    resources.input.set(services.source.snapshot() as never)
  })
