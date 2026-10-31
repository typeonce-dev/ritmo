/**
 * Kick: an unarmed high kick with the rear (far) leg, after Ken's high
 * kick in Street Fighter (arcade), 28 frames at 24 fps (1.17 s), from the
 * fighting stance (the rig's `guard`, idle b's frame 0) and back.
 *
 *   0-2   shift     the weight goes forward onto the front foot
 *   3-8   chamber   the back foot pushes off and the knee drives up and forward, above the hip, the shin hanging under it; it flows into the strike without a stop
 *   9-10  strike    the leg snaps out, up and forward to head height, toe pointed; the torso leans back to balance and the standing leg straightens
 *   11-12 impact    held at full reach, a little higher; the near fist covers the head, the far arm reaches forward and down along the leg
 *   13-17 rechamber the knee stays high while the shin folds back under it
 *   18-22 land      the foot comes down and back to its spot behind, toe first, then flat
 *   23-27 settle    the weight goes back between the feet: the stance
 *
 * The front foot stays planted the whole clip. In the air the kicking leg
 * is posed by world angles (`aim`: 0 forward, 90 up, -90 hanging), mixed in
 * over the planted foot's reach on frames 3 to 22. Each fist's goal is a
 * point from its shoulder (`fist`). From the chamber to the landing the
 * near fist is up at head height to cover it, and the far arm opens forward
 * and down with the leg through the strike, folding back in with it.
 */
import { ANKLE, FEET, fist } from "../hero.js"

const planted = { x: FEET.far, y: ANKLE, angle: 0 }

/** The hips on the frames that key them: the body leans over the front foot, rises onto the standing leg for the strike, and comes back. */
const HIPS = {
  2: { x: 7, y: -10 },
  3: { x: 8.5, y: -9.5 }, 4: { x: 10, y: -8.5 }, 5: { x: 10.8, y: -7.6 }, 6: { x: 11.4, y: -6.8 }, 7: { x: 11.8, y: -6 }, 8: { x: 12, y: -5.5 },
  9: { x: 12.5, y: -3.5 }, 10: { x: 13, y: -2.2 }, 11: { x: 13, y: -2 }, 12: { x: 13, y: -2.1 }, 13: { x: 13, y: -2.3 },
  14: { x: 12.8, y: -2.8 }, 15: { x: 12.4, y: -3.8 }, 16: { x: 11.8, y: -5 }, 17: { x: 11, y: -6 }, 18: { x: 10, y: -7 },
  19: { x: 9, y: -7.8 }, 20: { x: 8, y: -8.5 }, 21: { x: 7, y: -9 }, 22: { x: 6, y: -9.5 }, 23: { x: 5.5, y: -10 }
}

/** The kicking leg in the air, by world angles: the thigh, the shin, and the foot. */
const AIR = [
  // Push-off: heel up, the knee starting forward, the shin trailing.
  { at: 3, thigh: -110, shin: -140, foot: -20 },
  { at: 4, thigh: -100, shin: -150, foot: -40 },
  { at: 5, thigh: -80, shin: -150, foot: -50 },
  { at: 6, thigh: -50, shin: -142, foot: -50 },
  { at: 7, thigh: -15, shin: -125, foot: -45 },
  // Chamber: the knee above the hip, the shin hanging under it.
  { at: 8, thigh: 28, shin: -98, foot: -40 },
  // Strike: the shin whips out around the knee, then the leg is straight at 45 degrees, toe pointed.
  { at: 9, thigh: 41, shin: -12, foot: 0, curve: "linear" },
  { at: 10, thigh: 48, shin: 44, foot: 44, curve: "out" },
  { at: 11, thigh: 50, shin: 47, foot: 47, rest: true },
  { at: 12, thigh: 48.5, shin: 45.5, foot: 45, rest: true },
  // Rechamber: the knee stays high while the shin folds back under it.
  { at: 13, thigh: 48, shin: 35, foot: 39 },
  { at: 14, thigh: 45, shin: 19, foot: 24 },
  { at: 15, thigh: 39, shin: -12, foot: 5 },
  { at: 16, thigh: 32, shin: -55, foot: -22 },
  { at: 17, thigh: 22, shin: -95, foot: -38 },
  // Land: the knee drops and the foot swings back to its spot, toe first.
  { at: 18, thigh: 2, shin: -117, foot: -40 },
  { at: 19, thigh: -20, shin: -127, foot: -40 },
  { at: 20, thigh: -58, shin: -136, foot: -32 },
  { at: 21, thigh: -84, shin: -138, foot: -20 },
  { at: 22, thigh: -100, shin: -140, foot: -8 }
]
const leg = (thigh, shin, foot, mix) => ({ thighFar: { angle: thigh, mix }, shinFar: { angle: shin, mix }, footFar: { angle: foot, mix } })
const first = AIR[0]
const last = AIR[AIR.length - 1]
const airKeys = AIR.map((k) => ({ at: k.at, ...(k.curve === undefined ? {} : { curve: k.curve }), ...(k.rest === undefined ? {} : { rest: k.rest }), aim: { thighFar: k.thigh, shinFar: k.shin, footFar: k.foot } }))
// The aim takes over from the planted reach on frame 3 and hands back on 23; resting on both ends, so it is all or nothing between.
const mixKeys = [
  { at: 2, rest: true, aim: leg(first.thigh, first.shin, first.foot, 0) },
  { at: 3, rest: true, aim: { thighFar: { mix: 1 }, shinFar: { mix: 1 }, footFar: { mix: 1 } } },
  { at: 22, rest: true, aim: { thighFar: { mix: 1 }, shinFar: { mix: 1 }, footFar: { mix: 1 } } },
  { at: 23, rest: true, aim: leg(last.thigh, last.shin, last.foot, 0) }
]
const hipsKeys = Object.entries(HIPS).map(([at, hips]) => ({ at: Number(at), bones: { hips }, ...(at === "2" || at === "11" || at === "12" ? { rest: true } : {}) }))

