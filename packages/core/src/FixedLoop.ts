/**
 * Deterministic fixed-step timing for any host: browsers, native shells,
 * desktop runtimes, servers, and headless tests.
 *
 * The loop owns the timing policy that is easy to get subtly wrong in every
 * game: frame clamping, catch-up limits, interpolation, cancellation, and
 * typed update failures. It does not know about an ECS runtime, a renderer,
 * or a platform: frames arrive through a `TickSource` that the host supplies.
 * Use a platform adapter such as `BrowserTickSource.make(window)` from
 * `@typeonce/ritmo-browser`, or wrap a renderer's own ticker or a server timer
 * with `source`.
 *
 * @example
 * ```ts
 * const loop = FixedLoop.start({
 *   source: BrowserTickSource.make(window),
 *   step: Clock.hz(60),
 *   maxFrameSeconds: 0.25,
 *   maxStepsPerFrame: 5,
 *   update: () => runtime.tick(update),
 *   render: (frame) => draw(frame.alpha),
 *   onFailure: (failure) => console.error(failure)
 * })
 * ```
 *
 * @example
 * ```ts
 * // Server host (Node, a Cloudflare Durable Object): a timer, no renderer
 * const interval = FixedLoop.source((onTick) => {
 *   let last = performance.now()
 *   const id = setInterval(() => {
 *     const now = performance.now()
 *     onTick({ deltaMS: now - last })
 *     last = now
 *   }, 1000 / 60)
 *   return { stop: () => clearInterval(id) }
 * })
 *
 * const loop = FixedLoop.start({
 *   source: interval,
 *   step: Clock.hz(60),
 *   maxFrameSeconds: 0.25,
 *   maxStepsPerFrame: 5,
 *   update: () => runtime.tick(update),
 *   render: () => {},
 *   onFailure: (failure) => console.error(failure)
 * })
 * ```
 *
 * @module FixedLoop
 * @docGroup runtime
 */
import type * as Clock from "./Clock.ts"
import * as Result from "./Result.ts"

/** One host frame: milliseconds elapsed since the previous one. */
export interface Tick {
  readonly deltaMS: number
}

/** A stoppable host subscription. Calling `stop` more than once is safe. */
export interface Subscription {
  stop(): void
}

/**
 * Where host frames come from. Implemented by platform adapters
 * (`BrowserTickSource.make(window)`), by `source` around a renderer's ticker,
 * and by deterministic tests.
 */
export interface TickSource<TTick extends Tick = Tick> {
  subscribe(onTick: (tick: TTick) => void): Subscription
}

/** Validated fixed-step timing policy. */
export interface Options {
  /**
   * The fixed step every update advances (`Clock.hz(60)`): the same value
   * the game's clock resource runs at, so the loop and the clock agree.
   */
  readonly step: Clock.Step
  /** Maximum host-frame duration admitted into the accumulator. */
  readonly maxFrameSeconds: number
  /** Maximum number of simulation updates performed for one host frame. */
  readonly maxStepsPerFrame: number
}

/** Configuration error returned before a loop subscribes to its host. */
export interface InvalidOptions {
  readonly kind: "InvalidFixedLoopOptions"
  readonly field: keyof Options
  readonly reason: "mustBeFiniteAndPositive" | "mustBePositiveInteger"
  readonly value: number
}

/** Data passed to the renderer after all fixed updates for one host frame. */
export interface Frame {
  /** Clamped time admitted for this host frame. */
  readonly elapsedSeconds: number
  /** Number of fixed updates completed for this host frame. */
  readonly fixedSteps: number
  /** Remaining accumulator fraction in the range `[0, 1)`. */
  readonly alpha: number
  /** Time discarded by frame clamping or the catch-up limit. */
  readonly droppedSeconds: number
}

