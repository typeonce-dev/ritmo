/**
 * The games embedded in the guide. Each one is served alone at
 * `/play/<id>/` and embedded with `<Game id="..." />`.
 */
export const demos = {
  town: {
    title: "Town",
    description: "Walk a tiny town tile by tile, read the signs, and talk to the villagers, alone or with a friend.",
    controls: "Arrows to walk, Enter to talk. A second player joins on WASD (Space talks, Q leaves) or a gamepad (Ⓐ talks, Ⓑ leaves); face each other and talk.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/town",
    load: () => import("./town/game.ts")
  },
  "top-down": {
    title: "Top-down",
    description: "Walk the rooms and pick up the five parts.",
    controls: "WASD or arrows to walk, E, Space, or a click to pick up. A gamepad works too.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/integration/top-down",
    load: () => import("./top-down/game.ts")
  },
  controls: {
    title: "Controls",
    description: "One ball, moved and dashed with whatever you pick up: keyboard, mouse, gamepad, or touch.",
    controls: "WASD or arrows to move, Space or a click to dash, Esc to pause. Pick up a gamepad, or touch the screen, at any time.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/controls",
    load: () => import("./controls/game.ts")
  },
  rebind: {
    title: "Controls, rebindable",
    description: "The same ball, with a controls panel that rebinds the keyboard and the gamepad.",
    controls: "Open Controls in the corner, click a binding, then press the new key or pad button.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/controls",
    load: () => import("./controls/rebind.ts")
  },
  rollback: {
    title: "Rollback",
    description: "Two peers of one match in one page, joined by a fake network: watch them roll back and agree.",
    controls: "WASD or arrows to move, Space to fire. A bot plays the other seat; pick the latency in the corner.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/rollback",
    load: () => import("./rollback/game.ts")
  },
  netcode: {
    title: "Rollback, playing itself",
    description: "Two bot peers of one match over a fake network whose latency rises: each guesses the other's input, rolls back when the guess was wrong, and agrees on every tick.",
    controls: "Watch the latency rise: outlined ticks ran on a guess, lit ones ran again after a rollback, the green line is the last tick both checksums agree on.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/netcode",
    // Takes no input: starts on its own when scrolled into view.
    autoplay: true,
    load: () => import("./netcode/game.ts")
  },
  fuzz: {
    title: "Fuzzer",
    description: "The fuzzer plays the ball at random until it breaks a planted rule, then shrinks the run to the few frames that still break it.",
    controls: "Watch it search, break the rule, and shrink. Press the button for another seed.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/fuzz",
    // Takes no input: starts on its own when scrolled into view.
    autoplay: true,
    load: () => import("./fuzz/game.ts")
  },
  states: {
    title: "States",
    description: "The same script plays two fighters: one keeps its body in a record and drifts up after a guard, one keeps it in an entity state and cannot.",
    controls: "Watch both jump and land, then the guard: the left fighter rises for good, the right one has no speed on the ground to set.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/states",
    // Takes no input: starts on its own when scrolled into view.
    autoplay: true,
    load: () => import("./states/game.ts")
  },
  composition: {
    title: "Composition",
    description: "One world, three changes of shape: a guard stunned and recovering, a sword put in a hand, an archer dropping a target that fell.",
    controls: "Watch each lane in turn; the components under each entity light up as they arrive and leave.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/composition",
    // Takes no input: starts on its own when scrolled into view.
    autoplay: true,
    load: () => import("./composition/game.ts")
  },
  determinism: {
    title: "Determinism",
    description: "Two copies of a seeded world stay one picture; two copies of a world that calls Math.random() split at the first gust.",
    controls: "Watch the checksums under each pair: the left ones stay equal, the right ones part.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/determinism",
    // Takes no input: starts on its own when scrolled into view.
    autoplay: true,
    load: () => import("./determinism/game.ts")
  },
  replay: {
    title: "Controls, recorded",
    description: "The same ball, recording the last ten seconds as a replay you can open on the spot.",
    controls: "Move and dash for a while, then press Replay in the corner.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/controls",
    load: () => import("./controls/replay.ts")
  },
  why: {
    title: "Headless session",
    description: "A devtools session plays a scripted run of the ball, stops on the frame that breaks a rule, and says why the ball is there.",
    controls: "Watch the trace record each write, the run stop inside the red zone, and why() name the dash that put it there.",
    source: "https://github.com/typeonce-dev/ritmo/tree/main/website/src/demos/why",
    // Takes no input: starts on its own when scrolled into view.
    autoplay: true,
    load: () => import("./why/game.ts")
  }
} as const

export type DemoId = keyof typeof demos

/** What every demo module exports: start in a host element, get back the stop. */
export interface Demo {
  readonly mount: (host: HTMLElement) => Promise<() => void>
}
