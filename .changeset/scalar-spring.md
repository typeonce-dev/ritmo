---
"@typeonce/ritmo-math": minor
"@typeonce/ritmo": patch
---

`Scalar.spring(current, target, { frequencyHz, dampingRatio }, dt)` moves a damped spring toward a target: a value with momentum that overshoots and wobbles back, for squash and stretch, a wobble, or a pop. Its state is a `Scalar.Spring` record (`{ value, velocity }`) that passes straight back in. The motion is computed exactly, so it is the same at any step rate and a long frame cannot make it blow up. A vector springs one axis at a time.

`Collide2.moveCircle` and `MoveResult.blocked` now say that `blocked` does not tell which wall was touched or whether the circle stands on one, with an example of a grounded check that probes with `sweepCircle`.

The `ritmo` skill's rendering playbook now says that a part that is not an entity (a procedural limb, a trail) is render state, and that cosmetic randomness uses its own `Random.make` stream, never the world's random resource.
