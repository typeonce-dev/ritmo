/**
 * Walk: a loop of two steps, in place (the game moves the character at
 * `travel` px/s). Each foot is planted for 60% of the cycle and slides back
 * at exactly the walking speed. IK bends the legs to reach the feet.
 *
 * The legs straighten where a walk straightens them, from the leg's own
 * length rather than by hand:
 * - at heel strike the hips are set at the height where the front leg,
 *   heel down and toe up, is nearly at full reach, so the knee is close to straight;
 * - through down and passing the hips drop and the knees bend to take the weight;
 * - at push-off, once the planted foot is further behind than the leg can
 *   reach, the heel lifts around the toe exactly as much as keeps the leg
 *   straight, so the back leg extends fully and the foot rolls off.
 *
 * The body leans into the walk, the hips and torso rock a couple of degrees
 * with each step, the head stays level, and the arms swing against the legs
 * with the sword swaying a beat behind the hand.
 */
import { ANKLE, LEG } from "../hero.js"

const FRAMES = 24
const FPS = 24
/** The share of the cycle a foot is on the ground. */
const STANCE = 0.6
/** How far a planted foot slides back while it is down. */
const STEP = 50
const LIFT = 9
const HEEL = [-4, -ANKLE]
const TOE = [12, -ANKLE]
/** Nearly the leg's full length (hip to ankle): a straight leg with a soft knee. */
const REACH = (LEG.thigh + LEG.shin) * 0.997
const TOE_UP = 12
/** How far behind the hips the middle of the step is: the body leans ahead of its feet, so the back foot ends far enough behind for the push-off leg to straighten. */
const BEHIND = 3

const smooth = (u) => u * u * (3 - 2 * u)
const inOut = (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2)
const flatX = (phase) => STEP / 2 - BEHIND - (STEP * phase) / STANCE

/** Where the ankle goes so the foot, at `angle`, has its `pivot` point (foot-local) on `ground` (world). */
const pivotOn = (ground, pivot, angle) => {
  const a = (angle * Math.PI) / 180
  return { x: ground[0] - (pivot[0] * Math.cos(a) - pivot[1] * Math.sin(a)), y: ground[1] - (pivot[0] * Math.sin(a) + pivot[1] * Math.cos(a)), angle }
}
const far = (goal, hip) => Math.hypot(goal.x - hip[0], goal.y - hip[1])

/** The heel strike: heel on the ground at the front of the step, toe up. */
const strike = (phase) => pivotOn([flatX(phase) + HEEL[0], 0], HEEL, TOE_UP * (1 - smooth(Math.min(1, phase / 0.08))))
/** The hips' height at heel strike: the front leg at full reach. */
const CONTACT = (() => {
  const goal = strike(0)
  return goal.y + Math.sqrt(REACH * REACH - goal.x * goal.x)
})()

/** The hips' height through half a cycle (one step), from contact: [phase of the step, height]. Smooth and periodic. */
const HIPS = [
  [0, CONTACT],
  [0.2, CONTACT - 1.6], // down: the front knee takes the weight
  [0.5, CONTACT + 2.2], // passing: over the planted foot
  [0.72, CONTACT + 2.6], // up: the planted leg nearly straight under the body
  [1, CONTACT]
]
/** A periodic Catmull-Rom through points spread over [0, 1). */
const cyclic = (points, u) => {
  const n = points.length - 1
  const at = ((u % 1) + 1) % 1
  let i = 0
  while (i < n - 1 && at >= points[i + 1][0]) i++
  const p = (k) => {
    const j = ((k % n) + n) % n
    return [points[j][0] + Math.floor(k / n), points[j][1]]
  }
  const [t0, v0] = p(i - 1)
  const [t1, v1] = p(i)
  const [t2, v2] = p(i + 1)
  const [t3, v3] = p(i + 2)
  const h = t2 - t1
  const m1 = ((v2 - v0) / (t2 - t0)) * h
  const m2 = ((v3 - v1) / (t3 - t1)) * h
  const s = (at - t1) / h
  return (2 * s ** 3 - 3 * s ** 2 + 1) * v1 + (s ** 3 - 2 * s ** 2 + s) * m1 + (-2 * s ** 3 + 3 * s ** 2) * v2 + (s ** 3 - s ** 2) * m2
}
const hipsAt = (t) => cyclic(HIPS, (t * 2) % 1)

