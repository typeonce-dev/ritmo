/**
 * Keyed append-only message logs read per reader, like change detection.
 *
 * Each batch is stamped with the change tick at which it was published. A
 * reader asks for the batches stamped after its previous completed run, so
 * every reader sees every message once, in publish order, without a schedule
 * marker.
 *
 * Retention: a batch is kept for at least the current and previous frame, and
 * beyond that until every registered reader of its key has read past it. So a
 * system in a schedule ticked less often than others (a fixed update driven
 * at a lower rate than rendering) still receives everything. Readers register
 * on their first run, so a host message (`surviveRestore`) of a key no reader
 * has registered for yet is kept for the first one. A reader that
 * stops running would keep batches alive forever, so each key also has a
 * capacity; past it the oldest batches are dropped and the readers that had
 * not seen them report `lagged`.
 */
interface Log<T> {
  readonly ticks: Array<number>
  /** Batches are never mutated after `append`, so single-batch reads return them uncopied. */
  readonly batches: Array<ReadonlyArray<T>>
  readonly surviveRestore: Array<boolean>
  size: number
  /** Newest tick of any dropped batch. */
  droppedThrough: number
  /** How many batches were ever dropped from the front: the position of `batches[0]` among all batches. */
  base: number
  /** While a checkpoint is held: the dropped batches a rewind can put back. */
  grave: Grave<T> | undefined
}

/**
 * Batches dropped since the oldest held checkpoint was taken, with their
 * positions, oldest first. Only those before `end`, where the log stood when
 * the newest one was taken, are kept: no rewind brings back a batch
 * published after every held checkpoint, so one checkpoint held for long
 * keeps no more than the log held when it was taken.
 */
interface Grave<T> {
  readonly positions: Array<number>
  readonly ticks: Array<number>
  readonly batches: Array<ReadonlyArray<T>>
  readonly surviveRestore: Array<boolean>
  end: number
}

const makeGrave = <T>(end: number): Grave<T> => ({ positions: [], ticks: [], batches: [], surviveRestore: [], end })

/** Forgets the entries of `grave` from `index` on. */
const truncateGrave = (grave: Grave<unknown>, index: number): void => {
  grave.positions.length = index
  grave.ticks.length = index
  grave.batches.length = index
  grave.surviveRestore.length = index
}

/** Index of the first entry of `grave` at or past `position`. */
const graveIndexOf = (grave: Grave<unknown>, position: number): number => {
  let low = 0
  let high = grave.positions.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (grave.positions[middle]! >= position) high = middle
    else low = middle + 1
  }
  return low
}

/** Where each stream's log stood when a checkpoint was taken. */
export interface StreamMark {
  readonly logs: ReadonlyMap<symbol, { readonly base: number; readonly end: number; readonly droppedThrough: number }>
}

/**
 * A registered reader's position: the tick of its previous completed run.
 */
export interface Cursor {
  readonly streamLastRun: number
}

const noValues: ReadonlyArray<never> = []

/** Debug view of one stream key. */
export interface StreamInspection {
  readonly key: symbol
  readonly size: number
  /** Tick of the oldest retained batch. */
  readonly oldestTick: number | undefined
  readonly readers: ReadonlyArray<Cursor>
}

export interface Streams<T> {
  /** Makes `cursor` hold `key`'s batches until it has read them. */
  register(key: symbol, cursor: Cursor): void
  /** Stops `cursor` holding any key's batches: a rewind took back the run that registered it. */
  unregister(cursor: Cursor): void
  /** Publishes `values` as one batch; the array must not be mutated afterwards. */
  append(key: symbol, tick: number, values: ReadonlyArray<T>, surviveRestore?: boolean): void
  /** Values for `key` stamped after `since`, oldest first. */
  since(key: symbol, since: number): ReadonlyArray<T>
  /**
   * Whether values for `key` stamped after `since` (and after `registeredAt`,
   * when the reader started) were dropped before being read.
   */
  lagged(key: symbol, since: number, registeredAt: number): boolean
  /**
   * Drops batches stamped at or before `windowBoundary` that every registered
   * reader has read, then enforces the capacity.
   */
  trim(windowBoundary: number): void
  /** Drops every batch stamped after `tick` (what a rolled-back phase published). */
  retract(tick: number): void
  /** Clears simulation messages; unread host messages survive world restore. */
  clear(): void
  /** Marks where every log stands; until the mark is released, dropped batches are kept for {@link rewind}. */
  mark(): StreamMark
  /**
   * Puts every log back to what it held at `mark`. Host messages published
   * after `tick` (the mark's tick) are kept: the host sent them, and nothing
   * re-sends them.
   */
  rewind(mark: StreamMark, tick: number): void
  /** Forgets the dropped batches no mark in `held` (the marks still held) can bring back. */
  release(held: ReadonlyArray<StreamMark>): void
  /** Every key with retained entries or registered readers. */
  inspect(): ReadonlyArray<StreamInspection>
  /** How many dropped batches of `key` are kept for a rewind to a held mark. */
  kept(key: symbol): number
  readonly capacity: number
}

