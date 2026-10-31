/**
 * Attack: a two-handed overhead chop, 26 frames at 24 fps (1.08 s).
 *
 *   0-4   settle         the lead-up: the far hand comes to the grip, the weight sinks and draws back, the torso tips toward the target, the tip dips
 *   5-11  anticipation   rising out of that dip: weight back, both hands over the head, the blade cocked back, slowing into a held extreme
 *   12-14 swing          the hips and torso snap forward first while the blade drops down the back (12), then the arms whip it over (13) and through (14)
 *   15-18 follow-through the blade carries on down past the target, the body over-leans, then settles
 *   19-25 recover        back to the ready stance; the far hand lets go on the way
 *
 * The arm's bones are turns from the setup pose (arm hanging); the blade
 * is aimed by its world angle (0 forward, 90 up, 180 back), which is what
 * the arc is judged by. The far arm is IK: `reach.armFar` puts its hand on
 * the sword's grip, so it follows the sword the near arm swings.
 */
import { GRIP } from "../hero.js"

export default {
  label: "two-handed overhead chop",
  frames: 26,
  fps: 24,
  loop: false,
  stance: "ready",
  params: {
    overshoot: { min: 0, max: 40, value: 22 },
    lean: { min: 10, max: 40, value: 28 }
  },
  phases: [
    { name: "settle", from: 0, to: 4 },
    { name: "anticipation", from: 5, to: 11 },
    { name: "swing", from: 12, to: 14, fast: true },
    { name: "follow", from: 15, to: 18 },
    { name: "recover", from: 19, to: 25 }
  ],
  trail: "sword",
  // The blade, not the grip, is what hits: on the swing's fast frames.
  hit: { from: 6 },
  pose(rig, t, p) {
    const { overshoot, lean } = p
    const ready = rig.stances.ready
    return rig.keys([
      // Frame 0 is the ready stance, one-handed, the blade at 50°: keys start from it.
      // The far hand has the grip, and is drawn over the body from here: a hand on the grip is in front of the torso, never inside it.
      { at: 2, z: { handFar: 25, forearmFar: 24 } },
      // The ready stance has no goal for the far hand, so its reach mixes in from 0 on frame 0 to 1 here.
      { at: 3, reach: { armFar: { ...GRIP, mix: 1 } } },
      // Settle: the weight sinks and draws back, the torso tips toward the target, the eyes on it, the hands push forward and the tip dips (25°).
      { at: 4, rest: true, bones: { hips: { x: -4, y: -11 }, torso: -14, head: 11, upperArmNear: 40, forearmNear: 45 }, aim: { sword: 25 } },
      // Rising out of the dip: weight going back, both hands coming up in front of the face (115°).
      { at: 7.5, bones: { hips: { x: -5, y: -7 }, torso: 2, head: -1, upperArmNear: 118, forearmNear: 50 }, aim: { sword: 115 } },
      // Cocked, and held: torso leaning back, elbows high, hands above and behind the head, blade back (190°).
      { at: 11, rest: true, bones: { hips: { x: -7.5, y: -8.5 }, torso: 12, head: -8, upperArmNear: 198, forearmNear: 30 }, aim: { sword: 190 } },
      // The body leads: hips and torso snap forward, the hands start forward, the blade drops down the back (245°).
      { at: 12, curve: "linear", bones: { hips: { x: -2, y: -7 }, torso: -6, head: 3, upperArmNear: 196, forearmNear: 58 }, aim: { sword: 245 } },
      // The whip: arms over the top, blade swung up past vertical (109°), the smear behind it.
      { at: 13, curve: "linear", slots: { smear: "default" }, bones: { hips: { x: 4, y: -8 }, torso: -18, head: 10, upperArmNear: 158, forearmNear: 4 }, aim: { sword: 109 } },
      // Strike: arms and blade extended forward and a little down (-6°).
      { at: 14, curve: "linear", bones: { hips: { x: 7, y: -10 }, torso: -lean, head: lean * 0.57, upperArmNear: 75 + lean, forearmNear: 4 }, aim: { sword: -6 } },
      // Follow-through: still travelling down, the smear gone.
      { at: 15, curve: "out", slots: { smear: null }, bones: { hips: { x: 8, y: -11 }, torso: -lean - 3, head: lean * 0.64, upperArmNear: 75 + lean - overshoot * 0.55, forearmNear: 4 }, aim: { sword: -8 - overshoot * 0.65 } },
      // Overshoot: the lowest point, body over-leaning.
      { at: 16, rest: true, bones: { hips: { x: 8.5, y: -11.5 }, torso: -lean - 5, head: lean * 0.68, upperArmNear: 75 + lean - overshoot * 0.7, forearmNear: 4 }, aim: { sword: -8 - overshoot * 0.95 } },
      // Settle back a little.
      { at: 18, bones: { hips: { x: 7, y: -10 }, torso: -lean, head: lean * 0.54, upperArmNear: 75 + lean - overshoot * 0.5, forearmNear: 6 }, aim: { sword: -1 - overshoot * 0.5 } },
      // Still two-handed as the sword comes back up, then the far hand lets go and goes back behind the body.
      { at: 22, reach: { armFar: { ...GRIP, mix: 1 } } },
      { at: 24, z: { handFar: 3, forearmFar: 2 } },
      // Ready again.
      { at: 25, ...ready, reach: { ...ready.reach, armFar: { ...GRIP, mix: 0 } } }
    ])
  }
}
