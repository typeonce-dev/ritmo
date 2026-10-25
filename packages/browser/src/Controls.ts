/**
 * One input source merged from several devices, so gameplay reads each
 * action once whatever the player uses.
 *
 * Declare the game's actions once with `Controls.actions({ buttons: [...] })`, bind them
 * on every device (`Keyboard.actions`, `Gamepad.actions`, `Pointer.actions`,
 * `Touch.actions`), and merge the devices with the declaration's `merge`.
 * Merged devices
 * behave like one device with all their bindings: an action is `held` while
 * any device holds it, `pressed` when any device pressed it, and `released`
 * when a device released it and none holds it now. A vector action (movement)
 * is the longest direction any device reports, so a stick and keys never add
 * up past length 1 or cancel each other. Device-specific data
 * (sticks, triggers, touch aim) stays in `devices`, under the names given to
 * `merge`; `lastUsed` names the device the player used last, for button
 * prompts.
 *
 * Devices the player uses together (keyboard and mouse) go in one
 * `group(...)`: the group is one entry of the merge, so walking with the
 * keyboard while aiming with the mouse keeps `lastUsed` on the group, and
 * `available` follows what the group binds between its devices. Grouped
 * devices keep their own names in `devices` and `rebind`.
 *
 * Every entry binds every action. A device that cannot (a touch layout
 * without a pause button) is passed as `actions.lacking(device, [...])`,
 * which names exactly the actions it lacks. Reading a lacking action on that
 * device does not compile; `available` reports whether the last used device
 * has each action, and `describe()` lists every gap as a `service-lint`.
 *
 * Capture the merged source with `InputCapture.system(...)` and build the
 * devices inside the `merge(...)` call, so nothing else takes their
 * snapshots. A game with one device captures that device directly instead.
 *
 * Declare the input service as `InputCapture.SourceOf<...>` the merge (its
 * `snapshot()` only), and keep the merge in the host to rebind and dispose
 * it. The snapshot is plain data, so the same descriptor replays
 * (`playback.source(ControlsInput)`) and fuzzes: `Fuzz.input(ControlsInput,
 * { generate: (random) => Actions.random(random, devices), neutral:
 * Actions.idle(devices) })`.
 *
 * A merge is one player on every device. For local multiplayer, where each
 * device belongs to the player who joined with it, declare
 * `Controls.players(Actions, { slots, join, leave })` and capture its
 * `pool(...)` instead.
 *
 * @module Controls
 * @docGroup browser
 *
 * @example
 * ```ts
 * const Actions = Controls.actions({ buttons: ["jump", "pause"], vectors: ["move"] })
 *
 * const keyBindings = {
 *   move: Keyboard.vector({ up: ["ArrowUp", "w"], down: ["ArrowDown", "s"], left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"] }),
 *   jump: [" "],
 *   pause: ["Escape"]
 * } as const
 * const padBindings = {
 *   move: Gamepad.vector({ stick: "left", up: ["dpadUp"], down: ["dpadDown"], left: ["dpadLeft"], right: ["dpadRight"] }),
 *   jump: ["south"],
 *   pause: ["start"]
 * } as const
 *
 * // One function builds the controls, for the browser and for tests.
 * export const makeControls = (devices: {
 *   readonly keyboard: Keyboard.Actions<typeof keyBindings>
 *   readonly gamepad: Gamepad.Actions<typeof padBindings>
 * }) => Actions.merge(devices)
 *
 * // Only the snapshot: a replay or the fuzzer provides it in place of the devices.
 * const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ReturnType<typeof makeControls>>>()("Game/Controls")
 * const Input = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("Game/Input")
 * const CaptureInput = InputCapture.system(Game, { name: "Game/CaptureInput", source: ControlsInput, resource: Input })
 *
 * const runtime = Game.Runtime.make({
 *   services: Game.Runtime.services(Game.Runtime.service(ControlsInput, makeControls({
 *     keyboard: Keyboard.actions(window, keyBindings),
 *     gamepad: Gamepad.actions(window, padBindings)
 *   }))),
 *   resources: { Input: Actions.idle({ keyboard: Keyboard.idle(keyBindings), gamepad: Gamepad.idle(padBindings) }) }
 * }).value
 *
 * // In a system:
 * const input = resources.input.get()
 * walk(input.vectors.move) // length at most 1: keys, d-pad, or stick
 * if (input.actions.jump.pressed) jump()
 * const prompt = input.lastUsed === "gamepad" ? "Ⓐ" : "Space"
 * ```
 */
import type * as System from "@typeonce/ritmo/System"
import * as Debug from "@typeonce/ritmo/Debug"

import type { ActionState } from "./internal/state.ts"
import { boundKeys, claim, ownersOf } from "./internal/introspect.ts"
import type { ReportsBoundKeys } from "./internal/introspect.ts"
import { longer, zero } from "./internal/vectors.ts"
import type { Vector } from "./internal/vectors.ts"

export type { ActionState, Vector }

/**
 * The part of a device's snapshot `Controls` merges: every button action's
 * state, every vector action's direction, and whether the player used the
 * device in this window.
 */
export interface DeviceSnapshot<A extends string, V extends string = never> {
  readonly actions: { readonly [K in A]: ActionState }
  readonly vectors: { readonly [K in V]: Vector }
  readonly used: boolean
}

/** A device `Controls` can merge: `Keyboard.actions`, `Gamepad.actions`, `Pointer.actions`, `Touch.actions`, or their scripted forms. */
export interface Device<A extends string = string, V extends string = string> extends System.Consumes<"snapshot"> {
  snapshot(): DeviceSnapshot<A, V>
  dispose(): void
}