export const make = <T>(capacity: number): Streams<T> => {
  const logs = new Map<symbol, Log<T>>()
  const readers = new Map<symbol, Set<Cursor>>()

  const firstAfter = (ticks: ReadonlyArray<number>, since: number): number => {
    let low = 0
    let high = ticks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (ticks[middle]! > since) high = middle
      else low = middle + 1
    }
    return low
  }

  const logFor = (key: symbol): Log<T> => {
    let log = logs.get(key)
    if (log === undefined) {
      log = { ticks: [], batches: [], surviveRestore: [], size: 0, droppedThrough: 0, base: 0, grave: undefined }
      logs.set(key, log)
    }
    return log
  }

  const dropFront = (log: Log<T>, count: number): void => {
    if (count === 0) return
    for (let index = 0; index < count; index++) log.size -= log.batches[index]!.length
    log.droppedThrough = Math.max(log.droppedThrough, log.ticks[count - 1]!)
    const grave = log.grave
    if (grave !== undefined) {
      for (let index = 0; index < count && log.base + index < grave.end; index++) {
        grave.positions.push(log.base + index)
        grave.ticks.push(log.ticks[index]!)
        grave.batches.push(log.batches[index]!)
        grave.surviveRestore.push(log.surviveRestore[index]!)
      }
    }
    log.ticks.splice(0, count)
    log.batches.splice(0, count)
    log.surviveRestore.splice(0, count)
    log.base += count
  }

  return {
    register(key, cursor) {
      let set = readers.get(key)
      if (set === undefined) {
        set = new Set()
        readers.set(key, set)
      }
      set.add(cursor)
    },
    unregister(cursor) {
      for (const set of readers.values()) set.delete(cursor)
    },
    append(key, tick, values, surviveRestore = false) {
      if (values.length === 0) return
      const log = logFor(key)
      log.ticks.push(tick)
      log.batches.push(values)
      log.surviveRestore.push(surviveRestore)
      log.size += values.length
    },
    since(key, since) {
      const log = logs.get(key)
      if (log === undefined) return noValues
      const start = firstAfter(log.ticks, since)
      const count = log.batches.length - start
      if (count === 0) return noValues
      if (count === 1) return log.batches[start]!
      const values: Array<T> = []
      for (let index = start; index < log.batches.length; index++) {
        const batch = log.batches[index]!
        for (let offset = 0; offset < batch.length; offset++) values.push(batch[offset]!)
      }
      return values
    },
    lagged(key, since, registeredAt) {
      const log = logs.get(key)
      return log !== undefined && log.droppedThrough > Math.max(since, registeredAt)
    },
    trim(windowBoundary) {
      for (const [key, log] of logs) {
        let boundary = windowBoundary
        const cursors = readers.get(key)
        if (cursors !== undefined) {
          for (const cursor of cursors) boundary = Math.min(boundary, cursor.streamLastRun)
        }
        let count = firstAfter(log.ticks, boundary)
        // No reader has run yet: a host message waits for the first one.
        if (cursors === undefined || cursors.size === 0) {
          const host = log.surviveRestore.indexOf(true)
          if (host !== -1) count = Math.min(count, host)
        }
        dropFront(log, count)
        let overflow = 0
        let size = log.size
        while (size > capacity && overflow < log.batches.length) {
          size -= log.batches[overflow]!.length
          overflow++
        }
        dropFront(log, overflow)
      }
    },
    retract(tick) {
      for (const log of logs.values()) {
        const start = firstAfter(log.ticks, tick)
        for (let index = start; index < log.batches.length; index++) log.size -= log.batches[index]!.length
        log.ticks.length = start
        log.batches.length = start
        log.surviveRestore.length = start
      }
    },
    clear() {
      for (const [key, log] of logs) {
        const ticks: Array<number> = []
        const batches: Array<ReadonlyArray<T>> = []
        for (let index = 0; index < log.ticks.length; index++) {
          if (!log.surviveRestore[index]) continue
          ticks.push(log.ticks[index]!)
          batches.push(log.batches[index]!)
        }
        if (ticks.length === 0) logs.delete(key)
        else logs.set(key, {
          ticks,
          batches,
          surviveRestore: ticks.map(() => true),
          size: batches.reduce((size, batch) => size + batch.length, 0),
          droppedThrough: log.droppedThrough,
          base: 0,
          grave: undefined
        })
      }
    },
    mark() {
      const marked = new Map<symbol, { readonly base: number; readonly end: number; readonly droppedThrough: number }>()
      for (const [key, log] of logs) {
        const end = log.base + log.batches.length
        log.grave ??= makeGrave(end)
        log.grave.end = end
        marked.set(key, { base: log.base, end, droppedThrough: log.droppedThrough })
      }
      return { logs: marked }
    },
    rewind(mark, tick) {
      for (const [key, log] of logs) {
        const kept = mark.logs.get(key)
        const ticks: Array<number> = []
        const batches: Array<ReadonlyArray<T>> = []
        const surviveRestore: Array<boolean> = []
        if (kept !== undefined) {
          const grave = log.grave
          // Batches dropped since the mark come back from the grave, the rest from the log.
          if (grave !== undefined) {
            for (let index = graveIndexOf(grave, kept.base); index < grave.positions.length && grave.positions[index]! < kept.end; index++) {
              ticks.push(grave.ticks[index]!)
              batches.push(grave.batches[index]!)
              surviveRestore.push(grave.surviveRestore[index]!)
            }
          }
          for (let index = Math.max(kept.base, log.base) - log.base; index < kept.end - log.base; index++) {
            ticks.push(log.ticks[index]!)
            batches.push(log.batches[index]!)
            surviveRestore.push(log.surviveRestore[index]!)
          }
        }
        const from = firstAfter(log.ticks, tick)
        for (let index = from; index < log.ticks.length; index++) {
          if (!log.surviveRestore[index]) continue
          ticks.push(log.ticks[index]!)
          batches.push(log.batches[index]!)
          surviveRestore.push(true)
        }
        if (log.grave !== undefined && kept !== undefined) {
          // What came back is in the log again, and the mark is the newest held.
          truncateGrave(log.grave, graveIndexOf(log.grave, kept.base))
          log.grave.end = kept.end
        }
        log.ticks.length = 0
        log.batches.length = 0
        log.surviveRestore.length = 0
        for (let index = 0; index < ticks.length; index++) {
          log.ticks.push(ticks[index]!)
          log.batches.push(batches[index]!)
          log.surviveRestore.push(surviveRestore[index]!)
        }
        log.size = batches.reduce((size, batch) => size + batch.length, 0)
        if (kept !== undefined) {
          log.base = kept.base
          log.droppedThrough = kept.droppedThrough
        } else {
          // Every batch of a log made after the mark was published after it.
          log.base += log.batches.length
          if (log.grave !== undefined) {
            truncateGrave(log.grave, 0)
            log.grave.end = log.base
          }
        }
      }
    },
    release(held) {
      for (const [key, log] of logs) {
        const grave = log.grave
        if (grave === undefined) continue
        let from = log.base
        let end = 0
        let marked = false
        for (const mark of held) {
          const kept = mark.logs.get(key)
          if (kept === undefined) continue
          marked = true
          from = Math.min(from, kept.base)
          end = Math.max(end, kept.end)
        }
        if (!marked) {
          log.grave = held.length === 0 ? undefined : makeGrave(log.base)
          continue
        }
        // Past the newest mark still held: released with the newer ones.
        truncateGrave(grave, graveIndexOf(grave, end))
        grave.end = end
        const drop = graveIndexOf(grave, from)
        grave.positions.splice(0, drop)
        grave.ticks.splice(0, drop)
        grave.batches.splice(0, drop)
        grave.surviveRestore.splice(0, drop)
      }
    },
    inspect() {
      const keys = new Set<symbol>([...logs.keys(), ...readers.keys()])
      return [...keys].map((key) => {
        const log = logs.get(key)
        return {
          key,
          size: log?.size ?? 0,
          oldestTick: log?.ticks[0],
          readers: [...(readers.get(key) ?? [])]
        }
      })
    },
    kept(key) {
      return logs.get(key)?.grave?.positions.length ?? 0
    },
    capacity
  }
}
