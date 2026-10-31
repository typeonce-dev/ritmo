/**
 * Attack, draft b: the same two-handed overhead chop with no settling dip
 * before the raise, a longer held wind-up, and a heavier follow-through,
 * 24 frames at 24 fps (1 s).
 *
 *   0-7   anticipation   as draft a, but the cocked pose holds for two frames, still sinking
 *   8-10  swing          drag (8), whip over (9), strike (10)
 *   11-16 follow-through the blade carries on much further down (to `overshoot`), the body folds forward (`fold`), then settles
 *   17-23 recover        back to the ready stance
 */
import { GRIP } from "../hero.js"

export default {
  label: "two-handed chop, no dip, heavy follow-through",
  frames: 24,
  fps: 24,
  loop: false,
  stance: "ready",
  params: {
    overshoot: { min: 0, max: 45, value: 30 },
    fold: { min: 0, max: 20, value: 10 }
  },
  phases: [
    { name: "anticipation", from: 0, to: 7 },
    { name: "swing", from: 8, to: 10, fast: true },
    { name: "follow", from: 11, to: 16 },
    { name: "recover", from: 17, to: 23 }
  ],
  trail: "sword",
  hit: { from: 6 },
  pose(rig, t, p) {
    const { overshoot, fold } = p
    const ready = rig.stances.ready
    return rig.keys([
      // From the ready stance (frame 0), two-handed like draft a, but with no settling dip first: the far hand takes the grip as the sword rises.
      { at: 1, z: { handFar: 25, forearmFar: 24 } },
      { at: 2, reach: { armFar: { ...GRIP, mix: 1 } } },
      { at: 3, bones: { hips: { x: -4, y: -6 }, torso: 2, head: -1, upperArmNear: 118, forearmNear: 50 }, aim: { sword: 115 } },
      // Cocked (187°), then a moving hold: two frames of sinking a little further.
      { at: 5, bones: { hips: { x: -7, y: -8 }, torso: 11, head: -7, upperArmNear: 196, forearmNear: 30 }, aim: { sword: 187 } },
      { at: 7, rest: true, bones: { hips: { x: -8.5, y: -9.5 }, torso: 14, head: -9, upperArmNear: 201, forearmNear: 32 }, aim: { sword: 195 } },
      { at: 8, curve: "linear", bones: { hips: { x: -2, y: -7 }, torso: -6, head: 3, upperArmNear: 196, forearmNear: 58 }, aim: { sword: 245 } },
      { at: 9, curve: "linear", slots: { smear: "default" }, bones: { hips: { x: 4, y: -8 }, torso: -18, head: 10, upperArmNear: 158, forearmNear: 4 }, aim: { sword: 109 } },
      { at: 10, curve: "linear", bones: { hips: { x: 7, y: -10 }, torso: -28, head: 16, upperArmNear: 103, forearmNear: 4 }, aim: { sword: -6 } },
      // Follow-through: the arm keeps falling for three frames, the body folds over the front knee.
      { at: 11, curve: "out", slots: { smear: null }, bones: { hips: { x: 9, y: -11.5 }, torso: -28 - fold * 0.5, head: 18, upperArmNear: 103 - overshoot * 0.5, forearmNear: 3 }, aim: { sword: -8 - fold * 0.5 - overshoot * 0.5 } },
      { at: 13, rest: true, bones: { hips: { x: 10, y: -13 }, torso: -28 - fold, head: 21, upperArmNear: 103 - overshoot, forearmNear: 3 }, aim: { sword: -10 - fold - overshoot } },
      { at: 16, bones: { hips: { x: 7, y: -10 }, torso: -26, head: 15, upperArmNear: 90 - overshoot * 0.3, forearmNear: 6 }, aim: { sword: -12 - overshoot * 0.3 } },
      { at: 20, reach: { armFar: { ...GRIP, mix: 1 } } },
      { at: 22, z: { handFar: 3, forearmFar: 2 } },
      { at: 23, ...ready, reach: { ...ready.reach, armFar: { ...GRIP, mix: 0 } } }
    ])
  }
}
