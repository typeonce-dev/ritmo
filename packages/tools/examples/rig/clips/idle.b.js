/**
 * Idle, draft b: an unarmed fighting stance that bounces, after Ken's
 * stance in Street Fighter (arcade): feet wide, knees bent, fists up in
 * guard, the whole body bobbing on the knees. 16 frames at 24 fps (0.67 s).
 *
 *   0     top      the highest point: legs least bent
 *   1-7   sink     the hips drop 3 px on bending knees, the torso tips forward a touch
 *   8     bottom   the lowest point
 *   9-15  rise     back up; the fists and head arrive a beat after the hips
 *
 * The rig's guard stance puts the sword away and places each fist from its
 * shoulder (a goal on the torso), so the guard rides the bounce; the lead
 * fist pushes out a touch as the body sinks. The punch and the kick start
 * and end on the same stance, this clip's frame 0.
 */
import { fist } from "../hero.js"

/** How far the hips drop at the bottom of the bounce. */
const BOUNCE = 3

export default {
  label: "fighting stance, bouncing (unarmed)",
  frames: 16,
  fps: 24,
  loop: true,
  stance: "guard",
  phases: [
    { name: "top", from: 0, to: 0 },
    { name: "sink", from: 1, to: 7 },
    { name: "bottom", from: 8, to: 8 },
    { name: "rise", from: 9, to: 15 }
  ],
  trail: "handNear",
  pose(rig, t) {
    // 0 at the top of the bounce, 1 at the bottom. A lag is a later start of the same bob, less its value on frame 0, so frame 0 is the stance.
    const sink = (lag) => (Math.cos(-2 * Math.PI * lag) - Math.cos(2 * Math.PI * (t - lag))) / 2
    const lead = sink(0.1)
    const ride = sink(0.08)
    return rig.add(rig.stances.guard, {
      bones: { hips: { x: 0.6 * sink(0), y: -BOUNCE * sink(0) }, torso: -1.5 * sink(0.04), head: 2 * sink(0.12) },
      reach: {
        // The fists ride the shoulder a little late (they sink less), and the lead one pushes out.
        armNear: fist(24 + 2.5 * lead, -4 - lead + 0.8 * ride, 45 - 8 * lead),
        armFar: fist(14 + 2.2 * lead, 8 - 1.4 * lead + 0.8 * ride, 65 - 6 * lead)
      }
    })
  }
}
