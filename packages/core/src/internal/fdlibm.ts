/**
 * Pure-JavaScript ports of FreeBSD msun / musl libm (originally Sun fdlibm),
 * built only from `+ - * /`, `Math.sqrt`, and bit access. ECMAScript rounds
 * each of those exactly, so every engine and CPU returns the same bits.
 *
 * Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved.
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved.
 *
 * musl libm is MIT licensed, Copyright (c) 2005-2020 Rich Felker, et al.
 *
 * Changes from the C sources: results follow ECMAScript where it differs from
 * C (`pow(1, NaN)` and `pow(±1, ±Infinity)` are NaN), arguments of sin,
 * cos, and tan beyond 2^20·π/2 are reduced exactly with BigInt instead of
 * `__rem_pio2_large`, and `exp(1)` returns `Math.E`.
 *
 * @internal
 */

const scratch = new Float64Array(1)
const words = new Uint32Array(scratch.buffer)
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
const HI = LITTLE_ENDIAN ? 1 : 0
const LO = LITTLE_ENDIAN ? 0 : 1

/** The high 32 bits of `x`, as a signed integer (sign, exponent, top of the mantissa). */
const highWord = (x: number): number => {
  scratch[0] = x
  return words[HI]! | 0
}

/** The low 32 bits of `x`, unsigned. */
const lowWord = (x: number): number => {
  scratch[0] = x
  return words[LO]!
}

const fromWords = (high: number, low: number): number => {
  words[HI] = high
  words[LO] = low
  return scratch[0]!
}

/** `x` with its low 32 bits cleared. */
const clearLow = (x: number): number => {
  scratch[0] = x
  words[LO] = 0
  return scratch[0]!
}

const TWO_1023 = fromWords(0x7fe00000, 0)
const TWO_M1022 = fromWords(0x00100000, 0)
const TWO_53 = 9007199254740992

/** `x * 2^n`, rounded once. */
const scalbn = (x: number, n: number): number => {
  let y = x
  let k = n
  if (k > 1023) {
    y *= TWO_1023
    k -= 1023
    if (k > 1023) {
      y *= TWO_1023
      k -= 1023
      if (k > 1023) k = 1023
    }
  } else if (k < -1022) {
    // Keep the final k below -53 to avoid double rounding into subnormals.
    y *= TWO_M1022 * TWO_53
    k += 1022 - 53
    if (k < -1022) {
      y *= TWO_M1022 * TWO_53
      k += 1022 - 53
      if (k < -1022) k = -1022
    }
  }
  return y * fromWords((0x3ff + k) << 20, 0)
}

// ---------------------------------------------------------------------------
// Argument reduction: x = n·(π/2) + (y0 + y1), |y0 + y1| <= π/4

let reducedHigh = 0
let reducedLow = 0

const TO_INT = 1.5 / 2.220446049250313e-16
const PIO4 = 7.85398163397448278999e-01
const INVPIO2 = 6.36619772367581382433e-01
const PIO2_1 = 1.57079632673412561417e+00
const PIO2_1T = 6.07710050650619224932e-11
const PIO2_2 = 6.07710050630396597660e-11
const PIO2_2T = 2.02226624879595063154e-21
const PIO2_3 = 2.02226624871116645580e-21
const PIO2_3T = 8.47842766036889956997e-32

/** Sets `reducedHigh`/`reducedLow` and returns n (only n mod 4 is meaningful for huge x). */
const remPio2 = (x: number): number => {
  const ix = highWord(x) & 0x7fffffff
  if (ix < 0x413921fb) {
    // |x| < 2^20·π/2: Cody–Waite reduction with up to three rounds.
    let fn = x * INVPIO2 + TO_INT - TO_INT
    let n = fn | 0
    let r = x - fn * PIO2_1
    let w = fn * PIO2_1T
    if (r - w < -PIO4) {
      n--
      fn--
      r = x - fn * PIO2_1
      w = fn * PIO2_1T
    } else if (r - w > PIO4) {
      n++
      fn++
      r = x - fn * PIO2_1
      w = fn * PIO2_1T
    }
    let y0 = r - w
    const ex = ix >> 20
    let ey = (highWord(y0) >> 20) & 0x7ff
    if (ex - ey > 16) {
      let t = r
      w = fn * PIO2_2
      r = t - w
      w = fn * PIO2_2T - ((t - r) - w)
      y0 = r - w
      ey = (highWord(y0) >> 20) & 0x7ff
      if (ex - ey > 49) {
        t = r
        w = fn * PIO2_3
        r = t - w
        w = fn * PIO2_3T - ((t - r) - w)
        y0 = r - w
      }
    }
    reducedHigh = y0
    reducedLow = (r - y0) - w
    return n
  }
  if (ix >= 0x7ff00000) {
    reducedHigh = x - x
    reducedLow = reducedHigh
    return 0
  }
  return remPio2Large(x)
}

// Huge arguments: exact reduction with BigInt against 2/π to 1280 bits.

const PI_BITS = 1400
let twoOverPi = 0n
let halfPi130 = 0n

/** arctan(1/k) · 2^bits, by its Taylor series in fixed point. */
const arctanInverse = (k: bigint, bits: bigint): bigint => {
  const one = 1n << bits
  const k2 = k * k
  let power = one / k
  let sum = power
  for (let i = 1n; power !== 0n; i++) {
    power /= k2
    const term = power / (2n * i + 1n)
    sum = i % 2n === 1n ? sum - term : sum + term
  }
  return sum
}