/**
 * Devices the player uses together as one (keyboard and mouse), built with
 * {@link ActionSet.group}. The group is one entry of the merge: it binds
 * what its devices bind between them, and `lastUsed` and `available` follow
 * it as a whole. Its devices keep their own names in `devices` and `rebind`.
 */
export interface Group<Members> {
  readonly _tag: "Group"
  readonly members: Members
}

/**
 * Every pad on its own, for a player pool: `Gamepad.pads(...)`. Each pad
 * joins as its own player. Reading it drains the pads' presses, like every
 * input source.
 */
export interface Pads extends System.Consumes<"snapshot"> {
  readonly _tag: "Pads"
  readonly max: number
  snapshot(): ReadonlyArray<DeviceSnapshot<string, string> & { readonly id: string | null; readonly connected: boolean }>
  dispose(): void
}

/** A device passed with the actions it lacks; build it with {@link ActionSet.lacking}. */
export interface Lacking<D extends Unit | Pads, Missing extends string> {
  readonly _tag: "Lacking"
  readonly device: D
  readonly lacking: ReadonlyArray<Missing>
}

/** One entry of a merge before `lacking`: a device or a group of devices. */
type Unit = Device | Group<Readonly<Record<string, Device>>>

type Entry = Unit | Lacking<Unit, string>

/** One entry of a player pool: a device, or every pad, maybe with the actions it lacks. */
type PoolEntry = Device | Pads | Lacking<Device | Pads, string>

/** The button actions a device, or the devices of a group, bind. */
type ActionsOf<D> = D extends Group<infer M> ? { [K in keyof M]: ActionsOf<M[K]> }[keyof M]
  : D extends { readonly _tag: "Pads"; snapshot(): ReadonlyArray<{ readonly actions: infer Actions }> } ? keyof Actions & string
  : D extends { snapshot(): { readonly actions: infer Actions } } ? keyof Actions & string
  : never

/** The vector actions a device, or the devices of a group, bind. */
type VectorsOf<D> = D extends Group<infer M> ? { [K in keyof M]: VectorsOf<M[K]> }[keyof M]
  : D extends { readonly _tag: "Pads"; snapshot(): ReadonlyArray<{ readonly vectors: infer Vectors }> } ? keyof Vectors & string
  : D extends { snapshot(): { readonly vectors: infer Vectors } } ? keyof Vectors & string
  : never

/** Every action a device binds, of either kind. */
type BoundOf<D> = ActionsOf<D> | VectorsOf<D>

/**
 * Why a device's bindings do not fit the declared buttons `A` and vectors
 * `V` (an action of the wrong kind, or one not declared), or `never`.
 */
type KindIssue<A extends string, V extends string, Name extends string, D> = [ActionsOf<D> & V] extends [never]
  ? [VectorsOf<D> & A] extends [never]
    ? [Exclude<BoundOf<D>, A | V>] extends [never] ? never
    : `${Name} binds ${Exclude<BoundOf<D>, A | V>}, which is not one of the actions`
    : `${Name} binds ${VectorsOf<D> & A} as a vector, but it is a button action: bind it to keys or buttons`
  : `${Name} binds ${ActionsOf<D> & V} as a button, but it is a vector action: bind it with vector(...)`

type DeviceOf<E> = E extends Lacking<infer D, string> ? D : E

type SnapshotOf<D> = D extends { snapshot(): infer S } ? S : never

/** The devices one merge entry contributes, by name: a group's members, or the device under the entry's name. */
type MembersOf<K, U> = U extends Group<infer M> ? M : { readonly [P in K & string]: U }

/** Every device name of a merge, with groups flattened. */
type DeviceNames<R> = { [K in keyof R]: keyof MembersOf<K, DeviceOf<R[K]>> }[keyof R] & string

/** The device a merge names `N`, wherever it is. */
type DeviceNamed<R, N> = {
  [K in keyof R]: MembersOf<K, DeviceOf<R[K]>> extends infer M ? N extends keyof M ? M[N] : never : never
}[keyof R]

/** Each device's full snapshot, by device name (group members under their own names). */
type DevicesOf<R> = { readonly [N in DeviceNames<R>]: SnapshotOf<DeviceNamed<R, N>> }

/** The `rebind` of each merged device that has one, by device name. */
type RebindOf<R> = {
  readonly [N in DeviceNames<R> as DeviceNamed<R, N> extends { readonly rebind: unknown } ? N : never]: DeviceNamed<R, N> extends { readonly rebind: infer Rebind } ? Rebind : never
}

/** The names one entry takes: its own, and its members' for a group. */
type NamesOf<K, U> = U extends Group<infer M> ? K | keyof M : K

/** A device or group name the merge uses twice. */
type Repeated<R> = {
  [K in keyof R]:
    | (NamesOf<K, DeviceOf<R[K]>> & { [J in Exclude<keyof R, K>]: NamesOf<J, DeviceOf<R[J]>> }[Exclude<keyof R, K>])
    | (DeviceOf<R[K]> extends Group<infer M> ? K & keyof M : never)
}[keyof R] & string

/** Rejects a merge that uses a name twice: `devices`, `rebind`, and `lastUsed` need one meaning per name. */
type UniqueNames<R> = [Repeated<R>] extends [never]
  ? unknown
  : `the name ${Repeated<R>} is used twice: give every device and group its own name`

/** A group member when it is a plain device binding only declared actions, otherwise an error naming the fix. */
type CheckMember<A extends string, V extends string, Name extends string, D> = D extends Lacking<Unit, string>
  ? "lacking applies to the whole group: pass lacking(group(...), [...])"
  : D extends Group<unknown> ? "groups do not nest: list every device in one group"
  : [KindIssue<A, V, Name, D>] extends [never] ? D
  : KindIssue<A, V, Name, D>

