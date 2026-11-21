---
"@typeonce/ritmo": minor
---

`FixedLoop`'s `update` gets a second argument, `at: FixedLoop.StepInFrame`: `at.last` is true on the frame's last update (by the accumulator and `maxStepsPerFrame`), for code that acts once per frame after its steps, as a networked session does to send what the frame said in one message. An `update` that takes no arguments is unchanged.

The `ritmo` skill's netcode playbook says that a session sends one message per link per frame and repeats what was lost, so a link sends each message as it is (no outbox or batching of its own), that a game's `update` around `session.update` passes the loop's arguments through, and to measure with `status().sent`.