const TWO_OVER_PI_BITS = 1280n

const initReduction = (): void => {
  const bits = BigInt(PI_BITS)
  // Machin: π = 16·atan(1/5) − 4·atan(1/239)
  const pi = 16n * arctanInverse(5n, bits) - 4n * arctanInverse(239n, bits)
  twoOverPi = (1n << (TWO_OVER_PI_BITS + 1n + bits)) / pi
  halfPi130 = pi >> (bits - 129n)
}

const remPio2Large = (x: number): number => {
  if (twoOverPi === 0n) initReduction()
  const negative = x < 0
  const ax = negative ? -x : x
  // ax = mantissa · 2^exponent, exactly (ax >= 2^20 here, so it is normal).
  const exponent = ((highWord(ax) >> 20) & 0x7ff) - 1075
  const mantissa = BigInt(ax / fromWords((exponent + 1023) << 20, 0))
  // ax · 2/π = product / 2^shift
  const shift = TWO_OVER_PI_BITS - BigInt(exponent)
  const product = mantissa * twoOverPi
  const unit = 1n << shift
  let n = Number((product >> shift) & 3n)
  let fraction = product & (unit - 1n)
  if (fraction >= unit >> 1n) {
    fraction -= unit
    n = (n + 1) & 3
  }
  // Keep 250 fraction bits, multiply by π/2 (130 bits): r = fraction·π/2 · 2^-380
  const r = (fraction >> (shift - 250n)) * halfPi130
  const scale = fromWords((380 + 1023) << 20, 0)
  const high = Number(r) / scale
  const low = Number(r - BigInt(high * scale)) / scale
  reducedHigh = negative ? -high : high
  reducedLow = negative ? -low : low
  return negative ? -n : n
}

// ---------------------------------------------------------------------------
// Kernels on [-π/4, π/4]

const S1 = -1.66666666666666324348e-01
const S2 = 8.33333333332248946124e-03
const S3 = -1.98412698298579493134e-04
const S4 = 2.75573137070700676789e-06
const S5 = -2.50507602534068634195e-08
const S6 = 1.58969099521155010221e-10

const kernelSin = (x: number, y: number, hasTail: boolean): number => {
  const z = x * x
  const w = z * z
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6)
  const v = z * x
  if (!hasTail) return x + v * (S1 + z * r)
  return x - ((z * (0.5 * y - v * r) - y) - v * S1)
}

const C1 = 4.16666666666666019037e-02
const C2 = -1.38888888888741095749e-03
const C3 = 2.48015872894767294178e-05
const C4 = -2.75573143513906633035e-07
const C5 = 2.08757232129817482790e-09
const C6 = -1.13596475577881948265e-11

const kernelCos = (x: number, y: number): number => {
  const z = x * x
  const w = z * z
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6))
  const hz = 0.5 * z
  const v = 1.0 - hz
  return v + (((1.0 - v) - hz) + (z * r - x * y))
}

const T = [
  3.33333333333334091986e-01,
  1.33333333333201242699e-01,
  5.39682539762260521377e-02,
  2.18694882948595424599e-02,
  8.86323982359930005737e-03,
  3.59207910759131235356e-03,
  1.45620945432529025516e-03,
  5.88041240820264096874e-04,
  2.46463134818469906812e-04,
  7.81794442939557092300e-05,
  7.14072491382608190305e-05,
  -1.85586374855275456654e-05,
  2.59073051863633712884e-05
] as const
const PIO4_LO = 3.06161699786838301793e-17

/** tan(x + y) when `odd` is false, -1/tan(x + y) when it is true. */
const kernelTan = (xIn: number, yIn: number, odd: boolean): number => {
  let x = xIn
  let y = yIn
  const hx = highWord(x)
  const big = (hx & 0x7fffffff) >= 0x3fe59428 // |x| >= 0.6744
  const negative = hx < 0
  if (big) {
    if (negative) {
      x = -x
      y = -y
    }
    x = (PIO4 - x) + (PIO4_LO - y)
    y = 0.0
  }
  const z = x * x
  let w = z * z
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))))
  let v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))))
  let s = z * x
  r = y + z * (s * (r + v) + y) + s * T[0]
  w = x + r
  if (big) {
    s = odd ? -1 : 1
    v = s - 2.0 * (x + (r - w * w / (w + s)))
    return negative ? -v : v
  }
  if (!odd) return w
  // -1/(x + r) has up to 2 ulp error, so compute it accurately.
  const w0 = clearLow(w)
  v = r - (w0 - x)
  const a = -1.0 / w
  const a0 = clearLow(a)
  return a0 + a * (1.0 + a0 * w0 + a0 * v)
}

// ---------------------------------------------------------------------------
// Trigonometric functions

export const sin = (x: number): number => {
  const ix = highWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return x // |x| < 2^-26
    return kernelSin(x, 0, false)
  }
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  switch (n & 3) {
    case 0:
      return kernelSin(reducedHigh, reducedLow, true)
    case 1:
      return kernelCos(reducedHigh, reducedLow)
    case 2:
      return -kernelSin(reducedHigh, reducedLow, true)
    default:
      return -kernelCos(reducedHigh, reducedLow)
  }
}

