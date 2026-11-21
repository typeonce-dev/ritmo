/**
 * Measures what sessions send: peers driven by `FixedLoop`, as a game
 * drives them, over memory links, each page on its own frame times (some
 * frames run more than one step, as on a slow device), for `seconds` of a
 * match. Counted at the link, as a relay would count them.
 */
import { FixedLoop, HostClock, Random } from "@typeonce/ritmo"
import { MemoryNetworkLink, Netcode, type NetworkLink } from "@typeonce/ritmo-netcode"

import { makePeer, pressed, simulate, step, type PlayerInput } from "./game.ts"

export interface TrafficOptions {
  readonly count: number
  readonly seconds: number
  readonly seed?: number
  readonly latencyMS?: number
  readonly jitterMS?: number
  readonly loss?: number
  /** A seat's input on a frame of its page: `pressed` (a new input almost every frame) when omitted. */
  readonly input?: (seat: number, frame: number) => PlayerInput
}

/** Held input, as in most real-time games: each seat changes what it presses every 20 frames. */
export const held = (seat: number, frame: number): PlayerInput => pressed(seat, Math.floor(frame / 20) * 20)

/** The bytes of `text` as UTF-8. */
const utf8 = (text: string): number => {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code < 0xdc00) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

export const traffic = (options: TrafficOptions) => {
  const { count, seconds } = options
  const hostClock = HostClock.test()
  const links = MemoryNetworkLink.make({
    peers: count,
    hostClock,
    seed: options.seed ?? 7,
    latencyMS: options.latencyMS ?? 120,
    jitterMS: options.jitterMS ?? 60,
    loss: options.loss ?? 0.05
  })
  if (!links.ok) throw new Error(links.error.field)
  const random = Random.make((options.seed ?? 7) * 31 + count)
  const counted = { messages: 0, bytes: 0, frames: 0, steps: 0 }
  const input = options.input ?? pressed
  /** The most messages one page handed its link in one frame. */
  let mostInAFrame = 0
  let measuring = false
  const halts: Array<string> = []
  const pages = Array.from({ length: count }, (_, seat) => {
    const peer = makePeer({ count, setUp: seat === 0 })
    let sends = 0
    const inner = links.value[seat]!
    const link: NetworkLink.NetworkLink = {
      send: (message) => {
        sends += 1
        if (measuring) {
          counted.messages += 1
          counted.bytes += utf8(message)
        }
        inner.send(message)
      },
      receive: inner.receive,
      status: inner.status
    }
    const session = Netcode.rollback(peer.runtime, { simulate, seats: peer.seats, seat, links: [link], hostClock, step, maxRollback: 16 })
    if (!session.ok) throw new Error(session.error.reason)
    let frame = 0
    const update = session.value.update({ input: () => input(seat, frame), onHalted: (error) => halts.push(`seat ${seat}: ${error._tag}`) })
    let onTick: ((tick: FixedLoop.Tick) => void) | undefined
    const loop = FixedLoop.start({
      source: FixedLoop.source((listener) => {
        onTick = listener
        return { stop: () => {} }
      }),
      step,
      maxFrameSeconds: 0.25,
      maxStepsPerFrame: 5,
      rate: session.value.rate,
      update,
      render: (drawn) => {
        frame += 1
        if (measuring) {
          counted.frames += 1
          counted.steps += drawn.fixedSteps
        }
      },
      onFailure: (failure) => halts.push(`seat ${seat}: ${JSON.stringify(failure)}`)
    })
    if (!loop.ok) throw new Error(loop.error.field)
    const tick = (deltaMS: number): void => {
      const before = sends
      onTick!({ deltaMS })
      mostInAFrame = Math.max(mostInAFrame, sends - before)
    }
    return { session: session.value, runtime: peer.runtime, tick, sent: () => sends, last: 0, next: 0 }
  })
  /** A page's frame time: most at 60 Hz, some long (two or three steps in one frame). */
  const frameMS = (): number => {
    const roll = random.next()
    if (roll < 0.05) return 50
    if (roll < 0.15) return 1000 / 30
    return 1000 / 60 + (random.next() - 0.5) * 4
  }
  const warmUpMS = 2000
  const endMS = warmUpMS + seconds * 1000
  let now = 0
  for (const page of pages) page.next = frameMS()
  while (now < endMS) {
    let soonest = 0
    for (let seat = 1; seat < count; seat++) if (pages[seat]!.next < pages[soonest]!.next) soonest = seat
    const page = pages[soonest]!
    const moved = hostClock.adjust(page.next - now)
    if (!moved.ok) throw new Error("the test clock did not move")
    now = page.next
    measuring = now >= warmUpMS
    page.tick(now - page.last)
    page.last = now
    page.next = now + frameMS()
  }
  return {
    halts,
    pages,
    messagesPerSecond: counted.messages / seconds,
    bytesPerSecond: counted.bytes / seconds,
    framesPerSecond: counted.frames / seconds,
    stepsPerSecond: counted.steps / seconds,
    messages: counted.messages,
    frames: counted.frames,
    mostInAFrame
  }
}
