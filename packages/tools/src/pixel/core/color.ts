/**
 * Colors and how far apart two colors look.
 *
 * Pixel art lives in sRGB with 8-bit channels, but distances are measured in
 * a perceptual space: OKLab (fast, close to how people see) or CIELAB with
 * CIEDE2000 (the reference formula, slower). Plain RGB distance is not
 * offered: it treats dark blues and bright greens very unevenly.
 */

/** A color in sRGB, each channel a whole number from 0 to 255. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** A color in a Lab space (OKLab or CIELAB, depending on who made it). */
export interface Lab {
  readonly l: number
  readonly a: number
  readonly b: number
}

/** How the nearest palette color is chosen. */
export type Metric = "oklab" | "ciede2000"

export const metrics: ReadonlyArray<{ readonly id: Metric; readonly label: string }> = [
  { id: "oklab", label: "OKLab (fast, perceptual)" },
  { id: "ciede2000", label: "CIEDE2000 (reference)" }
]

/** Rounds and clamps a channel into 0..255. */
export const channel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)))

/** Packs a color into one number (0xRRGGBB), used as a map key. */
export const pack = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b

export const unpack = (packed: number): Rgb => ({ r: (packed >> 16) & 255, g: (packed >> 8) & 255, b: packed & 255 })

/** `#rrggbb`, lower case. */
export const toHex = ({ r, g, b }: Rgb): string => `#${pack(r, g, b).toString(16).padStart(6, "0")}`

/** Reads `#rgb`, `rgb`, `#rrggbb`, `rrggbb`, or `#rrggbbaa` (alpha ignored); undefined when it is not a color. */
export const parseHex = (text: string): Rgb | undefined => {
  const hex = text.trim().replace(/^#/, "")
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = [...hex].map((digit) => parseInt(digit + digit, 16))
    return { r: r!, g: g!, b: b! }
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) {
    return unpack(parseInt(hex.slice(0, 6), 16))
  }
  return undefined
}

const toLinearTable = new Float64Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  toLinearTable[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const toLinear = (value: number): number => toLinearTable[channel(value)]!

const fromLinear = (value: number): number =>
  channel(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055))

export const toOklab = ({ r, g, b }: Rgb): Lab => {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
}

export const fromOklab = ({ l, a, b }: Lab): Rgb => {
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: fromLinear(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1),
    g: fromLinear(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1),
    b: fromLinear(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1)
  }
}

const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)

/** CIELAB under D65, the space CIEDE2000 is defined in. */
export const toCielab = ({ r, g, b }: Rgb): Lab => {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

const degrees = (radians: number): number => (radians * 180) / Math.PI
const radians = (deg: number): number => (deg * Math.PI) / 180
const pow7 = (value: number): number => value ** 7
const POW25_7 = pow7(25)

/** The CIEDE2000 color difference between two CIELAB colors. */
export const ciede2000 = (first: Lab, second: Lab): number => {
  const c1 = Math.hypot(first.a, first.b)
  const c2 = Math.hypot(second.a, second.b)
  const cMean = (c1 + c2) / 2
  const g = 0.5 * (1 - Math.sqrt(pow7(cMean) / (pow7(cMean) + POW25_7)))
  const a1 = (1 + g) * first.a
  const a2 = (1 + g) * second.a
  const c1p = Math.hypot(a1, first.b)
  const c2p = Math.hypot(a2, second.b)
  const hue = (b: number, a: number): number => {
    if (a === 0 && b === 0) return 0
    const h = degrees(Math.atan2(b, a))
    return h < 0 ? h + 360 : h
  }
  const h1 = hue(first.b, a1)
  const h2 = hue(second.b, a2)

  const dL = second.l - first.l
  const dC = c2p - c1p
  let dh = 0
  if (c1p * c2p !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(radians(dh / 2))

  const lMean = (first.l + second.l) / 2
  const cpMean = (c1p + c2p) / 2
  let hMean = h1 + h2
  if (c1p * c2p !== 0) {
    if (Math.abs(h1 - h2) <= 180) hMean = (h1 + h2) / 2
    else if (h1 + h2 < 360) hMean = (h1 + h2 + 360) / 2
    else hMean = (h1 + h2 - 360) / 2
  }
  const t =
    1 -
    0.17 * Math.cos(radians(hMean - 30)) +
    0.24 * Math.cos(radians(2 * hMean)) +
    0.32 * Math.cos(radians(3 * hMean + 6)) -
    0.2 * Math.cos(radians(4 * hMean - 63))
  const dTheta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2))
  const rc = 2 * Math.sqrt(pow7(cpMean) / (pow7(cpMean) + POW25_7))
  const sl = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2)
  const sc = 1 + 0.045 * cpMean
  const sh = 1 + 0.015 * cpMean * t
  const rt = -Math.sin(radians(2 * dTheta)) * rc
  const lTerm = dL / sl
  const cTerm = dC / sc
  const hTerm = dH / sh
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rt * cTerm * hTerm)
}

/**
 * Finds the palette color nearest to a color, by the chosen metric.
 * Answers are cached per color: a picture repeats the same colors a lot.
 */
export interface Matcher {
  /** The index of the nearest palette color. */
  readonly nearest: (color: Rgb) => number
}

export const makeMatcher = (palette: ReadonlyArray<Rgb>, metric: Metric): Matcher => {
  const cache = new Map<number, number>()
  const space = metric === "oklab" ? toOklab : toCielab
  const labs = palette.map(space)
  const distance =
    metric === "oklab"
      ? (x: Lab, y: Lab) => (x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2
      : ciede2000
  return {
    nearest: (color) => {
      const key = pack(channel(color.r), channel(color.g), channel(color.b))
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const lab = space(color)
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let i = 0; i < labs.length; i++) {
        const d = distance(lab, labs[i]!)
        if (d < bestDistance) {
          bestDistance = d
          best = i
        }
      }
      cache.set(key, best)
      return best
    }
  }
}