export const cos = (x: number): number => {
  const ix = highWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) return 1.0 // |x| < 2^-27·√2
    return kernelCos(x, 0)
  }
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  switch (n & 3) {
    case 0:
      return kernelCos(reducedHigh, reducedLow)
    case 1:
      return -kernelSin(reducedHigh, reducedLow, true)
    case 2:
      return -kernelCos(reducedHigh, reducedLow)
    default:
      return kernelSin(reducedHigh, reducedLow, true)
  }
}

export const tan = (x: number): number => {
  const ix = highWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e400000) return x // |x| < 2^-27
    return kernelTan(x, 0.0, false)
  }
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  return kernelTan(reducedHigh, reducedLow, (n & 1) !== 0)
}

// ---------------------------------------------------------------------------
// Inverse trigonometric functions

const PIO2_HI = 1.57079632679489655800e+00
const PIO2_LO = 6.12323399573676603587e-17
const PS0 = 1.66666666666666657415e-01
const PS1 = -3.25565818622400915405e-01
const PS2 = 2.01212532134862925881e-01
const PS3 = -4.00555345006794114027e-02
const PS4 = 7.91534994289814532176e-04
const PS5 = 3.47933107596021167570e-05
const QS1 = -2.40339491173441421878e+00
const QS2 = 2.02094576023350569471e+00
const QS3 = -6.88283971605453293030e-01
const QS4 = 7.70381505559019352791e-02

const asinRatio = (z: number): number => {
  const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))))
  const q = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)))
  return p / q
}

export const asin = (x: number): number => {
  const hx = highWord(x)
  const ix = hx & 0x7fffffff
  if (ix >= 0x3ff00000) {
    // |x| >= 1 or NaN
    if (((ix - 0x3ff00000) | lowWord(x)) === 0) return x * PIO2_HI
    return 0 / (x - x)
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e500000 && ix >= 0x00100000) return x
    return x + x * asinRatio(x * x)
  }
  // 0.5 <= |x| < 1
  const z = (1 - Math.abs(x)) * 0.5
  const s = Math.sqrt(z)
  const r = asinRatio(z)
  let result: number
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    result = PIO2_HI - (2 * (s + s * r) - PIO2_LO)
  } else {
    const f = clearLow(s)
    const c = (z - f * f) / (s + f)
    result = 0.5 * PIO2_HI - (2 * s * r - (PIO2_LO - 2 * c) - (0.5 * PIO2_HI - 2 * f))
  }
  return hx < 0 ? -result : result
}

export const acos = (x: number): number => {
  const hx = highWord(x)
  const ix = hx & 0x7fffffff
  if (ix >= 0x3ff00000) {
    // |x| >= 1 or NaN
    if (((ix - 0x3ff00000) | lowWord(x)) === 0) return hx < 0 ? 2 * PIO2_HI : 0
    return 0 / (x - x)
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI // |x| < 2^-57
    return PIO2_HI - (x - (PIO2_LO - x * asinRatio(x * x)))
  }
  if (hx < 0) {
    // x < -0.5
    const z = (1.0 + x) * 0.5
    const s = Math.sqrt(z)
    const w = asinRatio(z) * s - PIO2_LO
    return 2 * (PIO2_HI - (s + w))
  }
  // x > 0.5
  const z = (1.0 - x) * 0.5
  const s = Math.sqrt(z)
  const df = clearLow(s)
  const c = (z - df * df) / (s + df)
  const w = asinRatio(z) * s + c
  return 2 * (df + w)
}

const ATAN_HI = [
  4.63647609000806093515e-01,
  7.85398163397448278999e-01,
  9.82793723247329054082e-01,
  1.57079632679489655800e+00
] as const
const ATAN_LO = [
  2.26987774529616870924e-17,
  3.06161699786838301793e-17,
  1.39033110312309984516e-17,
  6.12323399573676603587e-17
] as const
const AT = [
  3.33333333333329318027e-01,
  -1.99999999998764832476e-01,
  1.42857142725034663711e-01,
  -1.11111104054623557880e-01,
  9.09088713343650656196e-02,
  -7.69187620504482999495e-02,
  6.66107313738753120669e-02,
  -5.83357013379057348645e-02,
  4.97687799461593236017e-02,
  -3.65315727442169155270e-02,
  1.62858201153657823623e-02
] as const

export const atan = (xIn: number): number => {
  let x = xIn
  const hx = highWord(x)
  const negative = hx < 0
  const ix = hx & 0x7fffffff
  if (ix >= 0x44100000) {
    // |x| >= 2^66 or NaN
    if (x !== x) return x
    return negative ? -ATAN_HI[3] : ATAN_HI[3]
  }
  let id: number
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x // |x| < 2^-27
    id = -1
  } else {
    x = Math.abs(x)
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 <= |x| < 11/16
        id = 0
        x = (2.0 * x - 1.0) / (2.0 + x)
      } else {
        // 11/16 <= |x| < 19/16
        id = 1
        x = (x - 1.0) / (x + 1.0)
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2
      x = (x - 1.5) / (1.0 + 1.5 * x)
    } else {
      // 2.4375 <= |x| < 2^66
      id = 3
      x = -1.0 / x
    }
  }
  const z = x * x
  const w = z * z
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
  if (id < 0) return x - x * (s1 + s2)
  const result = ATAN_HI[id]! - ((x * (s1 + s2) - ATAN_LO[id]!) - x)
  return negative ? -result : result
}