/** Rejects a group of fewer than two devices. */
type TwoOrMore<M> = [keyof M] extends [never]
  ? "a group needs at least two devices"
  : { [K in keyof M]: [Exclude<keyof M, K>] extends [never] ? K : never }[keyof M] extends infer Alone extends string
    ? [Alone] extends [never] ? unknown : `a group needs at least two devices: pass ${Alone} to merge directly`
    : unknown

/** The entry when it covers exactly the declared actions, otherwise an error naming the device and the fix. */
type CheckEntry<A extends string, V extends string, Name extends string, E> = E extends Lacking<infer D, infer Missing>
  ? [KindIssue<A, V, Name, D>] extends [never]
    ? [Exclude<A | V, BoundOf<D> | Missing>] extends [never]
      ? E
      : `${Name} has no action ${Exclude<A | V, BoundOf<D> | Missing>}: bind it on ${Name}, or list it in its lacking(...)`
    : KindIssue<A, V, Name, D>
  : [KindIssue<A, V, Name, E>] extends [never]
    ? [Exclude<A | V, BoundOf<E>>] extends [never]
      ? E
      : `${Name} has no action ${Exclude<A | V, BoundOf<E>>}: bind it on ${Name}, or pass lacking(${Name}, [...]) from the action set`
    : KindIssue<A, V, Name, E>

/** The actions some merged device binds. */
type BoundBy<R> = { [K in keyof R]: BoundOf<DeviceOf<R[K]>> }[keyof R]

/** Rejects a merge where no device binds an action. */
type EveryActionBound<A extends string, R> = [Exclude<A, BoundBy<R>>] extends [never]
  ? unknown
  : `no device binds ${Exclude<A, BoundBy<R>>}: bind it on one device, or remove it from Controls.actions`

/**
 * The merged input. `actions` merges every device; `devices` holds each
 * device's own snapshot under the name it was merged under.
 */
export interface Snapshot<A extends string, V extends string, Devices, Used extends string = keyof Devices & string> {
  readonly actions: { readonly [K in A]: ActionState }
  /**
   * Each vector action (movement) as a direction with length at most 1, `y`
   * growing down: the longest any device reports, so devices never add up
   * past 1 or cancel each other.
   */
  readonly vectors: { readonly [K in V]: Vector }
  /**
   * Whether the last used device binds each action: `false` for the actions
   * it was merged as lacking, so the game can offer them another way (an
   * on-screen pause button). Every action is available before any device is
   * used.
   */
  readonly available: { readonly [K in A | V]: boolean }
  readonly devices: Devices
  /**
   * The device (or group) that reported input most recently, or `null`
   * before any did. When several report input in one window it stays on the
   * current one if it is among them, otherwise it takes the first in merge
   * order.
   */
  readonly lastUsed: Used | null
}

/** The merged source, for `InputCapture.system(...)`. */
export interface Controls<A extends string, V extends string, R> extends System.Consumes<"snapshot"> {
  /** Takes every device's snapshot, starting a new press window on each, and merges them. */
  snapshot(): Snapshot<A, V, DevicesOf<R>, keyof R & string>
  /** Each merged device's `rebind`, for a settings screen; devices without one (touch) are not listed. */
  readonly rebind: RebindOf<R>
  /** Disposes every merged device. */
  dispose(): void
}

/**
 * The game's actions, declared once. Every merge, gap, and idle snapshot is
 * built from it, so action names are checked against one list.
 */
export interface ActionSet<A extends string, V extends string = never> {
  /** The declared button actions, in order, for listing them on a settings screen. */
  readonly buttons: ReadonlyArray<A>
  /** The declared vector actions, in order. */
  readonly vectors: ReadonlyArray<V>
  /**
   * Marks the actions `device` cannot report, for {@link merge}. List
   * exactly the declared actions it does not bind: autocomplete offers them,
   * and a missing or extra name does not compile.
   */
  lacking<D extends Unit | Pads, const Missing extends ReadonlyArray<Exclude<A | V, BoundOf<D>>>>(
    device: D & (
      [KindIssue<A, V, "This device", D>] extends [never]
        ? [Exclude<A | V, BoundOf<D>>] extends [never] ? "This device binds every action: pass it to merge without lacking" : unknown
        : KindIssue<A, V, "This device", D>
    ),
    lacking: Missing & ([Exclude<A | V, BoundOf<D> | Missing[number]>] extends [never] ? unknown : `This device also lacks ${Exclude<A | V, BoundOf<D> | Missing[number]>}: bind it, or list it here`)
  ): Lacking<D, Missing[number]>
  /**
   * Groups devices the player uses together (keyboard and mouse), for
   * {@link merge}: the group binds what its devices bind between them, and
   * `lastUsed` and `available` follow it as a whole, so walking with the
   * keyboard while aiming with the mouse is one device in use. A group needs
   * two or more plain devices, each binding only declared actions; pass the
   * group to {@link lacking} for the actions none of them binds.
   */
  group<const M extends Readonly<Record<string, Entry | Group<unknown>>>>(
    members: { readonly [K in keyof M]: CheckMember<A, V, K & string, M[K]> } & TwoOrMore<M>
  ): Group<M>
  /**
   * Merges `devices` into one source. Each entry (a device or a
   * {@link group}) binds every declared action, or is passed through
   * {@link lacking}; every action is bound by at least one device. Entry
   * names key `lastUsed`; device names (a group's members under their own)
   * key `devices` and `rebind`.
   */
  merge<const R extends Readonly<Record<string, Entry>>>(
    devices: { readonly [K in keyof R]: CheckEntry<A, V, K & string, R[K]> } & EveryActionBound<A | V, R> & UniqueNames<R>
  ): Controls<A, V, R>
  /**
   * A merged snapshot with nothing held and no device used yet, for
   * initializing the input resource: pass each device's idle snapshot
   * (`Keyboard.idle(...)`, ...) under its device name.
   */
  idle<const Devices extends Readonly<Record<string, DeviceSnapshot<string, string>>>>(devices: Devices): Snapshot<A, V, Devices, never>
  /**
   * A merged snapshot with every action drawn from `random`, for fuzzing the
   * input source (`Fuzz.input`'s `generate`, which hands over the
   * generator). Each button is in a state a merge can report (idle, held,
   * just pressed, tapped, or just released) and each vector is zero, one of
   * the eight directions, or a tilt shorter than 1. Device data stays as
   * given (pass the same idle snapshots as to {@link idle}), every action is
   * available, and no device is last used. Use {@link idle} for the input of
   * a player who does nothing.
   */
  random<const Devices extends Readonly<Record<string, DeviceSnapshot<string, string>>>>(
    random: Draw,
    devices: Devices
  ): Snapshot<A, V, Devices, never>
}

