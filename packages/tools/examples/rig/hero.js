/**
 * A swordsman seen from the side, facing right (+x), about 128 px tall.
 *
 * Bones point along their limb; positive turns are counter-clockwise on
 * screen. For this right-facing character that means: arms and legs that
 * hang down swing forward on a positive turn, the torso leans back on a
 * positive turn, and a knee bends with a negative turn of the shin. World
 * angles (`aim`) are 0 forward, 90 up, 180 back, -90 down.
 *
 * "Near" is the side facing the viewer (the sword side, drawn in front);
 * "far" is the other side, drawn behind and darker. The sword is a prop: a
 * clip puts it away with `props: { sword: null }`.
 */

/** How high the ankle sits above the sole of a flat foot. */
export const ANKLE = 4
/** The legs' bones, for clips that work out a stride from them. */
export const LEG = { thigh: 29, shin: 27 }
/** The far hand on the sword's grip, below the near hand: `{ ...GRIP, mix }` in a pose's `reach.armFar`. */
export const GRIP = { bone: "sword", along: -9, across: 3.5, turn: -90 }
/** Where a fist goes from its shoulder (a point on the torso), `dx` forward and `dy` up, at a world angle: the arms of the unarmed moves. */
export const fist = (dx, dy, angle) => ({ bone: "torso", along: 35, dx, dy, angle })
/** Where the feet stand in the unarmed fighting stance: wide, the near (lead) foot forward. */
export const FEET = { near: 23, far: -22 }

const C = {
  skin: "#f1c09a",
  hair: "#3d2b45",
  tunic: "#3f7fb8",
  belt: "#5c3b27",
  pants: "#4b4f6e",
  boot: "#6e4b3a",
  blade: "#dde6ee",
  edge: "#9fb2c4",
  guard: "#e0a63a",
  grip: "#5b3a29",
  smear: "#e9f6ffa6"
}

/** The far side: darker and a little cooler, so it reads as behind. */
const far = (color) => {
  const n = (i) => parseInt(color.slice(i, i + 2), 16)
  const ch = (v, k) => Math.round(Math.min(255, v * k)).toString(16).padStart(2, "0")
  return `#${ch(n(1), 0.62)}${ch(n(3), 0.66)}${ch(n(5), 0.78)}`
}

/** A foot around its ankle (the foot bone's start): heel back, toe forward, sole on the ground. */
const foot = { kind: "poly", round: 1, points: [[-3.5, 1 - ANKLE], [11.5, 1 - ANKLE], [12, 1.5 - ANKLE], [7, 4.5 - ANKLE], [2.5, 6], [-3, 6]].map(([dx, dy]) => ({ dx, dy })) }
const circle = (along, r) => ({ kind: "ellipse", c: { along }, rx: r })

