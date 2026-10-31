/**
 * Block: the character takes a hit from an opponent in front on its sword,
 * braced, 26 frames at 24 fps (1.08 s), from the ready stance and back.
 *
 *   0-2   read     the head comes up to the threat
 *   3-8   guard    the far hand takes the grip; a cross parry forms in front: elbows down at the ribs, hilt forward and low, blade up and back across the body;
 *                  the back foot steps back 15 px and lands heel first, widening the stance
 *   9-12  brace    the foot flattens and takes the weight: hips back and down over it, both knees bent, head tucked behind the guard; held, still sinking
 *   13-14 impact   the hit: the body is shoved back 6.5 px onto the back foot, the guard driven back into the chest, the blade driven back a few degrees
 *   15-25 recover  a small recoil forward, then the back foot steps forward to the ready stance; the far hand lets go
 *
 * The arm's bones are turns from the setup pose; the blade is aimed by its
 * world angle (0 forward, 90 up). The front foot stays planted; the back
 * foot's path is keyed (`reach.legFar`), resting on the frames it is
 * planted so it does not drift.
 */
import { ANKLE, GRIP } from "../hero.js"

/** Where the back foot lands: 15 px behind its ready spot. */
const BACK = -28
/** The ankle when the heel is down on the ground at `heelX` with the toe up by `angle`: the foot lands heel first. */
const heelDown = (heelX, angle) => {
  const a = (angle * Math.PI) / 180
  return { x: heelX - (-4 * Math.cos(a) + ANKLE * Math.sin(a)), y: -(-4 * Math.sin(a) - ANKLE * Math.cos(a)), angle }
}
const flat = (x) => ({ x, y: ANKLE, angle: 0 })

export default {
  label: "braced two-handed block, back foot steps back",
  frames: 26,
  fps: 24,
  loop: false,
  stance: "ready",
  phases: [
    { name: "read", from: 0, to: 2 },
    { name: "guard", from: 3, to: 8 },
    { name: "brace", from: 9, to: 12 },
    { name: "impact", from: 13, to: 14, fast: true },
    { name: "recover", from: 15, to: 25 }
  ],
  // The front foot never leaves the ground; the back foot is planted except while it steps back (4-8) and forward again (19-22).
  contacts: { legNear: [[0, 25]], legFar: [[0, 3], [9, 18], [23, 25]] },
  trail: "sword",
  pose(rig) {
    const ready = rig.stances.ready
    return rig.keys([
      // Ready, one-handed (50°).
      { at: 0, ...ready, reach: { ...ready.reach, armFar: { ...GRIP, mix: 0 } }, z: { handFar: 3, forearmFar: 2 } },
      // Read: the head comes up to the threat.
      { at: 2, bones: { hips: { x: -1, y: -4 }, torso: -3, head: 7, upperArmNear: 33, forearmNear: 55 }, aim: { sword: 53 } },
      // The far hand comes to the grip, in front of the body while it holds; and the back foot, planted, starts its step.
      { at: 3, rest: true, z: { handFar: 25, forearmFar: 24 }, reach: { legFar: flat(-13) } },
      { at: 4, reach: { armFar: { ...GRIP, mix: 1 } } },
      // The back foot lifts, travels back, lands heel first, flattens.
      { at: 5, reach: { legFar: { x: -18, y: 10, angle: -8 } } },
      { at: 7, reach: { legFar: { x: BACK + 2, y: 10, angle: 8 } } },
      { at: 8, curve: "linear", reach: { legFar: heelDown(BACK - 4, 12) } },
      { at: 9, rest: true, reach: { legFar: flat(BACK) } },
      { at: 18, rest: true, reach: { legFar: flat(BACK) } },
      // ...and steps forward again to the ready stance on the way out.
      { at: 20, reach: { legFar: { x: -21, y: 10, angle: -6 } } },
      { at: 22, curve: "linear", reach: { legFar: heelDown(-17, 10) } },
      { at: 23, rest: true, reach: { legFar: flat(-13) } },

      // The guard comes together in front of the chest as the foot steps back (90°).
      { at: 5, bones: { hips: { x: -4, y: -7 }, torso: -6, head: 8, upperArmNear: 26, forearmNear: 95 }, aim: { sword: 90 } },
      // Guard, a cross parry: elbows down at the ribs, forearms forward, hands low in front of the chest, hilt forward and low,
      // the blade crossing up and back toward the head and rear shoulder (124°), so a blow from the front slides down and off it: blade and torso make an X.
      { at: 8, bones: { hips: { x: -7, y: -9 }, torso: -8, head: 6, upperArmNear: 18, forearmNear: 105 }, aim: { sword: 124 } },
      // Brace: the weight goes onto the planted back foot: hips back and down between the feet, nearer the back one; head tucked behind the blade (126°).
      { at: 10, rest: true, bones: { hips: { x: -11, y: -12 }, torso: -9, head: 4, upperArmNear: 19, forearmNear: 105 }, aim: { sword: 126 } },
      // Held, still sinking a little, so it does not freeze.
      { at: 12, curve: "linear", bones: { hips: { x: -11.5, y: -12.6 }, torso: -9.5, head: 4, upperArmNear: 19.5, forearmNear: 106 }, aim: { sword: 127 } },
      // Impact: shoved back 6 px onto the back foot, torso knocked upright, elbows driven back and the guard into the chest, the blade driven back a few degrees more (131°, 134°), not up.
      { at: 13, curve: "linear", bones: { hips: { x: -17, y: -13 }, torso: -2, head: 6, upperArmNear: 6, forearmNear: 115 }, aim: { sword: 131 } },
      { at: 14, curve: "out", bones: { hips: { x: -18, y: -13 }, torso: -1, head: 6, upperArmNear: 4, forearmNear: 118 }, aim: { sword: 134 } },
      // Recoil: springing back forward past the brace (122°).
      { at: 16, rest: true, bones: { hips: { x: -9.5, y: -11.5 }, torso: -11, head: 5, upperArmNear: 21, forearmNear: 103 }, aim: { sword: 122 } },
      // Settle into the brace again.
      { at: 18, bones: { hips: { x: -11, y: -11 }, torso: -9, head: 5, upperArmNear: 19, forearmNear: 105 }, aim: { sword: 125 } },
      // Recover: the body comes forward over the front foot as the back foot steps up; the guard opens back to ready.
      { at: 21, bones: { hips: { x: -5, y: -8 }, torso: -7, head: 6, upperArmNear: 24, forearmNear: 98 }, aim: { sword: 95 } },
      { at: 22, reach: { armFar: { ...GRIP, mix: 1 } } },
      { at: 24, z: { handFar: 3, forearmFar: 2 } },
      { at: 25, ...ready, reach: { ...ready.reach, armFar: { ...GRIP, mix: 0 } } }
    ])
  }
}