const PI = 3.1415926535897931160e+00
const PI_LO = 1.2246467991473531772e-16

export const atan2 = (y: number, x: number): number => {
  if (x !== x || y !== y) return x + y
  const hx = highWord(x)
  const lx = lowWord(x)
  const hy = highWord(y)
  const ly = lowWord(y)
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y) // x = 1
  const m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2) // 2·sign(x) + sign(y)
  const ix = hx & 0x7fffffff
  const iy = hy & 0x7fffffff
  if ((iy | ly) === 0) {
    // y = ±0
    switch (m) {
      case 0:
      case 1:
        return y
      case 2:
        return PI
      default:
        return -PI
    }
  }
  if ((ix | lx) === 0) return m & 1 ? -PI / 2 : PI / 2 // x = ±0
  if (ix === 0x7ff00000) {
    // x = ±Infinity
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI / 4
        case 1:
          return -PI / 4
        case 2:
          return 3 * PI / 4
        default:
          return -3 * PI / 4
      }
    }
    switch (m) {
      case 0:
        return 0.0
      case 1:
        return -0.0
      case 2:
        return PI
      default:
        return -PI
    }
  }
  // |y/x| > 2^64
  if (ix + (64 << 20) < iy || iy === 0x7ff00000) return m & 1 ? -PI / 2 : PI / 2
  // atan(|y/x|) without spurious underflow
  const z = (m & 2) !== 0 && iy + (64 << 20) < ix ? 0 : atan(Math.abs(y / x))
  switch (m) {
    case 0:
      return z
    case 1:
      return -z
    case 2:
      return PI - (z - PI_LO)
    default:
      return (z - PI_LO) - PI
  }
}

// ---------------------------------------------------------------------------
// Exponential functions

const LN2_HI = 6.93147180369123816490e-01
const LN2_LO = 1.90821492927058770002e-10
const INV_LN2 = 1.44269504088896338700e+00
const P1 = 1.66666666666666019037e-01
const P2 = -2.77777777770155933842e-03
const P3 = 6.61375632143793436117e-05
const P4 = -1.65339022054652515390e-06
const P5 = 4.13813679705723846039e-08

export const exp = (xIn: number): number => {
  let x = xIn
  const hx = highWord(x)
  const negative = hx < 0
  const ix = hx & 0x7fffffff
  if (ix >= 0x4086232b) {
    // |x| >= 708.39 or NaN
    if (x !== x) return x
    if (x > 709.782712893383973096) return x * TWO_1023 // overflow
    if (x < -745.13321910194110842) return 0 // underflow
  }
  if (x === 1) return 2.718281828459045 // Math.E: the reduction below lands 1 ulp above it
  let hi = 0
  let lo = 0
  let k = 0
  if (ix > 0x3fd62e42) {
    // |x| > 0.5·ln2
    if (ix >= 0x3ff0a2b2) {
      // |x| >= 1.5·ln2
      k = (INV_LN2 * x + (negative ? -0.5 : 0.5)) | 0
    } else {
      k = negative ? -1 : 1
    }
    hi = x - k * LN2_HI
    lo = k * LN2_LO
    x = hi - lo
  } else if (ix > 0x3e300000) {
    // |x| > 2^-28
    hi = x
  } else {
    return 1 + x
  }
  const xx = x * x
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))))
  const y = 1 + (x * c / (2 - c) - lo + hi)
  return k === 0 ? y : scalbn(y, k)
}

const O_THRESHOLD = 7.09782712893383973096e+02
const Q1 = -3.33333333333331316428e-02
const Q2 = 1.58730158725481460165e-03
const Q3 = -7.93650757867487942473e-05
const Q4 = 4.00821782732936239552e-06
const Q5 = -2.01099218183624371326e-07

/** e^x − 1, accurate near 0. */
export const expm1 = (xIn: number): number => {
  let x = xIn
  const hx = highWord(x)
  const negative = hx < 0
  const ix = hx & 0x7fffffff
  if (ix >= 0x4043687a) {
    // |x| >= 56·ln2
    if (x !== x) return x
    if (negative) return -1
    if (x > O_THRESHOLD) return x * TWO_1023
  }
  let k: number
  let c = 0
  if (ix > 0x3fd62e42) {
    // |x| > 0.5·ln2
    let hi: number
    let lo: number
    if (ix < 0x3ff0a2b2) {
      // |x| < 1.5·ln2
      if (!negative) {
        hi = x - LN2_HI
        lo = LN2_LO
        k = 1
      } else {
        hi = x + LN2_HI
        lo = -LN2_LO
        k = -1
      }
    } else {
      k = (INV_LN2 * x + (negative ? -0.5 : 0.5)) | 0
      hi = x - k * LN2_HI
      lo = k * LN2_LO
    }
    x = hi - lo
    c = (hi - x) - lo
  } else if (ix < 0x3c900000) {
    return x // |x| < 2^-54
  } else {
    k = 0
  }
  const hfx = 0.5 * x
  const hxs = x * hfx
  const r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))))
  const t = 3.0 - r1 * hfx
  let e = hxs * ((r1 - t) / (6.0 - x * t))
  if (k === 0) return x - (x * e - hxs)
  e = x * (e - c) - c
  e -= hxs
  if (k === -1) return 0.5 * (x - e) - 0.5
  if (k === 1) {
    if (x < -0.25) return -2.0 * (e - (x + 0.5))
    return 1.0 + 2.0 * (x - e)
  }
  if (k < 0 || k > 56) {
    const y = x - e + 1.0
    return (k === 1024 ? y * 2.0 * TWO_1023 : y * fromWords((0x3ff + k) << 20, 0)) - 1.0
  }
  const twopk = fromWords((0x3ff + k) << 20, 0)
  const twomk = fromWords((0x3ff - k) << 20, 0)
  if (k < 20) return (x - e + (1 - twomk)) * twopk
  return (x - (e + twomk) + 1) * twopk
}

