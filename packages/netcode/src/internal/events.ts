/**
 * The events behind `session.events(descriptor)`: what each tick of the
 * session published, and each host reader's view of it.
 *
 * One ledger per descriptor reads the runtime's events with an inspector
 * right after every tick the session runs, so every record carries the
 * session tick that published it (and an inspector drained just before the
 * tick drops what other schedules published meanwhile). The runtime's
 * change ticks never go back, even across a rewind, so a re-run tick's
 * events reach the inspector again.
 *
 * `log` holds the latest run of every tick that is not settled yet (could
 * still run again). The session moves settled ticks into each reader's
 * confirmed queue once, and tells the ledger when it rewinds. A tick a
 * reader saw as predicted is withdrawn when it runs again with other events
 * (compared by value, see {@link same}), or does not run again at all.
 */
import * as Inspector from "@typeonce/ritmo/Inspector"
import * as System from "@typeonce/ritmo/System"

import type { EventRecord, EventStreams, EventsLost, Withdrawn } from "../Netcode.ts"

/** How many settled ticks a reader's unread confirmed events are kept for. */
export const window = 1024

interface Reader {
  /** The first tick this reader sees: the session's next tick when it was made. */
  readonly from: number
  /** Settled records not read yet, oldest first. */
  confirmed: Array<EventRecord<unknown>>
  /** Unsettled ticks whose records `predicted()` handed out (only ticks with records), with their values. */
  readonly delivered: Map<number, ReadonlyArray<unknown>>
  /** Ticks a rewind undid after `predicted()` handed out their records, not read yet. */
  readonly withdrawn: Set<number>
  lost: { from: number; to: number } | undefined
}

export interface Ledger {
  /** Drops what was published since the last tick: not this session's. Call right before a tick. */
  readonly skip: () => void
  /** Keeps what `tick` published. Call right after it ran. */
  readonly record: (tick: number) => void
  /** Ticks from `from` on were undone and will run again: a rollback. */
  readonly rewind: (from: number) => void
  /** After a rollback ran again: withdraws what readers saw of ticks that did not run again. */
  readonly resolve: () => void
  /** Every unsettled tick is gone: a resync. Withdraws everything predicted. */
  readonly reset: () => void
  /** Every tick before `settled` will not run again: hands its records to the readers' confirmed queues once. */
  readonly settle: (previous: number, settled: number) => void
  /** A new reader, from tick `from` on. */
  readonly reader: (from: number) => EventStreams<unknown>
}

/** What a ledger needs from the session. */
export interface LedgerHost {
  readonly schema: unknown
  readonly inspect: (inspector: unknown) => unknown
  /** The ticks before this one are settled. */
  readonly settled: () => number
}

const lose = (reader: Reader, from: number, to: number): void => {
  reader.lost = reader.lost === undefined
    ? { from, to }
    : { from: Math.min(reader.lost.from, from), to: Math.max(reader.lost.to, to) }
}

const byTick = (a: number, b: number): number => a - b

const plain = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Whether two runs of a tick published the same events: primitives, and
 * arrays and plain objects of them, compared by value; anything else (a
 * class instance, a map) only by identity, so it counts as changed.
 */