/** A generator `random` draws from: `Random` from `@typeonce/ritmo`, as `Fuzz.input`'s `generate` hands it over. */
export interface Draw {
  /** Uniform in [0, 1). */
  next(): number
}

/** The button states a merge can report, `idle` first. */
const buttonStates: ReadonlyArray<ActionState> = [
  { held: false, pressed: false, released: false },
  { held: true, pressed: false, released: false },
  { held: true, pressed: true, released: false },
  { held: false, pressed: true, released: true },
  { held: false, pressed: false, released: true }
]

/** Idle half the time, otherwise one of the other states a merge reports. */
const randomButton = (random: Draw): ActionState =>
  random.next() < 0.5 ? buttonStates[0]! : buttonStates[1 + Math.floor(random.next() * 4)]!

const diagonal = Math.SQRT1_2

/** The eight directions a d-pad or keys report, each of length 1. */
const directions: ReadonlyArray<Vector> = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: diagonal, y: diagonal }, { x: -diagonal, y: diagonal }, { x: diagonal, y: -diagonal }, { x: -diagonal, y: -diagonal }
]

/** Zero, a full direction, or a stick's tilt shorter than 1, a third of the time each. */
const randomVector = (random: Draw): Vector => {
  const kind = Math.floor(random.next() * 3)
  if (kind === 0) return zero
  if (kind === 1) return directions[Math.floor(random.next() * directions.length)]!
  const x = random.next() * 2 - 1
  const y = random.next() * 2 - 1
  const length = Math.sqrt(x * x + y * y)
  if (length === 0) return zero
  const tilt = random.next()
  return { x: (x / length) * tilt, y: (y / length) * tilt }
}

const randomInput = (random: Draw, buttons: ReadonlyArray<string>, vectors: ReadonlyArray<string>) => ({
  actions: Object.fromEntries(buttons.map((name) => [name, randomButton(random)])),
  vectors: Object.fromEntries(vectors.map((name) => [name, randomVector(random)]))
})

const idleState: ActionState = { held: false, pressed: false, released: false }

const isLacking = (entry: unknown): entry is Lacking<Unit | Pads, string> => (entry as Partial<Lacking<Unit, string>>)._tag === "Lacking"

const isGroup = (unit: Unit): unit is Group<Readonly<Record<string, Device>>> =>
  (unit as Partial<Group<unknown>>)._tag === "Group"

/** A merge entry's devices by name: a group's members, or the device under the entry's name. */
const membersOf = (name: string, unit: Unit): ReadonlyArray<{ readonly name: string; readonly device: Device }> =>
  isGroup(unit)
    ? Object.entries(unit.members).map(([member, device]) => ({ name: member, device }))
    : [{ name, device: unit }]

/** Rejects a name declared both as a button and as a vector. */
type DistinctKinds<A extends string, V extends string> = [A & V] extends [never]
  ? unknown
  : `${A & V} is declared as both a button and a vector action: give it one kind`

/**
 * Declares the game's actions: `buttons` (pressed and held: jump, pause)
 * and `vectors` (a direction with length at most 1: move), each bound on
 * every device. Build the merged source with the returned set's `merge`.
 *
 * @example
 * ```ts
 * const Actions = Controls.actions({ buttons: ["jump", "pause"], vectors: ["move"] })
 * ```
 */