/** A key from the torso and head and each fist's place from its shoulder ([forward, up]) and angle. */
const body = (at, b, extra = {}) => {
  const lead = b.lead ?? [24, -4]
  const rear = b.rear ?? [14, 8]
  return { at, ...extra, bones: { torso: b.torso, head: b.head }, reach: { armNear: fist(lead[0], lead[1], b.leadAngle ?? 45), armFar: fist(rear[0], rear[1], b.rearAngle ?? 65) } }
}

export default {
  label: "high kick, rear leg (unarmed)",
  frames: 28,
  fps: 24,
  loop: false,
  stance: "guard",
  phases: [
    { name: "shift", from: 0, to: 2 },
    { name: "chamber", from: 3, to: 8 },
    { name: "strike", from: 9, to: 10, fast: true },
    { name: "impact", from: 11, to: 12 },
    { name: "rechamber", from: 13, to: 17 },
    { name: "land", from: 18, to: 22 },
    { name: "settle", from: 23, to: 27 }
  ],
  // The front foot never leaves the ground; the back foot is planted until it lifts (after 2) and from when it lands flat (23).
  contacts: { legNear: [[0, 27]], legFar: [[0, 2], [23, 27]] },
  trail: "footFar",
  // The shin and foot hit, through the strike and the held impact.
  hit: { bone: "footFar", frames: [[9, 12]] },
  sockets: { toe: { bone: "footFar", along: 11 } },
  pose(rig) {
    const guard = rig.stances.guard
    return rig.keys([
      // Frame 0 is the guard stance: keys start from it. The body. Shift: hips forward over the front foot, a little lower.
      body(2, { torso: -4, head: 4 }, { rest: true }),
      body(5, { torso: -1, head: 2 }),
      // Chamber: rising onto the standing leg, the torso starting back. The near fist (opposite the kicking leg) rises to a high guard in front of
      // the face; the far arm (the kicking side) starts to open, and is drawn over the body and the kicking thigh while it reaches out.
      body(8, { torso: 7, head: -4, lead: [12, 16], leadAngle: 75, rear: [17, 2], rearAngle: 30 }, { z: { handFar: 25, forearmFar: 24 } }),
      body(9, { torso: 18, head: -13, lead: [8, 18], leadAngle: 85, rear: [30, -10], rearAngle: -15 }, { curve: "linear" }),
      // Full reach: the torso leans back against the leg, the standing leg nearly straight; the near fist covers the head, the far arm reaches forward and down along the leg for balance.
      body(10, { torso: 28, head: -21, lead: [6, 19], leadAngle: 90, rear: [38, -14], rearAngle: -20 }, { curve: "out" }),
      body(11, { torso: 30, head: -22, lead: [6, 19], leadAngle: 90, rear: [38.5, -14.5], rearAngle: -21 }, { rest: true }),
      body(12, { torso: 29.5, head: -21.5, lead: [6, 19], leadAngle: 90, rear: [38, -14], rearAngle: -20 }, { rest: true }),
      // Rechamber and land: the torso comes back upright as the knee folds, the weight goes back; the far arm comes back in, the near fist stays high until the foot comes down.
      body(15, { torso: 18, head: -13, lead: [8, 18], leadAngle: 85, rear: [26, -7], rearAngle: 0 }),
      body(17, { torso: 6, head: -3, lead: [12, 15], leadAngle: 75, rear: [15, 5], rearAngle: 50 }),
      { at: 18, z: { handFar: 3, forearmFar: 2 } },
      body(20, { torso: -2, head: 2 }),
      body(23, { torso: -5, head: 5 }),
      { at: 27, ...guard },
      // The hips, and the kicking leg: planted, in the air by its angles, planted again.
      ...hipsKeys,
      { at: 2, rest: true, reach: { legFar: planted } },
      ...airKeys,
      { at: 23, rest: true, reach: { legFar: planted } },
      ...mixKeys
    ])
  }
}
