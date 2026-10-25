/**
 * Hidden pages: what every peer knows of each seat's hidden spells.
 *
 * A seat counts its spells: its `n`th hide announces `n` (a `hidden`
 * message, with its last sent input and whether it is `away`), and its
 * pings carry how many have ended (`shown`). Counts only grow, so messages
 * that arrive late or twice change nothing.
 *
 * An away seat (`"resync-on-return"`, never seat 0) is played around: its
 * input after `last` is idle on every peer, so they agree without it, until
 * a save from seat 0 answers its return (`returned` reaches its spell).
 * Seat 0 answers once it has seen the spell end; the seat restores that
 * save and plays again from it.
 */
import type * as Wire from "./wire.ts"

export interface Tracker {
  /** Per seat, the latest spell it announced (0: never hid). */
  readonly hides: Array<number>
  /** Per seat, how many of its spells ended. */
  readonly shown: Array<number>
  /** Per seat, the spells the last save answered. */
  readonly answered: Array<number>
  /** Per seat, whether its latest spell is played around. */
  readonly away: Array<boolean>
  /** Per seat, the last tick of its own input in its latest spell: idle after it. */
  readonly last: Array<number>
}

export const make = (count: number): Tracker => ({
  hides: Array.from({ length: count }, () => 0),
  shown: Array.from({ length: count }, () => 0),
  answered: Array.from({ length: count }, () => 0),
  away: Array.from({ length: count }, () => false),
  last: Array.from({ length: count }, () => -1)
})

/** Whether `seat`'s page is hidden now, as far as this peer knows. */
export const hidden = (tracker: Tracker, seat: number): boolean => tracker.hides[seat]! > tracker.shown[seat]!

/** Whether `seat` is played around: hidden under `"resync-on-return"`, or back and waiting for its save. */
export const away = (tracker: Tracker, seat: number): boolean =>
  seat !== 0 && tracker.away[seat]! && tracker.hides[seat]! > tracker.answered[seat]!

/** This peer hid: its `n`th spell, with its inputs ending at `last`. */
export const hide = (tracker: Tracker, seat: number, last: number, playedAround: boolean): void => {
  tracker.hides[seat]! += 1
  tracker.last[seat] = last
  tracker.away[seat] = playedAround && seat !== 0
}

/** This peer shows again. */
export const show = (tracker: Tracker, seat: number): void => {
  tracker.shown[seat] = tracker.hides[seat]!
}

/** A seat announced a spell. Inputs before `floor` are fixed by the last save, so its idle input starts after `floor - 1` at the earliest. */
export const announced = (tracker: Tracker, message: Wire.Hidden, floor: number): void => {
  const seat = message.from
  if (message.n < tracker.hides[seat]!) return
  tracker.hides[seat] = message.n
  tracker.away[seat] = message.away
  tracker.last[seat] = Math.max(message.last, floor - 1)
}

/** A seat's ping: `shown` of its spells ended. */
export const pinged = (tracker: Tracker, seat: number, shown: number): void => {
  tracker.shown[seat] = Math.max(tracker.shown[seat]!, shown)
}

/** A save at a new `floor`: seats it did not answer stay away, idle from the floor on at the latest. */
export const synced = (tracker: Tracker, returned: ReadonlyArray<number>, floor: number): void => {
  for (let seat = 0; seat < tracker.hides.length; seat++) {
    tracker.answered[seat] = Math.max(tracker.answered[seat]!, returned[seat]!)
    if (away(tracker, seat)) tracker.last[seat] = Math.max(tracker.last[seat]!, floor - 1)
  }
}

/** For seat 0: `seat` is away and back, so the next save answers it. */
export const returned = (tracker: Tracker, seat: number): boolean => away(tracker, seat) && tracker.shown[seat]! >= tracker.hides[seat]!

export const message = (tracker: Tracker, seat: number, epoch: number): Wire.Hidden => ({
  k: "hidden",
  from: seat,
  epoch,
  n: tracker.hides[seat]!,
  last: tracker.last[seat]!,
  away: tracker.away[seat]!
})
