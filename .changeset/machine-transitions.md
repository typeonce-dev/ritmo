---
"@typeonce/ritmo": minor
---

State machines take the same transition graph and compare-and-set move as `Descriptor.EntityState`, so both kinds of state are written one way. `Game.StateMachine(name, states, { transitions })` declares, for every state, the states it may move to (`[]` for one with no way out), alone or next to `within`. `nextMachines.x.transition({ from, to, data })` queues the move with all of `to`'s fields only while the machine's committed state is `from`; otherwise it queues nothing and returns a `MachineStateMismatch` failure (`SubStateInactive` for a sub-state whose parent is elsewhere). A `to` the graph does not allow from `from`, an unknown state, and missing or extra fields do not compile. Without a graph any pair of states is accepted. The queued move commits at `applyStateTransitions(...)` like `set`, and only while the machine is still in `from`: a move queued from a transition schedule while the machine is leaving `from` is dropped at the following marker (traced as a `stale` transition, a new `Debug.TransitionEvent` outcome). A machine that declares `transitions` moves only with `transition`: `set` and `setIfChanged` do not compile on it, with an error naming `transition`, so every move it makes is one the graph lists. For a move from whatever state it is in, pass the state read from `machines.x.get()._tag` as `from`: with a union `from`, `to` must be a move every one of them allows. A machine without `transitions` keeps `set` and `setIfChanged` as they were.

```ts
const Round = Game.StateMachine("Game/Round", {
  Lobby: {},
  Playing: z.object({ round: z.int() }),
  Over: z.object({ winner: z.int() })
}, { transitions: { Lobby: ["Playing"], Playing: ["Over"], Over: ["Lobby"] } })
```

```diff
-nextMachines.round.set({ _tag: "Over", winner: 0 })
+nextMachines.round.transition({ from: "Playing", to: "Over", data: { winner: 0 } })
```

Breaking:

- An entity state declared with `transitions` has no `set`, like a machine: move it with `data.x.transition(entity, { from, to, data })`, or change the current state's fields with `update`. `setRaw` stays, for data from outside the simulation. An entity state without `transitions` keeps `set`.
- `nextMachines.x.reset()` is `nextMachines.x.cancelPending()`: it drops the queued value, next to `getPending()`; it never reset the machine.
- `Game.System.transition(M)` is `Game.System.readTransition(M)` (and `System.transition` is `System.readTransition`), like `readTransitionEvent`: it declares read access to the transition being applied, and `transition` now names the move.
- `Machine.MachineStateMismatch` is `Machine.MachineStateMismatchError` and `Machine.SubStateInactive` is `Machine.SubStateInactiveError`, like `EntityStateMismatchError`. The `_tag` values are unchanged.
- `Machine.UpdateResult<M>` is `Machine.CompareAndSetResult<M>`: it is what both `machines.x.update(...)` and `nextMachines.x.transition(...)` return.
- `Descriptor.EntityStateTransitions<States>` is `Descriptor.StateTransitions<States>`: it is the graph of both kinds of state.
- `Machine.StateMachine(...)`, `Machine.read`, `Machine.update`, `Machine.write`, `Machine.transition`, and `Machine.readTransitionEvent` are removed: they duplicated `Game.StateMachine(...)` and `Game.System.machine` / `updateMachine` / `nextState` / `readTransition` / `readTransitionEvent` under other names, and nothing else called them.

```diff
-data.contact.set(entity, { _tag: "air", vy: 2, coyote: 0 })
+data.contact.transition(entity, { from: "ground", to: "air", data: { vy: 2, coyote: 0 } })
-nextMachines.round.reset()
+nextMachines.round.cancelPending()
-transitions: { round: Game.System.transition(Round) }
+transitions: { round: Game.System.readTransition(Round) }
-type Failed = Machine.MachineStateMismatch<"Lobby" | "Playing">
+type Failed = Machine.MachineStateMismatchError<"Lobby" | "Playing">
-type Updated = Machine.UpdateResult<typeof Mode>
+type Updated = Machine.CompareAndSetResult<typeof Mode>
-type Moves = Descriptor.EntityStateTransitions<typeof Contact["states"]>
+type Moves = Descriptor.StateTransitions<typeof Contact["states"]>
```

A `transitions` key that is not a state now fails with a message naming the fix (`this key is not a state: ...`) instead of `not assignable to type 'never'`, for entity states too, and `machines.x.update(...)`'s extra-field error names `nextMachines.x.transition(...)` as the way to move. The `ritmo` skill tells games to declare the graph and move with `transition`.