/** A foot at `phase` of its own cycle (0 heel strike, STANCE toe-off), with the hip where it is at that moment. */
const foot = (phase, hip) => {
  if (phase < 0.08) return strike(phase)
  if (phase < STANCE) {
    const flat = { x: flatX(phase), y: ANKLE, angle: 0 }
    // A little toe roll at the end of the stance, and more whenever the leg could not reach the flat foot: then the heel lifts just enough to keep the leg straight.
    const keyed = -18 * smooth(Math.max(0, (phase - 0.48) / (STANCE - 0.48)))
    const rolled = (a) => pivotOn([flatX(phase) + TOE[0], 0], TOE, a)
    let angle = keyed
    if (far(flat, hip) > REACH) {
      let lo = -80
      let hi = 0
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2
        if (far(rolled(mid), hip) > REACH) hi = mid
        else lo = mid
      }
      angle = Math.min(keyed, lo)
    }
    return angle === 0 ? flat : rolled(angle)
  }
  // Swing: from toe-off to the next heel strike, lifted; it reaches forward to the strike pose, where the leg is at full reach.
  const s = (phase - STANCE) / (1 - STANCE)
  const from = foot(STANCE - 1e-6, [hip[0], hipsAt(0.1)])
  const to = strike(0)
  return {
    x: from.x + (to.x - from.x) * inOut(s),
    y: from.y + (to.y - from.y) * s + LIFT * Math.sin(Math.PI * s ** 0.8),
    angle: from.angle + (to.angle - from.angle) * smooth(s)
  }
}

/** The frames each foot is flat on the ground (and must slide at `travel`): measured from the feet themselves. */
const flatFrames = (offset) => {
  const spans = []
  for (let f = 0; f < FRAMES; f++) {
    const t = f / FRAMES
    if (foot((t + offset) % 1, [0, hipsAt(t)]).angle !== 0) continue
    const last = spans[spans.length - 1]
    if (last !== undefined && last[1] === f - 1) last[1] = f
    else spans.push([f, f])
  }
  return spans
}

export default {
  label: "walk",
  frames: FRAMES,
  fps: FPS,
  loop: true,
  travel: (STEP / STANCE) * (FPS / FRAMES),
  contacts: { legNear: flatFrames(0), legFar: flatFrames(0.5) },
  phases: [
    { name: "contact", from: 0, to: 1 },
    { name: "down", from: 2, to: 4 },
    { name: "passing", from: 5, to: 7 },
    { name: "up", from: 8, to: 10 },
    { name: "contact", from: 11, to: 13 },
    { name: "down", from: 14, to: 16 },
    { name: "passing", from: 17, to: 19 },
    { name: "up", from: 20, to: 23 }
  ],
  trail: "sword",
  pose(_rig, t) {
    const cycle = (lag) => Math.cos(2 * Math.PI * (t - lag))
    const step = (lag) => Math.cos(4 * Math.PI * (t - lag))
    const hipY = hipsAt(t)
    // The pelvis rocks with the steps; the torso leans into the walk, a little more on each push-off; the head stays level.
    const hipsTurn = 2 * step(0.1)
    const lean = -13 - 1.5 * step(0.375)
    return {
      bones: {
        hips: { y: hipY - 60, r: hipsTurn },
        torso: lean - hipsTurn,
        head: -lean - 1,
        // The far arm swings fully against the near leg; the sword arm less, and the sword sways a beat behind the hand.
        upperArmNear: 8 - 14 * cycle(0),
        forearmNear: 45 - 12 * cycle(0.08),
        sword: -62 + 9 * cycle(0.22),
        upperArmFar: 14 + 25 * cycle(0),
        forearmFar: 34 + 18 * cycle(0.08)
      },
      reach: { legNear: foot(t, [0, hipY]), legFar: foot((t + 0.5) % 1, [0, hipY]) }
    }
  }
}
