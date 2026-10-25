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
    "const shifted = origin + offset.delta"
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
    }
  ]
})
