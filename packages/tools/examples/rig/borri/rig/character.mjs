// Borri the dwarf, from the painted parts sheet (rig init --from, then corrected).
// Side view facing right (+x), y up, the origin on the ground under him; 1 world unit = 1 sheet pixel.
// The axe is its own bone on the torso, declared before the arms, so both hands reach onto its haft.

// The two hands on the haft, wrist points on the axe bone: the near hand on the leather wraps (the bone start),
// the far hand below it toward the pommel. `across` puts the fist (not the wrist) on the haft.
export const GRIP_NEAR = { bone: "axe", along: 0, across: 12, turn: -90 }
export const GRIP_FAR = { bone: "axe", along: -24, across: 12, turn: -90 }
// Where the feet stand: a wide, low dwarf base.
export const FEET = { near: { x: 30, y: 21, angle: 0 }, far: { x: -26, y: 21, angle: 0 } }

// Guard: knees soft, axe held two-handed across the body, head up and forward. Every clip starts here.
export const GUARD = {
  bones: { hips: { x: 0, y: -6 }, torso: -4, head: 4, axe: { x: 14, y: -44 } },
  aim: { axe: 55 },
  reach: { armNear: GRIP_NEAR, armFar: GRIP_FAR, legNear: FEET.near, legFar: FEET.far },
  z: { handFar: 26, forearmFar: 9 }
}

