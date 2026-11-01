/**
 * A first rig from a character's parts (`rig parts`' `parts.json`): a
 * side-view humanoid facing right, standing. Each picture's pivot sits on
 * its bone's start, and the bone runs from the pivot to where the picture
 * ends along it, so the next part's joint is where this picture ends.
 *
 * A picture keeps the way it was drawn when it was drawn upright or flat:
 * the head, the torso, and the feet always (turned only by a whole quarter
 * turn, for one drawn on its side), and any other part whose long axis is
 * within `SNAP` degrees of its bone's direction or a quarter turn from it.
 * Only a limb drawn at a slant is turned exactly onto its bone. The bones'
 * setup angles come from the roles (the torso and head up, the limbs down,
 * the feet forward), never from the pictures.
 *
 * Parts the set does not have get a plain capsule (an ellipse for the
 * head) so the rig still bakes. A part with another name is a prop on a
 * bone of its own (a weapon), on the torso and declared before the arms,
 * so either hand's `reach` can hold it; the stance puts the near hand on
 * it. The agent then corrects pivots, angles, and lengths in the module it
 * wrote, which owns them from then on.
 */
import type { PartEntry, PartsFile } from "./parts.ts"

/** The parts a humanoid rig is made of, by name. */
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

/** A picture whose long axis is this close (degrees) to its bone, or to a quarter turn from it, is drawn upright or flat: it keeps that quarter turn exactly. */
export const SNAP = 10

const r1 = (n: number): number => Math.round(n * 10) / 10 + 0

/** An angle in (-180, 180]. */
const normal = (deg: number): number => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180
  return d === -180 ? 180 : d + 0 === 0 ? 0 : d
}

/** The nearest whole quarter turn. */
const quarter = (deg: number): number => normal(Math.round(deg / 90) * 90) + 0

/** The world angle (0 forward, 90 up, counter-clockwise) from a part's pivot to the far end of its long axis: its picture's y runs down. */
const axisAngle = (part: PartEntry): number => (Math.atan2(-(part.axis.to[1] - part.pivot[1]), part.axis.to[0] - part.pivot[0]) * 180) / Math.PI

/** How far a picture reaches from its pivot toward one of its own sides (an angle that is a quarter turn: 0 right, 90 up), less the crop's one-pixel margin. */
const extent = (part: PartEntry, direction: number): number => {
  const d = quarter(direction)
  const [w, h] = part.size
  const [px, py] = part.pivot
  return Math.max(2, (d === 0 ? w - px : d === 90 ? py : d === -90 ? h - py : px) - 1)
}

/** How a picture sits on a bone pointing `world` degrees: the `angle` it is turned by, and how long the bone is to where the picture ends. */
const placement = (part: PartEntry, world: number, upright: boolean): { readonly angle: number; readonly length: number } => {
  const turn = normal(world - axisAngle(part))
  const kept = quarter(turn)
  if (upright || Math.abs(turn - kept) <= SNAP || Math.abs(Math.abs(turn - kept) - 360) <= SNAP) return { angle: kept, length: r1(extent(part, world - kept)) }
  return { angle: r1(turn), length: r1(Math.max(2, Math.hypot(part.axis.to[0] - part.pivot[0], part.axis.to[1] - part.pivot[1]))) }
}

/** Each role's bone direction in the setup pose (the torso and head up, the limbs down, the feet forward), and whether its picture is drawn upright or flat. */
const worldAngle = (role: Role): number => (role === "torso" || role === "head" ? 90 : role.startsWith("foot") ? 0 : -90)
const isUpright = (role: Role): boolean => role === "torso" || role === "head" || role.startsWith("foot")

export interface Scaffold {
  /** The rig module's source. */
  readonly rig: string
  /** The idle clip draft's source. */
  readonly idle: string
  /** The humanoid parts the set did not have, drawn as plain shapes. */
  readonly fallbacks: ReadonlyArray<string>
  /** Parts with other names: props, each on a bone of its own on the torso, held in the near hand. */
  readonly props: ReadonlyArray<string>
}

/**
 * The rig module and idle clip for a set of parts. `folder` is the path
 * from the rig module to the parts' pictures (`../parts`).
 */
