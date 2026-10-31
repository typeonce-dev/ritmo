/**
 * Punch: an unarmed straight punch with the lead (near) fist, after Ken's
 * jab and straight in Street Fighter (arcade), 15 frames at 24 fps (0.63 s),
 * from the fighting stance (the rig's `guard`, idle b's frame 0) and back.
 *
 *   0-2   coil     the lead fist draws back a little and drops, the hips sink and the torso rocks back: the load
 *   3-4   strike   the fist shoots out to full reach at shoulder height while the whole body pushes forward: hips 8.5 px, torso leaning in, the lead shoulder driving
 *   5-7   impact   held at full reach, a pixel past it and back: the hit lands
 *   8-14  recover  the fist comes back to the guard, the body settles back to the stance
 *
 * Both feet stay planted. The rear fist tucks tighter to the chin as the
 * lead one goes out. Each fist's goal is a point from its shoulder (`fist`,
 * a goal on the torso), so the fists ride the body.
 */
import { fist } from "../hero.js"

/** A key from the body and each fist's place from its shoulder ([forward, up]). */
const body = (at, b, extra = {}) => ({
  at,
  ...extra,
  bones: { hips: b.hips, torso: b.torso, head: b.head },
  reach: { armNear: fist(b.lead[0], b.lead[1], b.leadAngle), armFar: fist(b.rear[0], b.rear[1], 65) }
})

export default {
  label: "straight punch, lead fist (unarmed)",
  frames: 15,
  fps: 24,
  loop: false,
  stance: "guard",
  phases: [
    { name: "coil", from: 0, to: 2 },
    { name: "strike", from: 3, to: 4, fast: true },
    { name: "impact", from: 5, to: 7 },
    { name: "recover", from: 8, to: 14 }
  ],
  trail: "handNear",
  pose(rig) {
    return rig.keys([
      // Frame 0 is the guard stance: keys start from it. Coil: the fist pulls back toward the cheek and down, the hips sink, the torso rocks back.
      body(2, { hips: { x: -1.5, y: -10.5 }, torso: -5, head: 4, lead: [19, -3], leadAngle: 50, rear: [14, 8] }, { rest: true }),
      // Strike: halfway out, the shoulder already going forward.
      body(3, { hips: { x: 3, y: -10.2 }, torso: -14, head: 12, lead: [31, -1], leadAngle: 15, rear: [12, 9] }, { curve: "linear" }),
      // Full reach at shoulder height: the whole body pushes into it, the hips 8.5 px forward of the stance and the torso leaning 13 degrees further, the lead shoulder driving with the fist.
      body(4, { hips: { x: 8.5, y: -10.6 }, torso: -21, head: 18, lead: [41.3, -1], leadAngle: 0, rear: [10, 10] }, { curve: "out" }),
      // A pixel past and back: the impact.
      body(5, { hips: { x: 9, y: -10.7 }, torso: -22, head: 19, lead: [41.5, -1.5], leadAngle: -2, rear: [10, 10] }, { rest: true }),
      body(7, { hips: { x: 8, y: -10.5 }, torso: -20, head: 17, lead: [40.5, -1.5], leadAngle: 0, rear: [10.5, 10] }, { rest: true }),
      // Recover: the fist comes back first, the body after.
      body(10, { hips: { x: 4, y: -9.8 }, torso: -13, head: 11, lead: [27, -3], leadAngle: 30, rear: [12.5, 9] }),
      { at: 14, ...rig.stances.guard }
    ])
  }
}