export const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) if (!same(a[index], b[index])) return false
    return true
  }
  if (Array.isArray(b) || !plain(a) || !plain(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

export const make = (host: LedgerHost, descriptor: { readonly name: string }): Ledger => {
  const inspector = Inspector.make(
    `Netcode/events ${descriptor.name}`,
    { schema: host.schema as never, events: { read: System.readEvent(descriptor as never) } },
    ({ events }) => {
      const view = (events as { readonly read: { all(): ReadonlyArray<unknown>; lagged(): boolean } }).read
      return { values: view.all().slice(), lagged: view.lagged() }
    }
  )
  const read = (): { readonly values: ReadonlyArray<unknown>; readonly lagged: boolean } =>
    host.inspect(inspector) as { readonly values: ReadonlyArray<unknown>; readonly lagged: boolean }

  const log = new Map<number, ReadonlyArray<unknown>>()
  const readers: Array<Reader> = []

  const withdraw = (reader: Reader, tick: number): void => {
    reader.delivered.delete(tick)
    reader.withdrawn.add(tick)
  }

  const unsettled = (reader: Reader): Array<number> => {
    const settled = Math.max(host.settled(), reader.from)
    const ticks: Array<number> = []
    for (const tick of log.keys()) if (tick >= settled) ticks.push(tick)
    return ticks.sort(byTick)
  }

  return {
    skip: () => {
      read()
    },
    record: (tick) => {
      const { values, lagged } = read()
      log.set(tick, values)
      // Run again after a rollback: what a reader saw stands if the events are the same.
      for (const reader of readers) {
        const seen = reader.delivered.get(tick)
        if (seen !== undefined && !same(seen, values)) withdraw(reader, tick)
      }
      // More than the runtime's stream capacity in one tick: what it dropped is gone for every reader.
      if (lagged) for (const reader of readers) if (tick >= reader.from) lose(reader, tick, tick + 1)
    },
    rewind: (from) => {
      for (const tick of [...log.keys()]) if (tick >= from) log.delete(tick)
    },
    resolve: () => {
      for (const reader of readers) for (const tick of reader.delivered.keys()) if (!log.has(tick)) withdraw(reader, tick)
    },
    reset: () => {
      log.clear()
      for (const reader of readers) for (const tick of reader.delivered.keys()) withdraw(reader, tick)
    },
    settle: (previous, settled) => {
      const ticks = [...log.keys()].filter((tick) => tick < settled).sort(byTick)
      for (const reader of readers) {
        for (const tick of ticks) {
          // Run again after a resync, but settled before it: already handed out.
          if (tick < previous || tick < reader.from) continue
          for (const value of log.get(tick)!) reader.confirmed.push({ tick, value })
        }
        for (const tick of reader.delivered.keys()) if (tick < settled) reader.delivered.delete(tick)
        // A reader that stopped reading keeps the last `window` settled ticks.
        const oldest = settled - window
        let drop = 0
        while (drop < reader.confirmed.length && reader.confirmed[drop]!.tick < oldest) drop++
        if (drop > 0) {
          lose(reader, reader.confirmed[0]!.tick, reader.confirmed[drop - 1]!.tick + 1)
          reader.confirmed = reader.confirmed.slice(drop)
        }
        for (const tick of reader.withdrawn) if (tick < oldest) reader.withdrawn.delete(tick)
      }
      for (const tick of ticks) log.delete(tick)
    },
    reader: (from) => {
      const reader: Reader = { from, confirmed: [], delivered: new Map(), withdrawn: new Set(), lost: undefined }
      readers.push(reader)
      return {
        confirmed: () => {
          const records = reader.confirmed
          reader.confirmed = []
          return records
        },
        predicted: () => {
          const records: Array<EventRecord<unknown>> = []
          for (const tick of unsettled(reader)) {
            // Its earlier run is still to be withdrawn: hand out the new one after `withdrawn()` named it.
            if (reader.delivered.has(tick) || reader.withdrawn.has(tick)) continue
            const values = log.get(tick)!
            if (values.length === 0) continue
            reader.delivered.set(tick, values)
            for (const value of values) records.push({ tick, value })
          }
          return records
        },
        withdrawn: () => {
          const ticks: Array<Withdrawn> = [...reader.withdrawn].sort(byTick).map((tick) => ({ tick }))
          reader.withdrawn.clear()
          return ticks
        },
        lost: (): EventsLost | undefined => {
          const lost = reader.lost
          if (lost === undefined) return undefined
          reader.lost = undefined
          return { _tag: "EventsLost", from: lost.from, to: lost.to }
        }
      }
    }
  }
}