export const tanh = (xIn: number): number => {
  const negative = highWord(xIn) < 0
  const x = Math.abs(xIn)
  const w = highWord(x)
  let t: number
  if (w > 0x3fe193ea) {
    // |x| > log(3)/2 or NaN
    if (w > 0x40340000) {
      t = 1 - 0 / x // |x| > 20 or NaN
    } else {
      t = expm1(2 * x)
      t = 1 - 2 / (t + 2)
    }
  } else if (w > 0x3fd058ae) {
    // |x| > log(5/3)/2
    t = expm1(2 * x)
    t = t / (t + 2)
  } else if (w >= 0x00100000) {
    t = expm1(-2 * x)
    t = -t / (t + 2)
  } else {
    t = x // subnormal
  }
  return negative ? -t : t
}

// ---------------------------------------------------------------------------
// Power

const BP = [1.0, 1.5] as const
const DP_H = [0.0, 5.84962487220764160156e-01] as const
const DP_L = [0.0, 1.35003920212974897128e-08] as const
const HUGE = 1.0e300
const TINY = 1.0e-300
const L1 = 5.99999999999994648725e-01
const L2 = 4.28571428578550184252e-01
const L3 = 3.33333329818377432918e-01
const L4 = 2.72728123808534006489e-01
const L5 = 2.30660745775561754067e-01
const L6 = 2.06975017800338417784e-01
const LG2 = 6.93147180559945286227e-01
const LG2_H = 6.93147182464599609375e-01
const LG2_L = -1.90465429995776804525e-09
const OVT = 8.0085662595372944372e-17
const CP = 9.61796693925975554329e-01
const CP_H = 9.61796700954437255859e-01
const CP_L = -7.02846165095275826516e-09
const IVLN2 = 1.44269504088896338700e+00
const IVLN2_H = 1.44269502162933349609e+00
const IVLN2_L = 1.92596299112661746887e-08