export const actions = <const Buttons extends readonly [string, ...Array<string>], const Vectors extends ReadonlyArray<string> = readonly []>(
  names: { readonly buttons: Buttons; readonly vectors?: Vectors } & DistinctKinds<Buttons[number], Vectors[number]>
): ActionSet<Buttons[number], Vectors[number]> => {
  type A = Buttons[number]
  type V = Vectors[number]
  const list: ReadonlyArray<A> = [...new Set(names.buttons)]
  const vectorList: ReadonlyArray<V> = [...new Set(names.vectors ?? [])]
  const everyAvailable = (): Record<string, boolean> => Object.fromEntries([...list, ...vectorList].map((name) => [name, true]))
  return {
    buttons: list,
    vectors: vectorList,
    lacking: (device, lacking) => ({ _tag: "Lacking", device, lacking }),
    group: (members) => ({ _tag: "Group", members }) as never,
    merge(devices) {
      const entries = Object.entries(devices as Readonly<Record<string, Entry>>).map(([name, entry]) => {
        const unit = isLacking(entry) ? entry.device : entry
        return { name, members: membersOf(name, unit), lacking: new Set<string>(isLacking(entry) ? entry.lacking : []) }
      })
      const all = entries.flatMap((entry) => entry.members)
      for (const { device } of all) claim(device, "a Controls merge")
      let lastUsed: string | null = null
      const rebind: Record<string, (bindings: never) => void> = {}
      for (const { name, device } of all) {
        const candidate = (device as Device & { readonly rebind?: unknown }).rebind
        if (typeof candidate === "function") rebind[name] = (bindings) => candidate.call(device, bindings)
      }
      const controls = {
        snapshot() {
          const snapshots: Record<string, DeviceSnapshot<string, string>> = {}
          for (const { name, device } of all) snapshots[name] = device.snapshot()
          const used = entries.filter(({ members }) => members.some(({ name }) => snapshots[name]!.used))
          if (used.length > 0 && !used.some(({ name }) => name === lastUsed)) lastUsed = used[0]!.name
          const current = entries.find(({ name }) => name === lastUsed)
          const merged: Record<string, ActionState> = {}
          const available: Record<string, boolean> = {}
          for (const action of list) {
            let held = false
            let pressed = false
            let released = false
            for (const { name } of all) {
              const state = (snapshots[name]!.actions as Readonly<Record<string, ActionState | undefined>>)[action]
              if (state === undefined) continue
              held ||= state.held
              pressed ||= state.pressed
              released ||= state.released
            }
            merged[action] = held || pressed || released ? { held, pressed, released: released && !held } : idleState
            available[action] = current === undefined || !current.lacking.has(action)
          }
          const vectors: Record<string, Vector> = {}
          for (const action of vectorList) {
            let longest = zero
            for (const { name } of all) {
              const vector = (snapshots[name]!.vectors as Readonly<Record<string, Vector | undefined>>)[action]
              if (vector !== undefined) longest = longer(longest, vector)
            }
            // A plain vector, even from a device whose vectors carry more (a touch stick's `active`).
            vectors[action] = longest === zero ? zero : { x: longest.x, y: longest.y }
            available[action] = current === undefined || !current.lacking.has(action)
          }
          return { actions: merged, vectors, available, devices: snapshots, lastUsed }
        },
        rebind,
        dispose() {
          for (const { device } of all) device.dispose()
        },
        [Debug.serviceLints]: () => [
          ...entries.flatMap(({ name, lacking }) =>
            [...lacking].map((action) => ({
              severity: "info" as const,
              message: `${name} lacks ${action}, so while ${name} is the last used device the player cannot ${action}`,
              fix: `fine if the game offers ${action} another way while ${name} is in use (read available.${action} from the input); otherwise bind ${action} on ${name}`
            }))),
          ...all.flatMap(({ name, device }) => sharedLint(name, device))
        ]
      }
      // The checked signature carries the device types; the implementation is the same for every merge.
      return controls as never
    },
    idle: (devices) => ({
      actions: Object.fromEntries(list.map((name) => [name, idleState])) as Snapshot<A, V, never>["actions"],
      vectors: Object.fromEntries(vectorList.map((name) => [name, zero])) as Snapshot<A, V, never>["vectors"],
      available: everyAvailable() as Snapshot<A, V, never>["available"],
      devices,
      lastUsed: null
    }),
    random: (random, devices) => {
      const input = randomInput(random, list, vectorList)
      return {
        actions: input.actions as Snapshot<A, V, never>["actions"],
        vectors: input.vectors as Snapshot<A, V, never>["vectors"],
        available: everyAvailable() as Snapshot<A, V, never>["available"],
        devices,
        lastUsed: null
      }
    }
  }
}

/** A device handed to more than one source: each takes its snapshots, so each sees only some presses. */
const sharedLint = (name: string, device: object): ReadonlyArray<Debug.ServiceLint> =>
  ownersOf(device).length > 1
    ? [{
      severity: "warning",
      message: `${name} is taken by ${ownersOf(device).join(" and ")}: each takes its snapshots, so a press reaches one of them`,
      fix: `build ${name} once for each source (each Keyboard.actions(...) call is its own device), or merge it in one place`
    }]
    : []

// ── Players ─────────────────────────────────────────────────────────────

/** A slot's input without the device: what every player snapshot has, joined or not. */
export interface SlotInput<A extends string, V extends string> {
  readonly actions: { readonly [K in A]: ActionState }
  readonly vectors: { readonly [K in V]: Vector }
  /** Whether the slot's device binds each action: every one while the slot is empty. */
  readonly available: { readonly [K in A | V]: boolean }
}

/** A slot nobody holds: its input is idle. */
export interface EmptySlot<A extends string, V extends string> extends SlotInput<A, V> {
  readonly joined: false
  readonly device: null
  readonly connected: false
  /** `"left"` in the snapshot right after its player left, otherwise `null`. */
  readonly event: "left" | null
  readonly devices: { readonly [K in never]: never }
}

/** A slot held by a player, by the device they joined with. Check `device` to read that device's own snapshot. */
export type JoinedSlot<A extends string, V extends string, Devices> = {
  readonly [D in keyof Devices & string]: SlotInput<A, V> & {
    readonly joined: true
    readonly device: D
    /** `false` while the player's pad is unplugged: the slot is kept, and the same pad coming back returns to it. */
    readonly connected: boolean
    /** `"joined"` in the snapshot where the player joined (their input is idle there, so the press that joins does nothing else), otherwise `null`. */
    readonly event: "joined" | null
    readonly devices: { readonly [P in D]: Devices[D] }
  }
}[keyof Devices & string]

/** One player slot: empty, or held through one of the pool's devices. */
export type Slot<A extends string, V extends string, Devices> = EmptySlot<A, V> | JoinedSlot<A, V, Devices>

