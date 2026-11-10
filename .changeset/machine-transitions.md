---
"@typeonce/ritmo": minor
---

State machines take the same transition graph and compare-and-set move as `Descriptor.EntityState`, so both kinds of state are written one way. `Game.StateMachine(name, states, { transitions })` declares, for every state, the states it may move to (`[]` for one with no way out), alone or next to `within`. `nextMachines.x.transition({ from, to, data })` queues the move with all of `to`'s fields only while the machine's committed state is `from`; otherwise it queues nothing and returns a `MachineStateMismatch` failure (`SubStateInactive` for a sub-state whose parent is elsewhere). A `to` the graph does not allow from `from`, an unknown state, and missing or extra fields do not compile. Without a graph any pair of states is accepted. The queued move commits at `applyStateTransitions(...)` like `set`, and only while the machine is still in `from`: a move queued from a transition schedule while the machine is leaving `from` is dropped at the following marker (traced as a `stale` transition, a new `Debug.TransitionEvent` outcome). `set` stays, unchecked, for resets and values a pure function computed.

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

Breaking, for code that names these types or calls the low-level constructor:

- `Machine.UpdateResult<M>` is `Machine.CompareAndSetResult<M>`: it is what both `machines.x.update(...)` and `nextMachines.x.transition(...)` return.
- `Descriptor.EntityStateTransitions<States>` is `Descriptor.StateTransitions<States>`: it is the graph of both kinds of state.
- `Machine.StateMachine(name, states, within)` takes an options object: `Machine.StateMachine(name, states, { within, transitions })`. Games declare machines with `Game.StateMachine(...)`, which is unchanged for code without a graph.

```diff
-type Updated = Machine.UpdateResult<typeof Mode>
+type Updated = Machine.CompareAndSetResult<typeof Mode>
-type Moves = Descriptor.EntityStateTransitions<typeof Contact["states"]>
+type Moves = Descriptor.StateTransitions<typeof Contact["states"]>
```

A `transitions` key that is not a state now fails with a message naming the fix (`this key is not a state: ...`) instead of `not assignable to type 'never'`, for entity states too, and `machines.x.update(...)`'s extra-field error names `nextMachines.x.transition(...)` as the way to move. The `ritmo` skill tells games to declare the graph and move with `transition`.
