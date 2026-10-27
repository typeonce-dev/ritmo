/**
 * Palettes: the presets, reading and writing palette files (Lospec's `.hex`
 * and GIMP's `.gpl`), and extracting a palette from the picture itself.
 */
import { fromOklab, pack, parseHex, toHex, toOklab, unpack, type Lab, type Rgb } from "./color.ts"

export interface Palette {
  readonly name: string
  readonly colors: ReadonlyArray<Rgb>
}

const fromHexList = (name: string, list: string): Palette => {
  const seen = new Set<number>()
  const colors: Array<Rgb> = []
  for (const word of list.split(/\s+/)) {
    const color = parseHex(word)
    if (color === undefined) continue
    const key = pack(color.r, color.g, color.b)
    if (seen.has(key)) continue
    seen.add(key)
    colors.push(color)
  }
  return { name, colors }
}

/** Well-known pixel-art palettes, as published on lospec.com. */
export const presets: ReadonlyArray<Palette> = [
  fromHexList("Game Boy (4)", "0f380f 306230 8bac0f 9bbc0f"),
  fromHexList(
    "PICO-8 (16)",
    "000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa"
  ),
  fromHexList(
    "Sweetie 16",
    "1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57"
  ),
  fromHexList(
    "DawnBringer 16",
    "140c1c 442434 30346d 4e4a4e 854c30 346524 d04648 757161 597dce d27d2c 8595a1 6daa2c d2aa99 6dc2ca dad45e deeed6"
  ),
  fromHexList(
    "DawnBringer 32",
    "000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 " +
      "306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30"
  ),
  fromHexList(
    "Endesga 32",
    "be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e " +
      "124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569"
  ),
  fromHexList(
    "NES",
    "7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000 " +
      "bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888 " +
      "f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878 " +
      "fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8"
  ),
  fromHexList(
    "AAP-64",
    "060608 141013 3b1725 73172d b4202a df3e23 fa6a0a f9a31b ffd541 fffc40 d6f264 9cdb43 59c135 14a02e 1a7a3e 24523b " +
      "122020 143464 285cc4 249fde 20d6c7 a6fcdb ffffff fef3c0 fad6b8 f5a097 e86a73 bc4a9b 793a80 403353 242234 221c1a " +
      "322b28 71413b bb7547 dba463 f4d29c dae0ea b3b9d1 8b93af 6d758d 4a5462 333941 422433 5b3138 8e5252 ba756a e9b5a3 " +
      "e3e6ff b9bffb 849be4 588dbe 477d85 23674e 328464 5daf8d 92dcba cdf7e2 e4d2aa c7b08b a08662 796755 5a4e44 423934"
  )
]

/**
 * Reads a palette file: GIMP's `.gpl` (a "GIMP Palette" header, then
 * "r g b name" lines) or a list of hex colors (Lospec's `.hex`, or colors
 * pasted with any separators). Duplicates are dropped; an empty result
 * means nothing in the text was a color.
 */
export const parsePalette = (text: string, name = "Imported"): Palette => {
  if (/^\s*GIMP Palette/i.test(text)) {
    const colors: Array<Rgb> = []
    let paletteName = name
    for (const line of text.split(/\r?\n/).slice(1)) {
      const nameMatch = /^\s*Name:\s*(.+)$/i.exec(line)
      if (nameMatch !== null) {
        paletteName = nameMatch[1]!.trim()
        continue
      }
      const match = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(line)
      if (match === null) continue
      const [r, g, b] = [match[1], match[2], match[3]].map((value) => Math.min(255, Number(value)))
      colors.push({ r: r!, g: g!, b: b! })
    }
    return fromHexList(paletteName, colors.map(toHex).join(" "))
  }
  return fromHexList(name, text.replace(/[,;"'[\]]/g, " "))
}

/** Lospec's `.hex` format: one `rrggbb` per line. */
export const toHexFile = (palette: Palette): string =>
  palette.colors.map((color) => toHex(color).slice(1)).join("\n") + "\n"

/** GIMP's `.gpl` format, which Aseprite, Krita, and most editors read. */
export const toGpl = (palette: Palette): string =>
  [
    "GIMP Palette",
    `Name: ${palette.name}`,
    "Columns: 8",
    "#",
    ...palette.colors.map(
      (color) =>
        `${String(color.r).padStart(3)} ${String(color.g).padStart(3)} ${String(color.b).padStart(3)}\t${toHex(color)}`
    )
  ].join("\n") + "\n"

/** A small seeded generator, so extracting twice gives the same palette. */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const distance2 = (x: Lab, y: Lab): number => (x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2

/**
 * Picks `count` colors that best represent the given colors (k-means in
 * OKLab, seeded by k-means++). Locked colors stay exactly as they are and
 * count toward `count`; the rest are placed around them.
 */
export const extractPalette = (
  colors: ReadonlyArray<Rgb>,
  count: number,
  locked: ReadonlyArray<Rgb> = [],
  seed = 1
): Array<Rgb> => {
  const weights = new Map<number, number>()
  for (const color of colors) {
    const key = pack(color.r, color.g, color.b)
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }
  const lockedKeys = new Set(locked.map((color) => pack(color.r, color.g, color.b)))
  const free = Math.max(0, count - locked.length)
  const uniques = [...weights.keys()]
  if (uniques.filter((key) => !lockedKeys.has(key)).length <= free) {
    return [...locked, ...uniques.filter((key) => !lockedKeys.has(key)).map(unpack)]
  }

  const points = uniques.map((key) => ({ lab: toOklab(unpack(key)), weight: weights.get(key)! }))
  const random = seeded(seed)
  const centers: Array<Lab> = locked.map(toOklab)
  const lockedCount = centers.length

  // k-means++: each new center is drawn with odds growing with its distance to the nearest center so far.
  if (centers.length === 0) centers.push(points[Math.floor(random() * points.length)]!.lab)
  while (centers.length < lockedCount + free) {
    const reach = points.map((point) => point.weight * Math.min(...centers.map((center) => distance2(point.lab, center))))
    const total = reach.reduce((sum, value) => sum + value, 0)
    if (total === 0) break
    let pick = random() * total
    let chosen = 0
    for (; chosen < reach.length - 1; chosen++) {
      pick -= reach[chosen]!
      if (pick <= 0) break
    }
    centers.push(points[chosen]!.lab)
  }
  // Without locked colors the first center is a random pick, not a locked one.
  const fixed = lockedCount

  for (let iteration = 0; iteration < 24; iteration++) {
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }))
    for (const point of points) {
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let c = 0; c < centers.length; c++) {
        const d = distance2(point.lab, centers[c]!)
        if (d < bestDistance) {
          bestDistance = d
          best = c
        }
      }
      const sum = sums[best]!
      sum.l += point.lab.l * point.weight
      sum.a += point.lab.a * point.weight
      sum.b += point.lab.b * point.weight
      sum.weight += point.weight
    }
    let moved = false
    for (let c = fixed; c < centers.length; c++) {
      const sum = sums[c]!
      if (sum.weight === 0) continue
      const next = { l: sum.l / sum.weight, a: sum.a / sum.weight, b: sum.b / sum.weight }
      if (distance2(next, centers[c]!) > 1e-10) moved = true
      centers[c] = next
    }
    if (!moved) break
  }

  const result: Array<Rgb> = [...locked]
  const seen = new Set(lockedKeys)
  for (const center of centers.slice(fixed)) {
    const color = fromOklab(center)
    const key = pack(color.r, color.g, color.b)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(color)
  }
  // Darkest first among the extracted colors, so the swatches read in order.
  const extracted = result.slice(locked.length).sort((x, y) => toOklab(x).l - toOklab(y).l)
  return [...locked, ...extracted]
}