export default {
  ...{
  size: [ 620, 600 ],
  anchor: [ 270, 572 ],
  back: "torso",
  bones: {
    hips: {
      y: 134.4,
      rotation: 90,
      length: 4
    },
    torso: {
      parent: "hips",
      length: 99.2
    },
    head: {
      parent: "torso",
      x: 99.2,
      length: 88.2
    },
    axe: {
      parent: "torso",
      x: 14,
      y: -44,
      rotation: -35,
      length: 188
    },
    upperArmFar: {
      parent: "torso",
      x: 78,
      rotation: 180,
      length: 54
    },
    forearmFar: {
      parent: "upperArmFar",
      x: 54,
      length: 52.8
    },
    handFar: {
      parent: "forearmFar",
      x: 52.8,
      length: 24.9
    },
    thighFar: {
      parent: "hips",
      rotation: 180,
      length: 58.5
    },
    shinFar: {
      parent: "thighFar",
      x: 58.5,
      length: 57
    },
    footFar: {
      parent: "shinFar",
      x: 57,
      rotation: 90,
      length: 52
    },
    upperArmNear: {
      parent: "torso",
      x: 78,
      rotation: 180,
      length: 54
    },
    forearmNear: {
      parent: "upperArmNear",
      x: 54,
      length: 52.8
    },
    handNear: {
      parent: "forearmNear",
      x: 52.8,
      length: 24.9
    },
    thighNear: {
      parent: "hips",
      rotation: 180,
      length: 58.5
    },
    shinNear: {
      parent: "thighNear",
      x: 58.5,
      length: 57
    },
    footNear: {
      parent: "shinNear",
      x: 57,
      rotation: 90,
      length: 52
    }
  },
  parts: {
    torso: {
      bone: "torso",
      z: 10,
      shape: {
        kind: "image",
        file: "../parts/torso.png",
        pivot: [ 56.5, 96.2 ],
        angle: 0
      }
    },
    head: {
      bone: "head",
      z: 12,
      shape: {
        kind: "image",
        file: "../parts/head.png",
        pivot: [ 44, 92 ],
        angle: 0
      }
    },
    upperArmNear: {
      bone: "upperArmNear",
      z: 30,
      shape: {
        kind: "image",
        file: "../parts/upperArmNear.png",
        pivot: [ 23.4, 19.5 ],
        angle: 0.1
      }
    },
    forearmNear: {
      bone: "forearmNear",
      z: 31,
      shape: {
        kind: "image",
        file: "../parts/forearmNear.png",
        pivot: [ 14.7, 14.7 ],
        angle: 0.1
      }
    },
    handNear: {
      bone: "handNear",
      z: 32,
      shape: {
        kind: "image",
        file: "../parts/handNear.png",
        pivot: [ 7, 16 ],
        angle: -88.6
      }
    },
    upperArmFar: {
      bone: "upperArmFar",
      z: 1,
      far: true,
      tint: "#9ea8c7",
      shape: {
        kind: "image",
        file: "../parts/upperArmFar.png",
        pivot: [ 23.4, 19.5 ],
        angle: 0.1
      }
    },
    forearmFar: {
      bone: "forearmFar",
      z: 2,
      far: true,
      tint: "#9ea8c7",
      shape: {
        kind: "image",
        file: "../parts/forearmFar.png",
        pivot: [ 14.7, 14.7 ],
        angle: 0.1
      }
    },
    handFar: {
      bone: "handFar",
      z: 3,
      far: true,
      tint: "#9ea8c7",
      shape: {
        kind: "image",
        file: "../parts/handFar.png",
        pivot: [ 7, 16 ],
        angle: -88.6
      }
    },
    thighNear: {
      bone: "thighNear",
      z: 8,
      shape: {
        kind: "image",
        file: "../parts/thighNear.png",
        pivot: [ 21.5, 21 ],
        angle: 0
      }
    },
    shinNear: {
      bone: "shinNear",
      z: 21,
      shape: {
        kind: "image",
        file: "../parts/shinNear.png",
        pivot: [ 21.1, 20.5 ],
        angle: -0.1
      }
    },
    footNear: {
      bone: "footNear",
      z: 22,
      shape: {
        kind: "image",
        file: "../parts/footNear.png",
        pivot: [ 16, 15 ],
        angle: 0
      }
    },
    thighFar: {
      bone: "thighFar",
      z: 4,
      far: true,
      tint: "#9ea8c7",
      shape: {
        kind: "image",
        file: "../parts/thighFar.png",
        pivot: [ 21.5, 21 ],
        angle: 0
      }
    },
    shinFar: {
      bone: "shinFar",
      z: 5,
      far: true,
      tint: "#9ea8c7",
      shape: {
        kind: "image",
        file: "../parts/shinFar.png",
        pivot: [ 21.1, 20.5 ],
        angle: -0.1
      }
    },
    footFar: {
      bone: "footFar",
      z: 6,
      far: true,
      tint: "#9ea8c7",
      shape: {
        kind: "image",
        file: "../parts/footFar.png",
        pivot: [ 16, 15 ],
        angle: 0
      }
    },
    axe: {
      bone: "axe",
      z: 25,
      shape: {
        kind: "image",
        file: "../parts/axe.png",
        pivot: [ 36, 44 ],
        angle: 55
      }
    },
    // The chop's smear: the area the axe head swept since the frame before, shown on the fast frames only.
    smear: {
      bone: "axe",
      z: 24,
      fill: "#e9f2ff80",
      outline: null,
      hidden: true,
      shape: { kind: "sweep", from: 140, to: 200, frames: 1 }
    }
  },
  chains: {
    legNear: {
      upper: "thighNear",
      lower: "shinNear",
      end: "footNear",
      bend: 1,
      foot: true
    },
    legFar: {
      upper: "thighFar",
      lower: "shinFar",
      end: "footFar",
      bend: 1,
      foot: true
    },
    armNear: {
      upper: "upperArmNear",
      lower: "forearmNear",
      end: "handNear",
      bend: -1
    },
    armFar: {
      upper: "upperArmFar",
      lower: "forearmFar",
      end: "handFar",
      bend: -1
    }
  },
  props: {
    axe: [
      "axe",
      "smear"
    ]
  },
  sockets: {
    grip: {
      bone: "axe"
    },
    blade: {
      bone: "axe",
      along: 180
    }
  }
},
  stances: { guard: GUARD }
}