export const scaffold = (set: PartsFile, folder: string): Scaffold => {
  const byName = new Map(set.parts.map((part) => [part.name, part]))
  const pair = (near: string, far: string): PartEntry | undefined => byName.get(near) ?? byName.get(far)
  const placed = new Map<string, { readonly angle: number; readonly length: number }>()
  for (const role of HUMANOID) {
    const part = byName.get(role)
    if (part !== undefined) placed.set(role, placement(part, worldAngle(role), isUpright(role)))
  }
  const T = r1(Math.max(8, placed.get("torso")?.length ?? 40))
  const length = (near: string, far: string, fallback: string): number => r1(placed.get(near)?.length ?? placed.get(far)?.length ?? FALLBACK[fallback]! * T)
  const L = {
    head: length("head", "head", "head"),
    upperArm: length("upperArmNear", "upperArmFar", "upperArm"),
    forearm: length("forearmNear", "forearmFar", "forearm"),
    hand: length("handNear", "handFar", "hand"),
    thigh: length("thighNear", "thighFar", "thigh"),
    shin: length("shinNear", "shinFar", "shin"),
    foot: length("footNear", "footFar", "foot")
  }
  // The ankle's height: how far the foot's picture reaches below its pivot, as it is turned.
  const footPart = pair("footNear", "footFar")
  const footAngle = placed.get(footPart?.name ?? "")?.angle ?? 0
  const ankle = r1(footPart === undefined ? 3 : extent(footPart, -90 - footAngle))
  const hipsY = r1(L.thigh + L.shin + ankle)
  const props = set.parts.filter((part) => !(HUMANOID as ReadonlyArray<string>).includes(part.name)).map((part) => part.name)
  // A prop's bone starts on the torso, forward of the hips where the near hand holds it with the arm a little bent.
  const reachOfArm = L.upperArm + L.forearm
  const held = { x: r1(T * 0.9 - 0.83 * reachOfArm - L.hand / 2), y: r1(-0.35 * reachOfArm) }
  const bones: Record<string, Record<string, unknown>> = {
    hips: { y: hipsY, rotation: 90, length: 4 },
    torso: { parent: "hips", length: T },
    head: { parent: "torso", x: T, length: L.head }
  }
  // Declared before the arms, so a hand's reach can take a point on it.
  const propPlaces = new Map<string, { readonly world: number; readonly length: number }>()
  for (const name of props) {
    const part = byName.get(name)!
    const drawn = axisAngle(part)
    const kept = quarter(drawn)
    const world = Math.abs(drawn - kept) <= SNAP ? kept : r1(drawn)
    const length = r1(world === kept ? extent(part, world) : Math.max(2, Math.hypot(part.axis.to[0] - part.pivot[0], part.axis.to[1] - part.pivot[1])))
    propPlaces.set(name, { world, length })
    bones[name] = { parent: "torso", ...held, rotation: r1(normal(world - 90)), length }
  }
  for (const side of ["Far", "Near"]) {
    bones[`upperArm${side}`] = { parent: "torso", x: r1(T * 0.9), rotation: 180, length: L.upperArm }
    bones[`forearm${side}`] = { parent: `upperArm${side}`, x: L.upperArm, length: L.forearm }
    bones[`hand${side}`] = { parent: `forearm${side}`, x: L.forearm, length: L.hand }
    bones[`thigh${side}`] = { parent: "hips", rotation: 180, length: L.thigh }
    bones[`shin${side}`] = { parent: `thigh${side}`, x: L.thigh, length: L.shin }
    bones[`foot${side}`] = { parent: `shin${side}`, x: L.shin, rotation: 90, length: L.foot }
  }
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
    parts[role] = { ...common, shape: { kind: "image", file: `${folder}/${part.file}`, pivot: part.pivot, angle: placed.get(role)!.angle } }
  }
  for (const name of props) {
    const part = byName.get(name)!
    // As drawn, on its own bone: between the body and the near arm, so the near hand closes over it and the far hand goes behind.
    parts[name] = { bone: name, z: 25, shape: { kind: "image", file: `${folder}/${part.file}`, pivot: part.pivot, angle: 0 } }
  }
  const weapon = props[0]
  const height = Math.ceil((hipsY + T + L.head * 1.2) * 1.25)
  // Wide enough for the arms, and for the weapon held out in front (the anchor is in the middle).
  const width = Math.ceil(Math.max(height * 0.8, (L.upperArm + L.forearm + L.hand) * 2.6, weapon === undefined ? 0 : 2 * (-held.y + propPlaces.get(weapon)!.length) + 60))
  const groundY = height - Math.max(4, Math.round(height * 0.05))
  // The near hand on the weapon: `reach` puts the wrist on the goal, so the goal sits half a hand across the haft, with the hand turned down from it, to put the fist on it.
  const grip = weapon === undefined ? undefined : { bone: weapon, along: 0, across: r1(L.hand / 2), turn: -90 }
  const stand = {
    bones: { hips: { x: 0, y: r1(-0.04 * (L.thigh + L.shin)) }, torso: -3, head: 3, ...(grip === undefined ? { upperArmNear: 8, forearmNear: 20 } : {}), upperArmFar: -6, forearmFar: 14 },
    reach: {
      legNear: { x: r1(L.foot * 0.35), y: ankle, angle: 0 },
      legFar: { x: r1(-L.foot * 0.35), y: ankle, angle: 0 },
      ...(grip === undefined ? {} : { armNear: grip })
    }
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
    sockets: weapon === undefined ? { grip: { bone: "handNear", along: L.hand } } : { grip: { bone: weapon }, tip: { bone: weapon, along: propPlaces.get(weapon)!.length } },
    stances: { stand }
  }
  const source = `// A first rig from ${set.sheet === "" ? "a parts sheet" : set.sheet}'s parts (\`rig init --from\`): a side view facing right (+x), y up, the origin on the ground under it.
// Each picture's pivot sits on its bone's start. \`angle\` turns a picture in the setup pose's world: 0 keeps it as drawn (the head, torso, and feet, and parts drawn upright or flat).
// This module owns the pivots, angles, and lengths now (parts.json is not read again): correct what reads wrong in \`rig look\` here, or drag a pivot on the review page.
// Parts the sheet did not have are plain shapes${fallbacks.length === 0 ? " (none here)" : `: ${fallbacks.join(", ")}`}.${
    weapon === undefined
      ? ""
      : `