/** Failure delivered by an active loop before it stops itself. */
export type Failure<UpdateError> =
  | {
      readonly kind: "InvalidTickDelta"
      readonly deltaMS: number
    }
  | {
      readonly kind: "UpdateFailure"
      readonly error: UpdateError
    }

/** A running fixed-step driver. */
export interface Driver extends Subscription {
  /** Clears accumulated partial time without removing the host subscription. */
  reset(): void
}

/** Input for a fixed-step driver. */
export interface StartOptions<TTick extends Tick, UpdateError> extends Options {
  readonly source: TickSource<TTick>
  readonly update: (stepSeconds: number) => Result.Result<void, UpdateError>
  readonly render: (frame: Frame) => void
  readonly onFailure: (failure: Failure<UpdateError>) => void
}

/** Wraps a host-specific subscription function in the canonical source type. */
export const source = <TTick extends Tick>(
  subscribe: TickSource<TTick>["subscribe"]
): TickSource<TTick> => ({ subscribe })

const validate = (options: Options): Result.Result<void, InvalidOptions> => {
  for (const field of ["maxFrameSeconds"] as const) {
    const value = options[field]
    if (!Number.isFinite(value) || value <= 0) {
      return Result.failure({
        kind: "InvalidFixedLoopOptions",
        field,
        reason: "mustBeFiniteAndPositive",
        value
      })
    }
  }
  if (!Number.isInteger(options.maxStepsPerFrame) || options.maxStepsPerFrame <= 0) {
    return Result.failure({
      kind: "InvalidFixedLoopOptions",
      field: "maxStepsPerFrame",
      reason: "mustBePositiveInteger",
      value: options.maxStepsPerFrame
    })
  }
  return Result.success(undefined)
}

/**
 * Starts a fixed-step loop after validating its timing policy.
 *
 * Update failures and malformed host ticks are delivered to `onFailure`, then
 * the driver stops. Render defects are deliberately not caught: they are
 * programmer defects, not expected game outcomes.
 */
export const start = <TTick extends Tick, UpdateError>(
  options: StartOptions<TTick, UpdateError>
): Result.Result<Driver, InvalidOptions> => {
  const validity = validate(options)
  if (!validity.ok) {
    return validity
  }

  let accumulator = 0
  let stopped = false
  let hostSubscription: Subscription | undefined

  const stop = (): void => {
    if (stopped) {
      return
    }
    stopped = true
    hostSubscription?.stop()
  }

  const fail = (failure: Failure<UpdateError>): void => {
    stop()
    options.onFailure(failure)
  }

  const onTick = (tick: TTick): void => {
    if (stopped) {
      return
    }
    if (!Number.isFinite(tick.deltaMS) || tick.deltaMS < 0) {
      fail({ kind: "InvalidTickDelta", deltaMS: tick.deltaMS })
      return
    }

    const rawSeconds = tick.deltaMS / 1000
    const elapsedSeconds = Math.min(rawSeconds, options.maxFrameSeconds)
    let droppedSeconds = rawSeconds - elapsedSeconds
    accumulator += elapsedSeconds

    let fixedSteps = 0
    while (accumulator >= options.step.dt && fixedSteps < options.maxStepsPerFrame) {
      const update = options.update(options.step.dt)
      if (!update.ok) {
        fail({ kind: "UpdateFailure", error: update.error })
        return
      }
      accumulator -= options.step.dt
      fixedSteps += 1
    }

    if (accumulator >= options.step.dt) {
      const droppedWholeSteps = Math.floor(accumulator / options.step.dt) * options.step.dt
      accumulator -= droppedWholeSteps
      droppedSeconds += droppedWholeSteps
    }

    options.render({
      elapsedSeconds,
      fixedSteps,
      alpha: accumulator / options.step.dt,
      droppedSeconds
    })
  }

  hostSubscription = options.source.subscribe(onTick)
  if (stopped) {
    hostSubscription.stop()
  }

  return Result.success({
    stop,
    reset() {
      accumulator = 0
    }
  })
}
