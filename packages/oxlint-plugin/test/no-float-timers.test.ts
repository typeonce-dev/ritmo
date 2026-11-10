import plugin from "@typeonce/oxlint-plugin-ritmo"
import { tester } from "./tester.ts"

const rule = plugin.rules["no-float-timers"]!

tester.run("no-float-timers", rule, {
  valid: [
    // Integration: dt scales a rate.
    "position.x += velocity.x * dt",
    "const nextX = resolveHorizontalMovement(position, velocity.x * dt, collider, walls)",
    "data.position.update((at) => ({ x: at.x + at.vx * time.dt, y: at.y + at.vy * time.dt }))",
    "const delta = Vec2.scale(velocity, services.frame.dt)",
    "const moved = move(at, Vec2.scale(way, speed * services.frame.dt))",
    "const damped = v * (1 - dt)",
    // Deadlines in steps.
    "if (Clock.reached(time, ready)) data.weapon.set({ ready: Clock.deadline(time, cooldown) })",
    "resources.clock.update((time) => ({ step: time.step + 1, hz: time.hz, dt: 1 / time.hz }))",
    // A cooldown counted in whole steps is exact.
    "if (player.cooldown > 0) data.player.set({ ...player, cooldown: player.cooldown - 1 })",
    // Pointer and other deltas that are not time.
    "pending[axis] += delta",
    "const shifted = origin + offset.delta",
    "position.x -= pointer.delta",
    // A step's seconds used without counting anything: a look-ahead, a test.
    "const until = horizon + dt",
    "if (accumulator - dt >= 0) drain()",
    "const predicted = predict(body, horizon + time.dt)",
    "spawn({ at: start + dt })",
    // A whole count, or a fraction that is not one second's.
    "health -= 1 / 2 + bonus",
    "charges -= 1"
  ],
  invalid: [
    {
      // A dash cooldown in seconds, as games write it.
      code: "let cooldown = Math.max(0, state.cooldown - dt)\nif (input.actions.dash.pressed && cooldown <= 0) cooldown = DASH_COOLDOWN",
      errors: [{ messageId: "floatTimer", data: { text: "state.cooldown - dt" } }]
    },
    {
      code: "const dt = resources.deltaTime.get()\ntimer.remaining -= dt\nif (timer.remaining <= 0) spawnWave()",
      errors: [{ messageId: "floatTimer", data: { text: "timer.remaining -= dt" } }]
    },
    {
      code: "x.cooldown = x.cooldown - time.dt",
      errors: [{ messageId: "floatTimer", data: { text: "x.cooldown - time.dt" } }]
    },
    {
      code: "data.buff.update((buff) => ({ ...buff, left: buff.left - resources.deltaTime.get() }))",
      errors: [{ messageId: "floatTimer", data: { text: "buff.left - resources.deltaTime.get()" } }]
    },
    {
      code: "elapsed += time.dt",
      errors: [{ messageId: "floatTimer", data: { text: "elapsed += time.dt" } }]
    },
    {
      code: "const since = time.dt + dash.since",
      errors: [{ messageId: "floatTimer", data: { text: "time.dt + dash.since" } }]
    },
    {
      code: "invulnerable.seconds -= (deltaSeconds as number)",
      errors: [{ messageId: "floatTimer", data: { text: "invulnerable.seconds -= (deltaSeconds as number)" } }]
    },
    // A step's length under other names and shapes.
    { code: "x -= delta", errors: [{ messageId: "floatTimer", data: { text: "x -= delta" } }] },
    { code: "x -= time.delta", errors: [{ messageId: "floatTimer", data: { text: "x -= time.delta" } }] },
    { code: "elapsed += clock.delta", errors: [{ messageId: "floatTimer", data: { text: "elapsed += clock.delta" } }] },
    { code: "x -= 1 / 60", errors: [{ messageId: "floatTimer", data: { text: "x -= 1 / 60" } }] },
    { code: "x -= STEP_SECONDS", errors: [{ messageId: "floatTimer", data: { text: "x -= STEP_SECONDS" } }] },
    { code: "x -= FIXED_STEP_SECONDS", errors: [{ messageId: "floatTimer", data: { text: "x -= FIXED_STEP_SECONDS" } }] },
    { code: "x -= fixedDt", errors: [{ messageId: "floatTimer", data: { text: "x -= fixedDt" } }] },
    { code: "x -= dtSeconds", errors: [{ messageId: "floatTimer", data: { text: "x -= dtSeconds" } }] },
    { code: "x -= dt * 1", errors: [{ messageId: "floatTimer", data: { text: "x -= dt * 1" } }] },
    { code: "elapsedMs += dt * 1000", errors: [{ messageId: "floatTimer", data: { text: "elapsedMs += dt * 1000" } }] },
    { code: "x -= Math.min(dt, 0.1)", errors: [{ messageId: "floatTimer", data: { text: "x -= Math.min(dt, 0.1)" } }] },
    { code: "x = x - step.seconds", errors: [{ messageId: "floatTimer", data: { text: "x - step.seconds" } }] },
    {
      // A const that holds a step's length is one.
      code: "const tick = frame.dt\nwindow.remaining -= tick",
      errors: [{ messageId: "floatTimer", data: { text: "window.remaining -= tick" } }]
    },
    {
      // Stored back through the slot it was read from.
      code: "resources.timer.set(Math.max(0, timer - dt))",
      errors: [{ messageId: "floatTimer", data: { text: "timer - dt" } }]
    },
    {
      code: "resources.timer.update((left) => left - dt)",
      errors: [{ messageId: "floatTimer", data: { text: "left - dt" } }]
    },
    {
      code: "const remaining = timer.remaining > 0 ? timer.remaining - dt : 0",
      errors: [{ messageId: "floatTimer", data: { text: "timer.remaining - dt" } }]
    }
  ]
})