export const pow = (x: number, y: number): number => {
  // ECMAScript Number::exponentiate, where it differs from C pow.
  if (y !== y) return NaN
  if (y === 0) return 1
  if (x !== x) return NaN
  const hx = highWord(x)
  const lx = lowWord(x)
  const hy = highWord(y)
  const ly = lowWord(y)
  let ix = hx & 0x7fffffff
  const iy = hy & 0x7fffffff
  if (iy === 0x7ff00000 && ly === 0 && ((ix - 0x3ff00000) | lx) === 0) return NaN // (±1) ** ±Infinity
  if (hx === 0x3ff00000 && lx === 0) return 1.0 // 1 ** y

  // yisint: 0 when y is not an integer, 1 when odd, 2 when even (only when x < 0).
  let yisint = 0
  if (hx < 0) {
    if (iy >= 0x43400000) {
      yisint = 2
    } else if (iy >= 0x3ff00000) {
      const e = (iy >> 20) - 0x3ff
      if (e > 20) {
        const j = ly >>> (52 - e)
        if (((j << (52 - e)) >>> 0) === ly) yisint = 2 - (j & 1)
      } else if (ly === 0) {
        const j = iy >> (20 - e)
        if ((j << (20 - e)) === iy) yisint = 2 - (j & 1)
      }
    }
  }

  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y = ±Infinity
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0.0 // (|x| > 1) ** ±Infinity
      return hy >= 0 ? 0.0 : -y // (|x| < 1) ** ±Infinity
    }
    if (iy === 0x3ff00000) return hy >= 0 ? x : 1 / x // y = ±1
    if (hy === 0x40000000) return x * x // y = 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x) // y = 0.5, x >= +0
  }

  let ax = Math.abs(x)
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    // x = ±0, ±Infinity, ±1
    let z = ax
    if (hy < 0) z = 1.0 / z
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) {
        z = (z - z) / (z - z) // (-1) ** non-integer
      } else if (yisint === 1) {
        z = -z
      }
    }
    return z
  }

  let s = 1.0 // sign of the result
  if (hx < 0) {
    if (yisint === 0) return (x - x) / (x - x) // (x < 0) ** non-integer
    if (yisint === 1) s = -1.0
  }

  let t1: number
  let t2: number
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64: must overflow or underflow
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY
    }
    // Overflow or underflow when x is not close to one.
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY
    // |1 - x| <= 2^-20: log(x) by x - x^2/2 + x^3/3 - x^4/4
    const t = ax - 1.0
    const w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25))
    const u = IVLN2_H * t
    const v = t * IVLN2_L - w * IVLN2
    t1 = clearLow(u + v)
    t2 = v - (t1 - u)
  } else {
    let n = 0
    if (ix < 0x00100000) {
      // subnormal x
      ax *= TWO_53
      n -= 53
      ix = highWord(ax)
    }
    n += (ix >> 20) - 0x3ff
    const j = ix & 0x000fffff
    ix = j | 0x3ff00000
    let k: 0 | 1
    if (j <= 0x3988e) {
      k = 0 // |x| < sqrt(3/2)
    } else if (j < 0xbb67a) {
      k = 1 // |x| < sqrt(3)
    } else {
      k = 0
      n += 1
      ix -= 0x00100000
    }
    ax = fromWords(ix, lowWord(ax))
    // ss = s_h + s_l = (x - 1)/(x + 1) or (x - 1.5)/(x + 1.5)
    let u = ax - BP[k]
    let v = 1.0 / (ax + BP[k])
    const ss = u * v
    const sH = clearLow(ss)
    let tH = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0)
    let tL = ax - (tH - BP[k])
    const sL = v * ((u - sH * tH) - sH * tL)
    // log(ax)
    let s2 = ss * ss
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))))
    r += sL * (sH + ss)
    s2 = sH * sH
    tH = clearLow(3.0 + s2 + r)
    tL = r - ((tH - 3.0) - s2)
    u = sH * tH
    v = sL * tH + tL * ss
    const pH = clearLow(u + v)
    const pL = v - (pH - u)
    const zH = CP_H * pH
    const zL = CP_L * pH + pL * CP + DP_L[k]
    const t = n
    t1 = clearLow(((zH + zL) + DP_H[k]) + t)
    t2 = zL - (((t1 - t) - DP_H[k]) - zH)
  }

  // (y1 + y2)·(t1 + t2)
  const y1 = clearLow(y)
  const pL = (y - y1) * t1 + y * t2
  let pH = y1 * t1
  let z = pL + pH
  let j = highWord(z)
  const i = lowWord(z)
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE
    if (pL + OVT > z - pH) return s * HUGE * HUGE
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * TINY * TINY
    if (pL <= z - pH) return s * TINY * TINY
  }

  // 2^(pH + pL)
  const abs = j & 0x7fffffff
  let k = (abs >> 20) - 0x3ff
  let n = 0
  if (abs > 0x3fe00000) {
    // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1))
    k = ((n & 0x7fffffff) >> 20) - 0x3ff
    const t = fromWords(n & ~(0x000fffff >> k), 0)
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k)
    if (j < 0) n = -n
    pH -= t
  }
  const t = clearLow(pL + pH)
  const u = t * LG2_H
  const v = (pL - (t - pH)) * LG2 + t * LG2_L
  z = u + v
  const w = v - (z - u)
  const tt = z * z
  const r1 = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))))
  const r = (z * r1) / (r1 - 2.0) - (w + z * w)
  z = 1.0 - (r - z)
  j = highWord(z)
  j += n << 20
  if ((j >> 20) <= 0) {
    z = scalbn(z, n) // subnormal result
  } else {
    z = fromWords(j, lowWord(z))
  }
  return s * z
}

// ---------------------------------------------------------------------------
// hypot

const SPLIT = 134217729 // 2^27 + 1
const TWO_700 = fromWords((700 + 1023) << 20, 0)
const TWO_M700 = fromWords((-700 + 1023) << 20, 0)

export const hypot = (xIn: number, yIn: number): number => {
  let hx = highWord(xIn) & 0x7fffffff
  let lx = lowWord(xIn)
  let hy = highWord(yIn) & 0x7fffffff
  let ly = lowWord(yIn)
  // Arrange |x| >= |y| by their bits, so NaN sorts above Infinity.
  if (hx < hy || (hx === hy && lx < ly)) {
    const th = hx
    const tl = lx
    hx = hy
    lx = ly
    hy = th
    ly = tl
  }
  const ex = hx >>> 20
  const ey = hy >>> 20
  let x = fromWords(hx, lx)
  let y = fromWords(hy, ly)
  if (ey === 0x7ff) return y // hypot(Infinity, NaN) is Infinity
  if (ex === 0x7ff || (hy | ly) === 0) return x
  if (ex - ey > 64) return x + y
  // Scale so xh·xh cannot overflow and xl·xl cannot underflow.
  let z = 1
  if (ex > 0x3ff + 510) {
    z = TWO_700
    x *= TWO_M700
    y *= TWO_M700
  } else if (ey < 0x3ff - 450) {
    z = TWO_M700
    x *= TWO_700
    y *= TWO_700
  }
  // x² and y² as exact double-double sums (Dekker split).
  let c = x * SPLIT
  const xh = x - c + c
  const xl = x - xh
  const hxx = x * x
  const lxx = xh * xh - hxx + 2 * xh * xl + xl * xl
  c = y * SPLIT
  const yh = y - c + c
  const yl = y - yh
  const hyy = y * y
  const lyy = yh * yh - hyy + 2 * yh * yl + yl * yl
  return z * Math.sqrt(lyy + lxx + hyy + hxx)
}

// ---------------------------------------------------------------------------
// Logarithms

const LOG1 = 6.666666666666735130e-01
const LOG2 = 3.999999999940941908e-01
const LOG3 = 2.857142874366239149e-01
const LOG4 = 2.222219843214978396e-01
const LOG5 = 1.818357216161805012e-01
const LOG6 = 1.531383769920937332e-01
const LOG7 = 1.479819860511658591e-01
const TWO_54 = fromWords(0x43500000, 0)

let logK = 0
let logF = 0

