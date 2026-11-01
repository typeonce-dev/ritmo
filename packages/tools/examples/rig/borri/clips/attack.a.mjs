// Attack: a two-handed overhead axe chop from guard and back.
// References: a lumberjack splitting a round; Gimli's overhead chop; a Dark Souls greataxe heavy attack.
// Key poses: settle (the weight sinks back, the axe dips forward and down);
// cocked (hands above the head, the axe laid back behind it, torso leaning back, held);
// strike (the hips drive forward first, then the torso pitches, then the arms whip the axe down);
// impact (the axe head low in front, knees bent, torso folded);
// follow-through (the axe carries a little past and the torso folds further, then settles);
// recover (rises back to guard).
export default {
  label: "overhead chop",
  frames: 30,
  fps: 24,
  loop: false,
  stance: "guard",
  phases: [
    { name: "settle", from: 0, to: 5 },
    { name: "wind-up", from: 6, to: 15 },
    { name: "chop", from: 16, to: 19, fast: true },
    { name: "follow-through", from: 20, to: 23 },
    { name: "recover", from: 24, to: 29 }
  ],
  trail: "axe",
  hit: { from: 140, radius: 24 },
  pose(rig, t, p) {
    const guard = rig.stances.guard
    return rig.keys([
      // settle: sink and draw back, axe dips
      { at: 5, rest: true, bones: { hips: { x: -5, y: -14 }, torso: -8, head: 2, axe: { x: 8, y: -40 } }, aim: { axe: 30 } },
      // the raise arcs up in front, arms long, before folding back over the head
      { at: 9, bones: { hips: { x: -7, y: -8 }, torso: 2, head: 5, axe: { x: 118, y: -46 } }, aim: { axe: 105 } },
      // cocked: hands overhead, axe laid back
      { at: 13, rest: true, bones: { hips: { x: -8, y: -4 }, torso: 10, head: 6, axe: { x: 150, y: 6 } }, aim: { axe: 168 } },
      { at: 15, rest: true, bones: { hips: { x: -7, y: -4 }, torso: 11, head: 6, axe: { x: 154, y: 8 } }, aim: { axe: 172 } },
      // strike: hips lead
      { at: 16, bones: { hips: { x: 2, y: -6 }, torso: 6, axe: { x: 150, y: -6 } }, aim: { axe: 150 } },
      { at: 17, curve: "linear", slots: { smear: "default" }, bones: { hips: { x: 8, y: -10 }, torso: -6, head: 2, axe: { x: 136, y: -40 } }, aim: { axe: 105 } },
      { at: 18, curve: "linear", bones: { hips: { x: 10, y: -14 }, torso: -18, axe: { x: 96, y: -66 } }, aim: { axe: 40 } },
      // impact
      { at: 19, bones: { hips: { x: 11, y: -17 }, torso: -26, head: -4, axe: { x: 50, y: -60 } }, aim: { axe: -18 } },
      // follow-through: carries past, then settles
      { at: 20, slots: { smear: null } },
      { at: 21, rest: true, bones: { hips: { x: 12, y: -19 }, torso: -30, head: -6, axe: { x: 46, y: -58 } }, aim: { axe: -21 } },
      { at: 24, bones: { hips: { x: 8, y: -14 }, torso: -18, head: 0, axe: { x: 30, y: -60 } }, aim: { axe: 5 } },
      // recover
      { at: 29, ...guard }
    ])
  }
}