/** Every slot by name, and whether joining is open. */
export type PlayersSnapshot<A extends string, V extends string, S extends string, Devices> =
  & { readonly joining: boolean }
  & { readonly [K in S]: Slot<A, V, Devices> }

/** What one pool entry hands a player: a pad's snapshot for `Gamepad.pads`, the device's otherwise. */
type UnitSnapshotOf<D> = D extends { readonly _tag: "Pads"; snapshot(): ReadonlyArray<infer S> } ? S : SnapshotOf<D>

type PoolDevicesOf<R> = { readonly [K in keyof R]: UnitSnapshotOf<DeviceOf<R[K]>> }

/** The entry when it fits the actions and binds the join action, otherwise an error naming the fix. */
type CheckPoolEntry<A extends string, V extends string, J extends string, Name extends string, E> = E extends Lacking<infer _D, infer Missing>
  ? [Missing & J] extends [never]
    ? CheckEntry<A, V, Name, E>
    : `${Name} lacks ${Missing & J}: every pooled device binds ${J}, or no one can join with it`
  : CheckEntry<A, V, Name, E>

/**
 * A pooled device to seat a player on: its pool name, or `{ [name]: index }`
 * for one pad of a `Gamepad.pads` entry (its place in the pad list, from 0).
 */
export type SeatDevice<R> =
  | { readonly [K in keyof R & string]: DeviceOf<R[K]> extends Pads ? never : K }[keyof R & string]
  | { readonly [K in keyof R & string]: DeviceOf<R[K]> extends Pads ? { readonly [P in K]: number } : never }[keyof R & string]

/**
 * Whether {@link Pool.seat} seated the player: `slot-taken` when someone
 * holds the slot, `device-taken` when another slot holds the device, and
 * `no-such-pad` when the index is not a place in the pad list.
 */
export type SeatResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "slot-taken" | "device-taken" | "no-such-pad" }

/** The pooled input source, for `InputCapture.system(...)`; systems call the rest through a plain service. */
export interface Pool<A extends string, V extends string, S extends string, R> extends System.Consumes<"snapshot"> {
  /** Takes every device's snapshot, applies joins, leaves, and reconnects, and reports every slot. */
  snapshot(): PlayersSnapshot<A, V, S, PoolDevicesOf<R>>
  /** Opens or closes joining: open on a join screen or for drop-in play, closed during a round. Closed at the start. */
  setJoining(open: boolean): void
  /**
   * Gives `slot` to `device` without a press, joining or not: a player who
   * is in from the start (call it from a setup system), or one picked on a
   * menu. The next snapshot reports `event: "joined"`, as a join does. A
   * pad not plugged in yet holds the slot with `connected: false`.
   */
  seat(slot: S, device: SeatDevice<R>): SeatResult
  /** Frees a slot (a pause menu's "Leave", "Continue without P2"); its device goes back to the pool. */
  leave(slot: S): void
  /** Each pooled device's `rebind`, by its pool name (`Gamepad.pads` rebinds every pad). */
  readonly rebind: {
    readonly [K in keyof R as DeviceOf<R[K]> extends { readonly rebind: unknown } ? K : never]: DeviceOf<R[K]> extends { readonly rebind: infer Rebind } ? Rebind : never
  }
  /** Disposes every pooled device. */
  dispose(): void
}

/** The players of a local multiplayer game, declared once. */
export interface PlayerSet<A extends string, V extends string, S extends string, J extends string> {
  /** The slots, in join order. */
  readonly slots: ReadonlyArray<S>
  /**
   * Pools `devices`: none belongs to a player until someone presses join on
   * it. Each binds every action (or is passed through `lacking`), and the
   * join action always: `Gamepad.pads(...)` lets every pad join on its own,
   * and two `Keyboard.actions` over different keys are two keyboard players.
   */
  pool<const R extends Readonly<Record<string, PoolEntry>>>(
    devices: { readonly [K in keyof R]: CheckPoolEntry<A, V, J, K & string, R[K]> }
  ): Pool<A, V, S, R>
  /**
   * Every slot empty and joining closed, for initializing the input
   * resource: pass each device's idle snapshot (`Keyboard.idle(...)`,
   * `Gamepad.idle(...)` for pads) under its pool name.
   */
  idle<const Devices extends Readonly<Record<string, DeviceSnapshot<string, string>>>>(devices: Devices): PlayersSnapshot<A, V, S, Devices>
  /**
   * Every player's input for one fuzzed frame (`Fuzz.input`'s `generate`,
   * which hands over the generator and the frame). The slots in `seats`
   * are held through the named pool device from the first frame, as
   * `pool.seat` in setup does: frame 1 reports their `event: "joined"`
   * with idle input, and every later frame draws their actions as the
   * action set's `random` does. The other slots stay empty and joining
   * stays closed. Pass each device's idle snapshot under its pool name, as
   * to {@link idle}; use {@link idle} for the neutral input.
   */
  random<const Devices extends Readonly<Record<string, DeviceSnapshot<string, string>>>>(
    random: Draw,
    frame: number,
    options: { readonly devices: Devices; readonly seats: { readonly [K in S]?: keyof Devices & string } }
  ): PlayersSnapshot<A, V, S, Devices>
}

/** Rejects a slot named like the snapshot's own field. */
type SlotNames<S extends string> = [S & "joining"] extends [never] ? unknown : "joining is the snapshot's own field: name the slot something else"

/** Rejects a button action named like `join: "any"`, which would read as any button. */
type NoAnyAction<A extends string> = [A & "any"] extends [never] ? unknown : "an action named any reads as join: \"any\" (any button): rename the action"