/**
 * Splits a positive finite non-unit `x` into `2^logK · (1 + logF)` with
 * `1 + logF` in [√2/2, √2]. Returns a result for the special cases
 * (±0, negative, NaN, Infinity), or `undefined` once split.
 */
const logSplit = (xIn: number): number | undefined => {
  let x = xIn
  let hx = highWord(x) >>> 0
  let k = 0
  if (hx < 0x00100000 || hx >>> 31 !== 0) {
    if (x === 0) return -1 / (x * x) // log(±0) = -Infinity
    if (hx >>> 31 !== 0) return (x - x) / 0.0 // log(negative) = NaN
    k -= 54 // subnormal: scale up
    x *= TWO_54
    hx = highWord(x) >>> 0
  } else if (hx >= 0x7ff00000) {
    return x // Infinity or NaN
  } else if (hx === 0x3ff00000 && lowWord(x) === 0) {
    return 0 // log(1) = +0
  }
  hx += 0x3ff00000 - 0x3fe6a09e
  k += (hx >>> 20) - 0x3ff
  hx = (hx & 0x000fffff) + 0x3fe6a09e
  logK = k
  logF = fromWords(hx, lowWord(x)) - 1.0
  return undefined
}

/** s·(hfsq + R) of the log kernel on f = logF. */
const logKernel = (f: number, hfsq: number): number => {
  const s = f / (2.0 + f)
  const z = s * s
  const w = z * z
  const t1 = w * (LOG2 + w * (LOG4 + w * LOG6))
  const t2 = z * (LOG1 + w * (LOG3 + w * (LOG5 + w * LOG7)))
  return s * (hfsq + t2 + t1)
}

export const log = (x: number): number => {
  const special = logSplit(x)
  if (special !== undefined) return special
  const f = logF
  const hfsq = 0.5 * f * f
  const dk = logK
  return logKernel(f, hfsq) + dk * LN2_LO - hfsq + f + dk * LN2_HI
}

const IVLN2HI = 1.44269504072144627571e+00
const IVLN2LO = 1.67517131648865118353e-10

export const log2 = (x: number): number => {
  const special = logSplit(x)
  if (special !== undefined) return special
  const f = logF
  const hfsq = 0.5 * f * f
  const hi = clearLow(f - hfsq)
  const lo = f - hi - hfsq + logKernel(f, hfsq)
  let valHi = hi * IVLN2HI
  let valLo = (lo + hi) * IVLN2LO + lo * IVLN2HI
  const y = logK
  const w = y + valHi
  valLo += (y - w) + valHi
  valHi = w
  return valLo + valHi
}

const IVLN10HI = 4.34294481878168880939e-01
const IVLN10LO = 2.50829467116452752298e-11
const LOG10_2HI = 3.01029995663611771306e-01
const LOG10_2LO = 3.69423907715893078616e-13

export const log10 = (x: number): number => {
  const special = logSplit(x)
  if (special !== undefined) return special
  const f = logF
  const hfsq = 0.5 * f * f
  const hi = clearLow(f - hfsq)
  const lo = f - hi - hfsq + logKernel(f, hfsq)
  let valHi = hi * IVLN10HI
  const dk = logK
  const y = dk * LOG10_2HI
  let valLo = dk * LOG10_2LO + (lo + hi) * IVLN10LO + lo * IVLN10HI
  const w = y + valHi
  valLo += (y - w) + valHi
  valHi = w
  return valLo + valHi
}

export const log1p = (x: number): number => {
  const hx = highWord(x) >>> 0
  let k = 1
  let c = 0
  let f = 0
  if (hx < 0x3fda827a || hx >>> 31 !== 0) {
    // 1 + x < √2
    if (hx >= 0xbff00000) {
      // x <= -1
      if (x === -1) return x / 0.0 // -Infinity
      return (x - x) / 0.0 // NaN
    }
    if (((hx << 1) >>> 0) < 0x79400000) return x // |x| < 2^-53
    if (hx <= 0xbfd2bec4) {
      // √2/2 <= 1 + x < √2
      k = 0
      f = x
    }
  } else if (hx >= 0x7ff00000) {
    return x
  }
  if (k !== 0) {
    const u = 1 + x
    let hu = highWord(u) >>> 0
    hu += 0x3ff00000 - 0x3fe6a09e
    k = (hu >>> 20) - 0x3ff
    // Correction term ~ log(1 + x) - log(u), avoiding underflow in c/u.
    if (k < 54) {
      c = k >= 2 ? 1 - (u - x) : x - (u - 1)
      c /= u
    } else {
      c = 0
    }
    hu = (hu & 0x000fffff) + 0x3fe6a09e
    f = fromWords(hu, lowWord(u)) - 1
  }
  const hfsq = 0.5 * f * f
  const dk = k
  return logKernel(f, hfsq) + (dk * LN2_LO + c) - hfsq + f + dk * LN2_HI
}

// ---------------------------------------------------------------------------
// Hyperbolic functions

const EXPO2_KLN2 = fromWords(0x40962066, 0x151add8b) // 2043·ln2 (musl __expo2)
const EXPO2_SCALE = fromWords((0x3ff + 1021) << 20, 0) // 2^1021

/** exp(x)/2·sign for x > log(DBL_MAX): exp(x - 2043·ln2)·2^2042, without overflowing early. */
const expo2 = (x: number, sign: number): number => exp(x - EXPO2_KLN2) * (sign * EXPO2_SCALE) * EXPO2_SCALE