// ${props.join(", ")}: on ${props.length === 1 ? "its own bone" : "bones of their own"} on the torso, declared before the arms so either hand can reach it. The stance puts the near hand on ${weapon};
// for two hands, give the far arm a reach onto it too: { bone: "${weapon}", along: <further down the haft>, across: ${grip!.across}, turn: -90 }.`
  }
export default ${JSON.stringify(rig, null, 2)}
`
  // The breath in, a frame after the hips: the torso and the arms. A held weapon dips with the breath instead, and the near arm follows it.
  const sway: Record<string, number> = { torso: -3 + 1.5, upperArmFar: -6 + 4, forearmFar: 14 + 8, ...(grip === undefined ? { upperArmNear: 8 + 4, forearmNear: 20 + 8 } : {}) }
  const dip = weapon === undefined ? "" : `, ${weapon}: { x: -2 * p.breath }`
  const idle = `// A draft of the "idle" clip: the stand stance, breathing in to frame 8 and out again.
// A loop's channels wrap: after its last key each one moves back to its frame-0 value (the stance) by frame 16, so the keys say only the breath in.
// The torso follows the hips a frame later and the head a frame after that: the body leads, the rest catches up.
export default {
  label: "breathing",
  frames: 16,
  fps: 12,
  loop: true,
  stance: "stand",
  params: { breath: { min: 0, max: ${r1(hipsY * 0.08)}, value: ${r1(hipsY * 0.04)} } },
  pose(rig, _t, p) {
    const stand = rig.stances.stand
    return rig.keys([
      { at: 8, rest: true, bones: { hips: { y: stand.bones.hips.y - p.breath } } },
      { at: 9, rest: true, bones: { ${Object.entries(sway)
        .map(([bone, value]) => `${bone}: ${r1(value)}`)
        .join(", ")}${dip} } },
      { at: 10, rest: true, bones: { head: ${r1(3 - 1.5)} } }
    ])
  }
}
`
  return { rig: source, idle, fallbacks, props }
}