export default {
  size: [264, 212],
  anchor: [118, 194],
  outline: "#16121d",
  line: 1.6,
  look: { background: "#232838", ground: "#59627e", floor: "#1b1f2b" },
  back: "torso",
  // The setup pose: standing straight, arms hanging, the sword pointing forward.
  bones: {
    hips: { y: 60, rotation: 90, length: 8 },
    torso: { parent: "hips", length: 38 },
    head: { parent: "torso", x: 40, length: 24 },
    upperArmNear: { parent: "torso", x: 35, rotation: 180, length: 22 },
    forearmNear: { parent: "upperArmNear", x: 22, length: 20 },
    handNear: { parent: "forearmNear", x: 20, length: 6 },
    sword: { parent: "handNear", x: 4, rotation: 90, length: 64 },
    upperArmFar: { parent: "torso", x: 35, rotation: 180, length: 22 },
    forearmFar: { parent: "upperArmFar", x: 22, length: 20 },
    handFar: { parent: "forearmFar", x: 20, length: 6 },
    thighNear: { parent: "hips", rotation: 180, length: LEG.thigh },
    shinNear: { parent: "thighNear", x: LEG.thigh, length: LEG.shin },
    footNear: { parent: "shinNear", x: LEG.shin, rotation: 90, length: 11 },
    thighFar: { parent: "hips", rotation: 180, length: LEG.thigh },
    shinFar: { parent: "thighFar", x: LEG.thigh, length: LEG.shin },
    footFar: { parent: "shinFar", x: LEG.shin, rotation: 90, length: 11 }
  },
  // Back to front. Limbs are capsules along their bone; the body is drawn in the setup pose's world coordinates.
  parts: {
    upperArmFar: { bone: "upperArmFar", far: true, z: 1, fill: far(C.tunic), shape: { kind: "capsule", r: 4.4, r2: 3.6 } },
    forearmFar: { bone: "forearmFar", far: true, z: 2, fill: far(C.skin), shape: { kind: "capsule", r: 3.3, r2: 2.8 } },
    handFar: { bone: "handFar", far: true, z: 3, fill: far(C.skin), shape: circle(2.5, 3.6) },
    thighFar: { bone: "thighFar", far: true, z: 4, fill: far(C.pants), shape: { kind: "capsule", r: 5.6, r2: 4.4 } },
    shinFar: { bone: "shinFar", far: true, z: 5, fill: far(C.boot), shape: { kind: "capsule", r: 4.3, r2: 3.4 } },
    footFar: { bone: "footFar", far: true, z: 6, fill: far(C.boot), shape: foot },

    hips: { bone: "hips", z: 10, fill: C.pants, shape: { kind: "ellipse", c: [0, 59], rx: 9.5, ry: 7 } },
    torso: { bone: "torso", z: 11, fill: C.tunic, shape: { kind: "poly", round: 2.5, points: [[-7, 56], [7, 56], [9.5, 76], [8.5, 92], [3, 96], [-5, 96], [-8.5, 90], [-8, 72]] } },
    neck: { bone: "torso", z: 11.2, fill: C.skin, shape: { kind: "capsule", a: [0.5, 95], b: [1.5, 102], r: 3.4 } },
    belt: { bone: "hips", z: 11.5, fill: C.belt, shape: { kind: "poly", round: 0.8, points: [[-9, 60], [9.5, 60], [9.5, 64], [-9, 64]] } },
    head: { bone: "head", z: 12, fill: C.skin, shape: { kind: "ellipse", c: [2, 111], rx: 9.5, ry: 11 } },
    nose: { bone: "head", z: 12.1, fill: C.skin, shape: { kind: "poly", round: 0.6, points: [[10, 113], [13.2, 109.5], [10, 108]] } },
    hair: { bone: "head", z: 12.2, fill: C.hair, shape: { kind: "poly", round: 1.5, points: [[-9, 103], [-10.5, 111], [-8, 119], [-1, 123.5], [7, 122], [11, 116.5], [5, 117.5], [1, 115], [-2, 110], [-4.5, 104]] } },
    ear: { bone: "head", z: 12.3, fill: C.skin, shape: { kind: "ellipse", c: [-0.5, 109.5], rx: 2.2, ry: 2.8 } },
    eye: { bone: "head", z: 12.4, fill: "#1b1626", outline: null, shape: { kind: "ellipse", c: [7, 112], rx: 1.1, ry: 1.7 } },

    thighNear: { bone: "thighNear", z: 20, fill: C.pants, shape: { kind: "capsule", r: 5.8, r2: 4.6 } },
    shinNear: { bone: "shinNear", z: 21, fill: C.boot, shape: { kind: "capsule", r: 4.5, r2: 3.5 } },
    footNear: { bone: "footNear", z: 22, fill: C.boot, shape: foot },

    // The smear: the area the blade swept over the last frame, shown only on swing frames (`slots: { smear: "default" }`).
    smear: { bone: "sword", z: 29, fill: C.smear, outline: null, hidden: true, shape: { kind: "sweep", from: 14, to: 64, frames: 1 } },
    upperArmNear: { bone: "upperArmNear", z: 30, fill: C.tunic, shape: { kind: "capsule", r: 4.6, r2: 3.8 } },
    forearmNear: { bone: "forearmNear", z: 31, fill: C.skin, shape: { kind: "capsule", r: 3.5, r2: 3 } },
    // A hand-and-a-half grip: room for the far hand below the near one. The sword bone starts in the near fist and points along the blade.
    pommel: { bone: "sword", z: 32, fill: C.guard, shape: circle(-15, 2.4) },
    grip: { bone: "sword", z: 33, fill: C.grip, shape: { kind: "capsule", a: { along: -13 }, b: { along: 4 }, r: 1.7 } },
    blade: { bone: "sword", z: 34, fill: C.blade, shape: { kind: "poly", round: 0.4, points: [[6, -2.6], [55, -2.6], [64, 0], [55, 2.6], [6, 2.6]].map(([along, across]) => ({ along, across })) } },
    fuller: { bone: "sword", z: 34.5, fill: C.edge, outline: null, shape: { kind: "capsule", a: { along: 9 }, b: { along: 48 }, r: 0.6 } },
    guard: { bone: "sword", z: 35, fill: C.guard, shape: { kind: "capsule", a: { along: 5.5, across: -7 }, b: { along: 5.5, across: 7 }, r: 1.8 } },
    handNear: { bone: "handNear", z: 36, fill: C.skin, shape: circle(3, 3.8) }
  },
  chains: {
    legNear: { upper: "thighNear", lower: "shinNear", end: "footNear", bend: 1, foot: true },
    legFar: { upper: "thighFar", lower: "shinFar", end: "footFar", bend: 1, foot: true },
    // The far hand taking the sword's grip (a goal on the sword bone), or a fist; the elbow points down and out.
    armFar: { upper: "upperArmFar", lower: "forearmFar", end: "handFar", bend: -1 },
    // The sword arm is turned by hand with the sword; the chain names its elbow so the checks measure it, and places the fists of the unarmed moves.
    armNear: { upper: "upperArmNear", lower: "forearmNear", end: "handNear", bend: -1 }
  },
  props: { sword: ["smear", "pommel", "grip", "blade", "fuller", "guard"] },
  // Points the bake reports on every frame they show, for the game to place things on: a swapped weapon's handle, a spark at the tip, an effect on the fist.
  sockets: {
    grip: { bone: "sword" },
    tip: { bone: "sword", along: 64 },
    fist: { bone: "handNear", along: 3 }
  },
  stances: {
    // The armed stance: near foot forward, weight low, sword up in front at 50°. Idle breathes on it; the attacks and the block start and end on it.
    ready: {
      bones: { hips: { x: -1, y: -5 }, torso: -6, head: 5, upperArmNear: 31, forearmNear: 55, upperArmFar: 22, forearmFar: 62 },
      aim: { sword: 50 },
      reach: { legNear: { x: 15, y: ANKLE }, legFar: { x: -13, y: ANKLE } }
    },
    // The unarmed fighting stance: feet wide, knees bent, fists up in guard, the sword put away. Idle b bounces on it; the punch and the kick start and end on it.
    guard: {
      bones: { hips: { x: 0, y: -9 }, torso: -8, head: 6 },
      props: { sword: null },
      reach: {
        legNear: { x: FEET.near, y: ANKLE, angle: 0 },
        legFar: { x: FEET.far, y: ANKLE, angle: 0 },
        armNear: fist(24, -4, 45),
        armFar: fist(14, 8, 65)
      }
    }
  }
}