/**
 * Declares the players of a local multiplayer game over `actions`: the
 * `slots` (the most players at once, in join order), the button action
 * that joins (`"any"` for any button action but `leave`, or any vector
 * moved), and the optional one that leaves while joining is open. Build the
 * input source with the returned set's `pool`. For one player on several
 * devices, use the action set's `merge` instead.
 *
 * Pressing join on a device nobody holds gives it the first free slot; that
 * snapshot reports `event: "joined"` with the player's input idle, so the
 * press does nothing else. A slot keeps its name when another empties. A
 * pad that disconnects keeps its slot (`connected: false`) and returns to
 * it when it comes back (two pads of one model share an id, so they are
 * told apart by their place in the pad list: each returns to the slot
 * holding that place). Leaving by button works only while joining is
 * open; otherwise `leave` is an ordinary action (a pause menu), and
 * `pool.leave(slot)` frees the slot. `pool.seat(slot, device)` puts a
 * player in without a press: one who is in from the start.
 *
 * @example
 * ```ts
 * const Players = Controls.players(Actions, { slots: ["p1", "p2"], join: "join", leave: "back" })
 * const makePlayers = (devices: {
 *   readonly left: Keyboard.Actions<typeof leftKeys>
 *   readonly right: Keyboard.Actions<typeof rightKeys>
 *   readonly pads: Gamepad.Pads<typeof padBindings>
 * }) => Players.pool(devices)
 *
 * // In a system:
 * const input = resources.input.get()
 * if (input.p2.event === "joined") spawnSecondPlayer()
 * const move = input.p2.vectors.move
 * ```
 */
export const players = <
  A extends string,
  V extends string,
  const S extends readonly [string, ...Array<string>],
  const J extends A | "any",
  const L extends A = never
