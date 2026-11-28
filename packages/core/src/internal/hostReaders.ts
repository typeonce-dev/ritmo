/**
 * The host readers behind `runtime.events(descriptor)`.
 *
 * Systems read events from the runtime's streams, which keep a batch only
 * until every registered system read it and for a frame or two beyond. A
 * host reader instead copies its descriptor's batches into a queue of its
 * own, stamped with the tick that published them, between ticks: at the
 * start of every tick (before the streams trim), and when it is read. So a
 * frame that runs several steps before the host reads loses nothing, and a
 * failed phase's events, which the runtime retracts before the tick returns,
 * are never copied. A runtime without readers pays one length check per
 * tick.
 *
 * The queue keeps the last {@link window} ticks. A restore drops what is
 * unread (the world it came from is gone); a rewind drops the unread records
 * of the ticks it undid, and reports every undone tick the reader saw, since
 * the ticks that run again publish their events again.
 */
import type { EventReader, EventRecord, EventsLost } from "../Runtime.ts"
import type { Streams } from "./streams.ts"

/** How many ticks of events a host reader that is not read keeps; older ones are lost (`"unread"`). */
export const window = 1024

type Reason = "unread" | "restore" | "rewind"

interface Range {
  readonly from: number
  readonly to: number
}

interface State {
  readonly key: symbol
  /** The first tick this reader sees. */
  readonly from: number
  /** The change tick it copied the stream through. */
  since: number
  records: Array<EventRecord<unknown>>
  readonly lost: { rewind: Range | undefined; restore: Range | undefined; unread: Range | undefined }
  closed: boolean
}

/** What the readers need from the runtime. */
export interface Host {
  readonly streams: Streams<unknown>
  /** The world's change tick now. */
  readonly currentTick: () => number
  /** How many ticks the runtime has begun: the tick of what it publishes now. */
  readonly frame: () => number
  /** Throws when `call` is made while a schedule runs or a stepped frame is open. */
  readonly between: (call: string) => void
}

export interface HostReaders {
  /** Whether any reader is open: the runtime calls the hooks below only then. */
  readonly active: () => boolean
  readonly make: (key: symbol, name: string) => EventReader<unknown>
  /** Copies what every reader has not copied yet. Call between ticks, before the streams trim or change. */
  readonly pull: () => void
  /** After a restore cleared the streams: drops what was unread, and starts every reader at the restored world. */
  readonly restored: () => void
  /** A rewind to a checkpoint taken when the runtime had begun `checkpointFrame` ticks undid the ticks after it. Call after `pull`. */
  readonly rewound: (checkpointFrame: number) => void
}

const noRecords: ReadonlyArray<never> = Object.freeze([])

const lose = (state: State, reason: Reason, from: number, to: number): void => {
  const lost = state.lost[reason]
  state.lost[reason] = lost === undefined ? { from, to } : { from: Math.min(lost.from, from), to: Math.max(lost.to, to) }
}

export const make = (host: Host): HostReaders => {
  const open: Array<State> = []

  const pullOne = (state: State, frame: number): void => {
    const since = state.since
    const now = host.currentTick()
    if (now !== since) {
      // Only a batch dropped before this reader copied it: a tick that published more than the stream's capacity.
      if (host.streams.lagged(state.key, since, since)) lose(state, "unread", frame, frame + 1)
      host.streams.eachBatch(state.key, since, (values, sent) => {
        // The host knows what it sent itself: a reader hands back what the simulation published.
        if (sent) return
        for (let index = 0; index < values.length; index++) state.records.push({ tick: frame, value: values[index] })
      })
      state.since = now
    }
    const records = state.records
    const oldest = frame - window
    if (records.length === 0 || records[0]!.tick > oldest) return
    let count = 0
    while (count < records.length && records[count]!.tick <= oldest) count++
    lose(state, "unread", records[0]!.tick, records[count - 1]!.tick + 1)
    records.splice(0, count)
  }

  const pull = (): void => {
    const frame = host.frame()
    for (let index = 0; index < open.length; index++) pullOne(open[index]!, frame)
  }

  return {
    active: () => open.length > 0,
    make(key, name) {
      const since = host.currentTick()
      const state: State = {
        key,
        from: host.frame() + 1,
        since,
        records: [],
        lost: { rewind: undefined, restore: undefined, unread: undefined },
        closed: false
      }
      open.push(state)
      return {
        take() {
          if (state.closed) return noRecords
          host.between(`events(${name}).take`)
          pullOne(state, host.frame())
          if (state.records.length === 0) return noRecords
          const records = state.records
          state.records = []
          return records
        },
        lost() {
          if (state.closed) return undefined
          host.between(`events(${name}).lost`)
          pullOne(state, host.frame())
          for (const reason of ["rewind", "restore", "unread"] as const) {
            const range = state.lost[reason]
            if (range === undefined) continue
            state.lost[reason] = undefined
            const report: EventsLost = { _tag: "EventsLost", from: range.from, to: range.to, reason }
            return report
          }
          return undefined
        },
        close() {
          if (state.closed) return
          state.closed = true
          state.records = []
          state.lost.rewind = state.lost.restore = state.lost.unread = undefined
          open.splice(open.indexOf(state), 1)
        }
      }
    },
    pull,
    restored() {
      const frame = host.frame()
      const now = host.currentTick()
      for (const state of open) {
        if (state.records.length > 0) {
          lose(state, "restore", state.records[0]!.tick, frame + 1)
          state.records = []
        }
        state.since = now
      }
    },
    rewound(checkpointFrame) {
      const frame = host.frame()
      for (const state of open) {
        const from = Math.max(checkpointFrame + 1, state.from)
        if (from > frame) continue
        lose(state, "rewind", from, frame + 1)
        const records = state.records
        let kept = records.length
        while (kept > 0 && records[kept - 1]!.tick >= from) kept--
        records.length = kept
      }
    }
  }
}