export const sinh = (x: number): number => {
  const h = highWord(x) < 0 ? -0.5 : 0.5
  const absx = Math.abs(x)
  const w = highWord(absx)
  if (w < 0x40862e42) {
    // |x| < log(DBL_MAX)
    const t = expm1(absx)
    if (w < 0x3ff00000) {
      if (w < 0x3ff00000 - (26 << 20)) return x
      return h * (2 * t - t * t / (t + 1))
    }
    return h * (t + t / (t + 1))
  }
  return expo2(absx, 2 * h) // overflow or NaN
}

export const cosh = (xIn: number): number => {
  const x = Math.abs(xIn)
  const w = highWord(x)
  if (w < 0x3fe62e42) {
    // |x| < log(2)
    if (w < 0x3ff00000 - (26 << 20)) return 1
    const t = expm1(x)
    return 1 + t * t / (2 * (1 + t))
  }
  if (w < 0x40862e42) {
    // |x| < log(DBL_MAX)
    const t = exp(x)
    return 0.5 * (t + 1 / t)
  }
  return expo2(x, 1.0) // overflow or NaN
}

const LN2 = 6.93147180559945286227e-01

export const asinh = (x: number): number => {
  const hx = highWord(x)
  const ix = hx & 0x7fffffff
  if (ix >= 0x7ff00000) return x + x // Infinity or NaN
  if (ix < 0x3e300000) return x // |x| < 2^-28
  let w: number
  if (ix > 0x41b00000) {
    // |x| > 2^28
    w = log(Math.abs(x)) + LN2
  } else if (ix > 0x40000000) {
    // 2 < |x| <= 2^28
    const t = Math.abs(x)
    w = log(2.0 * t + 1 / (Math.sqrt(x * x + 1) + t))
  } else {
    // 2^-28 <= |x| <= 2
    const t = x * x
    w = log1p(Math.abs(x) + t / (1 + Math.sqrt(1 + t)))
  }
  return hx > 0 ? w : -w
}

export const acosh = (x: number): number => {
  const hx = highWord(x)
  if (hx < 0x3ff00000) return (x - x) / (x - x) // x < 1 or negative NaN
  if (hx >= 0x41b00000) {
    // x > 2^28
    if (hx >= 0x7ff00000) return x + x // Infinity or NaN
    return log(x) + LN2
  }
  if (((hx - 0x3ff00000) | lowWord(x)) === 0) return 0 // acosh(1) = 0
  if (hx > 0x40000000) {
    // 2 < x <= 2^28
    const t = x * x
    return log(2.0 * x - 1 / (x + Math.sqrt(t - 1)))
  }
  // 1 < x <= 2
  const t = x - 1
  return log1p(t + Math.sqrt(2.0 * t + t * t))
}

export const atanh = (xIn: number): number => {
  const hx = highWord(xIn)
  const lx = lowWord(xIn)
  const ix = hx & 0x7fffffff
  if ((ix | ((lx | ((-lx) >>> 0)) >>> 31)) > 0x3ff00000) return (xIn - xIn) / (xIn - xIn) // |x| > 1 or NaN
  if (ix === 0x3ff00000) return xIn / 0 // ±Infinity
  if (ix < 0x3e300000) return xIn // |x| < 2^-28
  const x = Math.abs(xIn)
  let t: number
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    t = x + x
    t = 0.5 * log1p(t + t * x / (1 - x))
  } else {
    t = 0.5 * log1p((x + x) / (1 - x))
  }
  return hx >= 0 ? t : -t
}

// ---------------------------------------------------------------------------
// Cube root

const B1 = 715094163 // (1023 - 1023/3 - 0.03306235651)·2^20
const B2 = 696219795 // (1023 - 1023/3 - 54/3 - 0.03306235651)·2^20
const CP0 = 1.87595182427177009643
const CP1 = -1.88497979543377169875
const CP2 = 1.621429720105354466140
const CP3 = -0.758397934778766047437
const CP4 = 0.145996192886612446982

export const cbrt = (x: number): number => {
  const high = highWord(x)
  const sign = high & 0x80000000
  let hx = high & 0x7fffffff
  if (hx >= 0x7ff00000) return x + x // Infinity or NaN
  // Rough cube root to 5 bits.
  if (hx < 0x00100000) {
    // zero or subnormal
    hx = highWord(x * TWO_54) & 0x7fffffff
    if (hx === 0) return x // ±0
    hx = Math.floor(hx / 3) + B2
  } else {
    hx = Math.floor(hx / 3) + B1
  }
  let t = fromWords((sign | hx) >>> 0, 0)
  // New cube root to 23 bits.
  let r = (t * t) * (t / x)
  t = t * ((CP0 + r * (CP1 + r * CP2)) + ((r * r) * r) * (CP3 + r * CP4))
  // Round t away from zero to 23 bits.
  const sum = lowWord(t) + 0x80000000
  const carry = sum >= 0x100000000 ? 1 : 0
  t = fromWords(((highWord(t) >>> 0) + carry) >>> 0, (sum & 0xc0000000) >>> 0)
  // One Newton step to 53 bits, error < 0.667 ulp.
  const s = t * t
  r = x / s
  const w = t + t
  r = (r - t) / (w + r)
  return t + t * r
}