>(
  actions: ActionSet<A, V> & NoAnyAction<A>,
  options: { readonly slots: S & SlotNames<S[number]>; readonly join: J; readonly leave?: L }
): PlayerSet<A, V, S[number], Exclude<J, "any">> => {
  type Snap = DeviceSnapshot<string, string>
  const slots: ReadonlyArray<S[number]> = [...new Set(options.slots as S)]
  const buttons = actions.buttons as ReadonlyArray<string>
  const vectors = actions.vectors as ReadonlyArray<string>
  const join = options.join as string
  const leaveAction = options.leave as string | undefined
  const idleInput = (): SlotInput<string, string> => ({
    actions: Object.fromEntries(buttons.map((name) => [name, idleState])),
    vectors: Object.fromEntries(vectors.map((name) => [name, zero])),
    available: Object.fromEntries([...buttons, ...vectors].map((name) => [name, true]))
  })
  const empty = (event: "left" | null) => ({ ...idleInput(), joined: false, device: null, connected: false, event, devices: {} })
  return {
    slots,
    idle: () => ({ joining: false, ...Object.fromEntries(slots.map((slot) => [slot, empty(null)])) }) as never,
    random: (random, frame, { devices, seats }) => {
      const seated: Readonly<Record<string, string | undefined>> = seats
      const result: Record<string, unknown> = { joining: false }
      for (const slot of slots) {
        const device = seated[slot]
        if (device === undefined) {
          result[slot] = empty(null)
          continue
        }
        const joined = frame <= 1
        result[slot] = {
          ...idleInput(),
          ...(joined ? {} : randomInput(random, buttons, vectors)),
          joined: true,
          device,
          connected: true,
          event: joined ? "joined" : null,
          devices: { [device]: devices[device] }
        }
      }
      // The checked signature carries the slot and device types; every slot is filled above.
      return result as never
    },
    pool(devices) {
      const entries = Object.entries(devices as Readonly<Record<string, PoolEntry>>).map(([name, entry]) => {
        const unit = isLacking(entry) ? entry.device : entry
        claim(unit, "a player pool")
        return { name, unit, lacking: new Set<string>(isLacking(entry) ? entry.lacking : []) }
      })
      const isPads = (unit: Device | Pads | Unit): unit is Pads => (unit as Partial<Pads>)._tag === "Pads"
      /** Who holds each slot: the pool entry, the pad's place in its list, and the pad's id to find it again. */
      const held = new Map<string, { readonly device: string; key: string; id: string | null }>()
      const events = new Map<string, "joined" | "left">()
      let joining = false
      let everOpened = false
      let everSeated = false
      const wantsJoin = (snapshot: Snap): boolean => {
        const pressed = (name: string) => (snapshot.actions as Readonly<Record<string, ActionState | undefined>>)[name]?.pressed === true
        if (join !== "any") return pressed(join)
        return buttons.some((name) => name !== leaveAction && pressed(name)) ||
          Object.values(snapshot.vectors as Readonly<Record<string, Vector>>).some((vector) => vector.x !== 0 || vector.y !== 0)
      }
      const rebind: Record<string, (bindings: never) => void> = {}
      for (const { name, unit } of entries) {
        const candidate = (unit as { readonly rebind?: unknown }).rebind
        if (typeof candidate === "function") rebind[name] = (bindings) => candidate.call(unit, bindings)
      }
      const pool = {
        snapshot() {
          const units: Array<{ readonly key: string; readonly device: string; readonly id: string | null; readonly connected: boolean; readonly snapshot: Snap }> = []
          for (const { name, unit } of entries) {
            if (isPads(unit)) unit.snapshot().forEach((snapshot, index) => units.push({ key: `${name}#${index}`, device: name, id: snapshot.id, connected: snapshot.connected, snapshot }))
            else units.push({ key: name, device: name, id: null, connected: true, snapshot: (unit as Device).snapshot() })
          }
          const byKey = new Map(units.map((unit) => [unit.key, unit]))
          // A pad seated before it was plugged in is known by its id from the first snapshot it shows up in.
          for (const holder of held.values()) {
            const unit = byKey.get(holder.key)
            if (holder.id === null && unit?.connected === true) holder.id = unit.id
          }
          const taken = new Set([...held.values()].map((holder) => holder.key))
          // A pad that comes back (here or at another index) returns to the slot it holds.
          for (const holder of held.values()) {
            if (holder.id === null || byKey.get(holder.key)?.connected === true) continue
            const back = units.find((unit) => unit.device === holder.device && unit.id === holder.id && unit.connected && !taken.has(unit.key))
            if (back === undefined) continue
            taken.delete(holder.key)
            holder.key = back.key
            taken.add(back.key)
          }
          if (joining && leaveAction !== undefined) {
            for (const [slot, holder] of held) {
              // A slot seated since the last snapshot reports its join first; its input is idle there.
              if (events.get(slot) === "joined") continue
              const unit = byKey.get(holder.key)
              const pressed = (unit?.snapshot.actions as Readonly<Record<string, ActionState | undefined>> | undefined)?.[leaveAction]?.pressed
              if (unit?.connected === true && pressed === true) {
                held.delete(slot)
                taken.delete(holder.key)
                events.set(slot, "left")
              }
            }
          }
          if (joining) {
            for (const unit of units) {
              if (taken.has(unit.key) || !unit.connected || !wantsJoin(unit.snapshot)) continue
              const free = slots.find((slot) => !held.has(slot))
              if (free === undefined) break
              held.set(free, { device: unit.device, key: unit.key, id: unit.id })
              taken.add(unit.key)
              events.set(free, "joined")
            }
          }
          const result: Record<string, unknown> = { joining }
          for (const slot of slots) {
            const holder = held.get(slot)
            const event = events.get(slot) ?? null
            if (holder === undefined) {
              result[slot] = empty(event === "left" ? "left" : null)
              continue
            }
            const unit = byKey.get(holder.key)
            const lacking = entries.find(({ name }) => name === holder.device)?.lacking ?? new Set<string>()
            const input = idleInput()
            // The snapshot that joins is idle, so the join press does nothing else.
            if (unit !== undefined && event !== "joined") {
              const actionsNow = unit.snapshot.actions as Readonly<Record<string, ActionState | undefined>>
              const vectorsNow = unit.snapshot.vectors as Readonly<Record<string, Vector | undefined>>
              for (const name of buttons) (input.actions as Record<string, ActionState>)[name] = actionsNow[name] ?? idleState
              const vectorsInto = input.vectors as Record<string, Vector>
              for (const name of vectors) {
                const vector = vectorsNow[name]
                vectorsInto[name] = vector === undefined ? zero : { x: vector.x, y: vector.y }
              }
            }
            for (const name of [...buttons, ...vectors]) (input.available as Record<string, boolean>)[name] = !lacking.has(name)
            result[slot] = {
              ...input,
              joined: true,
              device: holder.device,
              connected: unit?.connected ?? false,
              event: event === "joined" ? "joined" : null,
              devices: unit === undefined ? {} : { [holder.device]: unit.snapshot }
            }
          }
          events.clear()
          return result
        },
        setJoining(open: boolean) {
          joining = open
          if (open) everOpened = true
        },
        seat(slot: string, device: string | Readonly<Record<string, number>>): SeatResult {
          const [name, index] = typeof device === "string" ? [device, null] : Object.entries(device)[0] ?? ["", 0]
          const unit = entries.find((entry) => entry.name === name)?.unit
          if (unit === undefined || (index !== null && !(isPads(unit) && Number.isInteger(index) && index >= 0 && index < unit.max))) {
            return { ok: false, reason: "no-such-pad" }
          }
          const key = index === null ? name : `${name}#${index}`
          if (held.has(slot)) return { ok: false, reason: "slot-taken" }
          if ([...held.values()].some((holder) => holder.key === key)) return { ok: false, reason: "device-taken" }
          held.set(slot, { device: name, key, id: null })
          events.set(slot, "joined")
          everSeated = true
          return { ok: true }
        },
        leave(slot: string) {
          if (!held.delete(slot)) return
          events.set(slot, "left")
        },
        rebind,
        dispose() {
          for (const { unit } of entries) unit.dispose()
        },
        [Debug.serviceLints]: (): ReadonlyArray<Debug.ServiceLint> => {
          const keyed = entries.flatMap(({ name, unit }) => {
            const keys = (unit as ReportsBoundKeys)[boundKeys]?.()
            return keys === undefined ? [] : [{ name, keys: new Set(keys) }]
          })
          const shared = keyed.flatMap((first, index) => keyed.slice(index + 1).flatMap((second) =>
            [...first.keys].filter((key) => second.keys.has(key)).map((key) => ({
              severity: "warning" as const,
              message: `${first.name} and ${second.name} both bind ${key}: one key press reaches two players`,
              fix: `bind ${key} on one of them only, so each player has their own keys`
            }))))
          return [
            ...shared,
            ...entries.flatMap(({ name, unit }) => sharedLint(name, unit)),
            ...entries.flatMap(({ name, lacking }) => [...lacking].map((action) => ({
              severity: "info" as const,
              message: `${name} lacks ${action}, so a player on ${name} cannot ${action}`,
              fix: `fine if the game offers ${action} another way (read available.${action} from the player's input); otherwise bind ${action} on ${name}`
            }))),
            ...(everOpened || everSeated ? [] : [{
              severity: "info" as const,
              message: "joining was never opened in this session, so nobody could join",
              fix: "call setJoining(true) from a system (on the join screen, or once at setup for drop-in play)"
            }])
          ]
        }
      }
      // The checked signature carries the device types; the implementation is the same for every pool.
      return pool as never
    }
  }
}
