import { FEET } from "../rig/character.mjs"

// Walk: stocky and grounded, short steps, the axe carried at guard.
// References: Richard Williams' heavy walk (The Animator's Survival Kit); a dwarf's march in a side-scroller.
// Key poses per step: contact (frame 0/8: heel down, legs apart, the stance);
// down (2/10: the weight lands, the hips at their lowest, knees bent);
// passing (4/12: the swing foot lifted past the planted one);
// up (6/14: pushing off, the hips at their highest). The torso rocks with each step,
// the head and axe a frame behind the hips.
const N = FEET.near.x // 30: a foot's front spot
const F = FEET.far.x // -26: its back spot
const Y = FEET.near.y // ankle height when flat
const STEP = (N - F) / 8 // planted feet move back this far each frame: travel = STEP * fps
const LIFT = 24

export default {
  label: "heavy march",
  frames: 16,
  fps: 12,
  loop: true,
  stance: "guard",
  travel: STEP * 12,
  contacts: { legNear: [[0, 8]], legFar: [[0, 0], [8, 15]] },
  phases: [
    { name: "near step", from: 0, to: 7 },
    { name: "far step", from: 8, to: 15 }
  ],
  trail: "axe",
  pose(rig) {
    return rig.keys([
      // near foot planted 0-8, moving back at the travel: linear from the stance
      { at: 0, curve: "linear", reach: { legNear: FEET.near } },
      // far foot peels off heel first (toe-off), then swings forward
      { at: 1, reach: { legFar: { x: F + 2, y: Y + 7, angle: -20 } } },
      { at: 2, rest: true, bones: { hips: { y: -12 }, torso: -6 } },
      { at: 3, bones: { head: 2, axe: { x: 10, y: -44 } }, aim: { axe: 54 } },
      { at: 4, reach: { legFar: { x: 2, y: Y + LIFT, angle: -8 } } },
      { at: 6, rest: true, bones: { hips: { y: -2 }, torso: -3 } },
      { at: 7, bones: { head: 5, axe: { x: 16, y: -44 } }, aim: { axe: 56 } },
      { at: 8, reach: { legNear: { x: F, y: Y, angle: 0 } }, bones: { hips: { y: -6 } } },
      { at: 8, curve: "linear", reach: { legFar: { x: N, y: Y, angle: 0 } } },
      // far foot planted 8-15; near foot swings
      { at: 9, reach: { legNear: { x: F + 2, y: Y + 7, angle: -20 } } },
      { at: 10, rest: true, bones: { hips: { y: -12 }, torso: -6 } },
      { at: 11, bones: { head: 2, axe: { x: 10, y: -44 } }, aim: { axe: 54 } },
      { at: 12, reach: { legNear: { x: 2, y: Y + LIFT, angle: -8 } } },
      { at: 14, rest: true, bones: { hips: { y: -2 }, torso: -3 } },
      { at: 15, curve: "linear", bones: { head: 5, hips: { y: -4 }, axe: { x: 16, y: -44 } }, aim: { axe: 56 }, reach: { legNear: { x: N - STEP, y: Y + 3, angle: 4 }, legFar: { x: F + STEP, y: Y, angle: 0 } } }
    ])
  }
}
