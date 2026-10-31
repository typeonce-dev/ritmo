/**
 * A first rig from a character's parts (`rig parts`' `parts.json`): a
 * side-view humanoid facing right, standing. Each picture's pivot sits on
 * its bone's start and its long axis lies along the bone, and the bone
 * runs from the pivot to the far end of the axis, so the next part's joint
 * is where this picture ends. Parts the set does not have get a
 * plain capsule (an ellipse for the head) so the rig still bakes; parts
 * with other names become props held in the near hand. The agent then
 * corrects pivots, angles, and lengths in the module it wrote.
 */
import type { PartEntry, PartsFile } from "./parts.ts"

/** The parts a humanoid rig is made of, by name, with the bone each hangs on and its setup world angle (0 forward, 90 up, -90 down). */
export const HUMANOID = [
  "torso",
  "head",
  "upperArmNear",
  "forearmNear",
  "handNear",
  "upperArmFar",
  "forearmFar",
  "handFar",
  "thighNear",
  "shinNear",
  "footNear",
  "thighFar",
  "shinFar",
  "footFar"
] as const

type Role = (typeof HUMANOID)[number]


/** Lengths for parts the set does not have, as shares of the torso's (40 px when there is no torso). */
const FALLBACK: Readonly<Record<string, number>> = { head: 0.55, upperArm: 0.5, forearm: 0.45, hand: 0.15, thigh: 0.6, shin: 0.6, foot: 0.3 }

/** The far side of the body is drawn through this tint: darker and a little cooler (as the vector hero's far side). */
export const FAR_TINT = "#9ea8c7"

const r1 = (n: number): number => Math.round(n * 10) / 10 + 0

/** The world angle (0 forward, 90 up, counter-clockwise) from a part's pivot to the far end of its long axis: its picture's y runs down. */
const axisAngle = (part: PartEntry): number => (Math.atan2(-(part.axis.to[1] - part.pivot[1]), part.axis.to[0] - part.pivot[0]) * 180) / Math.PI

export interface Scaffold {
  /** The rig module's source. */
  readonly rig: string
  /** The idle clip draft's source. */
  readonly idle: string
  /** The humanoid parts the set did not have, drawn as plain shapes. */
  readonly fallbacks: ReadonlyArray<string>
  /** Parts with other names, made props in the near hand. */
  readonly props: ReadonlyArray<string>
}

/**
 * The rig module and idle clip for a set of parts. `folder` is the path
 * from the rig module to the parts' pictures (`../parts`).
 */