/** How a palette is proposed from the picture. */
export type ProposeMethod = "dominant" | "balanced" | "distinct"

export const proposeMethods: ReadonlyArray<{ readonly id: ProposeMethod; readonly label: string; readonly hint: string }> = [
  { id: "dominant", label: "Dominant", hint: "The most used colors, near-duplicates merged. Suits flat art." },
  { id: "balanced", label: "Balanced", hint: "The colors that best cover the whole picture (k-means)." },
  { id: "distinct", label: "Distinct", hint: "Colors as different from each other as possible: keeps small accents." }
]

/** A proposed color and the share of the picture nearest to it (0 to 1). */
export interface Proposal {
  readonly color: Rgb
  readonly share: number
}

/** Two colors closer than this (OKLab) are the same color for "dominant". */
const MERGE_RADIUS = 0.04
/** "Distinct" ignores colors used by fewer than this share of the cells: they are noise, not accents. */
const NOISE_SHARE = 0.002

/**
 * Up to `count` colors from the given ones (one per cell), most used first,
 * each with the share of the colors nearest to it. Fewer when the picture
 * has fewer: near-duplicates are never proposed.
 */
export const proposePalette = (colors: ReadonlyArray<Rgb>, count: number, method: ProposeMethod): Array<Proposal> => {
  if (colors.length === 0 || count < 1) return []
  const weights = new Map<number, number>()
  for (const color of colors) {
    const key = pack(color.r, color.g, color.b)
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }
  const points = [...weights]
    .map(([key, weight]) => ({ color: unpack(key), lab: toOklab(unpack(key)), weight }))
    .sort((x, y) => y.weight - x.weight)

  let picked: Array<Rgb>
  if (method === "balanced") {
    picked = extractPalette(colors, count)
  } else if (method === "dominant") {
    const chosen: Array<(typeof points)[number]> = []
    for (const point of points) {
      if (chosen.length >= count) break
      if (chosen.every((other) => distance2(point.lab, other.lab) > MERGE_RADIUS ** 2)) chosen.push(point)
    }
    picked = chosen.map((point) => point.color)
  } else {
    const candidates = points.filter((point) => point.weight >= NOISE_SHARE * colors.length)
    const pool = candidates.length > 0 ? candidates : points
    const chosen = [pool[0]!]
    const reach = pool.map((point) => distance2(point.lab, pool[0]!.lab))
    while (chosen.length < Math.min(count, pool.length)) {
      let far = 0
      for (let i = 1; i < pool.length; i++) if (reach[i]! > reach[far]!) far = i
      if (reach[far]! <= MERGE_RADIUS ** 2) break
      chosen.push(pool[far]!)
      pool.forEach((point, i) => {
        reach[i] = Math.min(reach[i]!, distance2(point.lab, pool[far]!.lab))
      })
    }
    picked = chosen.map((point) => point.color)
  }

  // k-means may split one color in two when asked for more colors than the picture has.
  picked = picked.filter((color, i) => picked.slice(0, i).every((other) => distance2(toOklab(color), toOklab(other)) > MERGE_RADIUS ** 2))
  const labs = picked.map(toOklab)
  const shares = new Array<number>(picked.length).fill(0)
  for (const point of points) {
    let best = 0
    for (let c = 1; c < labs.length; c++) if (distance2(point.lab, labs[c]!) < distance2(point.lab, labs[best]!)) best = c
    shares[best] = shares[best]! + point.weight
  }
  return picked
    .map((color, i) => ({ color, share: shares[i]! / colors.length }))
    .sort((x, y) => y.share - x.share)
}