export const scaffold = (set: PartsFile, folder: string): Scaffold => {
  const byName = new Map(set.parts.map((part) => [part.name, part]))
  const pair = (near: string, far: string): PartEntry | undefined => byName.get(near) ?? byName.get(far)
  const torsoPart = byName.get("torso")
  /** From a part's pivot to the far end of its long axis. */
  const reach = (part: PartEntry): number => Math.hypot(part.axis.to[0] - part.pivot[0], part.axis.to[1] - part.pivot[1])
  const T = r1(torsoPart === undefined ? 40 : Math.max(8, reach(torsoPart)))
  const length = (part: PartEntry | undefined, fallback: string): number => r1(part === undefined ? FALLBACK[fallback]! * T : Math.max(2, reach(part)))
  const L = {
    head: length(byName.get("head"), "head"),
    upperArm: length(pair("upperArmNear", "upperArmFar"), "upperArm"),
    forearm: length(pair("forearmNear", "forearmFar"), "forearm"),
    hand: length(pair("handNear", "handFar"), "hand"),
    thigh: length(pair("thighNear", "thighFar"), "thigh"),
    shin: length(pair("shinNear", "shinFar"), "shin"),
    foot: length(pair("footNear", "footFar"), "foot")
  }
  const footPart = pair("footNear", "footFar")
  const ankle = r1(footPart === undefined ? 3 : Math.max(2, footPart.axis.width / 2))
  const hipsY = r1(L.thigh + L.shin + ankle)
  const bones: Record<string, Record<string, unknown>> = {
    hips: { y: hipsY, rotation: 90, length: 4 },
    torso: { parent: "hips", length: T },
    head: { parent: "torso", x: T, length: L.head }
  }
  for (const side of ["Far", "Near"]) {
    bones[`upperArm${side}`] = { parent: "torso", x: r1(T * 0.9), rotation: 180, length: L.upperArm }
    bones[`forearm${side}`] = { parent: `upperArm${side}`, x: L.upperArm, length: L.forearm }
    bones[`hand${side}`] = { parent: `forearm${side}`, x: L.forearm, length: L.hand }
    bones[`thigh${side}`] = { parent: "hips", rotation: 180, length: L.thigh }
    bones[`shin${side}`] = { parent: `thigh${side}`, x: L.thigh, length: L.shin }
    bones[`foot${side}`] = { parent: `shin${side}`, x: L.shin, rotation: 90, length: L.foot }
  }
  const worldAngle = (role: Role): number => (role === "torso" || role === "head" ? 90 : role.startsWith("foot") ? 0 : -90)
  const z: Record<Role, number> = {
    upperArmFar: 1,
    forearmFar: 2,
    handFar: 3,
    thighFar: 4,
    shinFar: 5,
    footFar: 6,
    torso: 10,
    head: 12,
    thighNear: 20,
    shinNear: 21,
    footNear: 22,
    upperArmNear: 30,
    forearmNear: 31,
    handNear: 32
  }
  const fallbacks: Array<string> = []
  const parts: Record<string, Record<string, unknown>> = {}
  for (const role of HUMANOID) {
    const far = role.endsWith("Far")
    const part = byName.get(role)
    const common = { bone: role, z: z[role], ...(far ? { far: true, tint: FAR_TINT } : {}) }
    if (part === undefined) {
      fallbacks.push(role)
      const radius = r1(role === "torso" ? T * 0.22 : role.startsWith("hand") || role.startsWith("foot") ? Math.max(2, T * 0.07) : Math.max(2, T * 0.1))
      parts[role] = {
        ...common,
        fill: far ? "#5a6478" : "#8b9bb4",
        shape: role === "head" ? { kind: "ellipse", c: { along: r1(L.head / 2) }, rx: r1(L.head * 0.45) } : { kind: "capsule", r: radius }
      }
      continue
    }
    // The picture's long axis turned onto the bone, its pivot on the bone's start.
    parts[role] = { ...common, shape: { kind: "image", file: `${folder}/${part.file}`, pivot: part.pivot, angle: r1(worldAngle(role) - axisAngle(part)) } }
  }
  const props = set.parts.filter((part) => !(HUMANOID as ReadonlyArray<string>).includes(part.name)).map((part) => part.name)
  for (const name of props) {
    const part = byName.get(name)!
    // Held at the near hand's end, as drawn on the sheet: turn it with `angle`, and swap or hide it with props.
    parts[name] = { bone: "handNear", z: 33, shape: { kind: "image", file: `${folder}/${part.file}`, pivot: part.pivot, at: { along: L.hand } } }
  }
  const height = Math.ceil((hipsY + T + L.head * 1.2) * 1.25)
  const width = Math.ceil(Math.max(height * 0.8, (L.upperArm + L.forearm + L.hand) * 2.6))
  const groundY = height - Math.max(4, Math.round(height * 0.05))
  const stand = {
    bones: { hips: { x: 0, y: r1(-0.04 * (L.thigh + L.shin)) }, torso: -3, head: 3, upperArmNear: 8, forearmNear: 20, upperArmFar: -6, forearmFar: 14 },
    reach: { legNear: { x: r1(L.foot * 0.35), y: ankle, angle: 0 }, legFar: { x: r1(-L.foot * 0.35), y: ankle, angle: 0 } }
  }
  const rig = {
    size: [width, height],
    anchor: [Math.round(width / 2), groundY],
    back: "torso",
    bones,
    parts,
    chains: {
      legNear: { upper: "thighNear", lower: "shinNear", end: "footNear", bend: 1, foot: true },
      legFar: { upper: "thighFar", lower: "shinFar", end: "footFar", bend: 1, foot: true },
      armNear: { upper: "upperArmNear", lower: "forearmNear", end: "handNear", bend: -1 },
      armFar: { upper: "upperArmFar", lower: "forearmFar", end: "handFar", bend: -1 }
    },
    ...(props.length === 0 ? {} : { props: Object.fromEntries(props.map((name) => [name, [name]])) }),
    sockets: { grip: { bone: "handNear", along: L.hand } },
    stances: { stand }
  }
  const source = `// A first rig from ${set.sheet === "" ? "a parts sheet" : set.sheet}'s parts (\`rig init --from\`): a side view facing right (+x), y up, the origin on the ground under it.
// Each picture's pivot (from parts.json, a guess) sits on its bone's start, and \`angle\` turns its long axis onto the bone.
// Correct what reads wrong in \`rig look\`: a part's pivot (in its picture's pixels), its angle, or a bone's length.
// Parts the sheet did not have are plain shapes${fallbacks.length === 0 ? " (none here)" : `: ${fallbacks.join(", ")}`}.
export default ${JSON.stringify(rig, null, 2)}
`
  const idle = `// A draft of the "idle" clip: the stand stance, breathing. Frame 0 is the stance: every layer below is 0 there.
export default {
  label: "breathing",
  frames: 16,
  fps: 12,
  loop: true,
  stance: "stand",
  params: { breath: { min: 0, max: ${r1(hipsY * 0.08)}, value: ${r1(hipsY * 0.04)} } },
  pose(rig, t, p) {
    const breath = (p.breath * (1 - Math.cos(2 * Math.PI * t))) / 2
    const sway = Math.sin(2 * Math.PI * t)
    return rig.add(rig.stances.stand, {
      bones: { hips: { y: -breath }, torso: 1.5 * sway, head: -1.5 * sway, upperArmNear: 3 * sway, forearmNear: 4 * sway, upperArmFar: -3 * sway, forearmFar: -4 * sway }
    })
  }
}
`
  return {
    rig: source,
    idle,
    fallbacks,
    props
  }
}
