// Bit-exact math for the simulation.
// ECMAScript only fixes the result of + - * / and sqrt (IEEE 754 correctly rounded) and of
// floor, ceil, round, trunc, abs, min, max, sign, fround and imul. Math.sin, cos, atan2, log,
// exp and pow are "implementation-approximated": Node and Chrome returned different last
// bits for the same input, which made the same run hash differently in the two engines.
// Everything here uses only the exact operations above, so every engine gives the same bits.
// Accuracy is about 1e-15, which is all the sim needs; it is not a general libm.
// src/sim must call these instead of the Math functions (tests/architecture.test.ts enforces it).

// pi/2 in three parts (fdlibm): the first two have few enough bits that n * part is exact.
const PIO2_1 = 1.5707963267341256
const PIO2_2 = 6.077100506303966e-11
const PIO2_3 = 2.0222662487111665e-21
const TWO_OVER_PI = 0.6366197723675814

// fdlibm kernel coefficients for sin and cos on |r| <= pi/4.
const S1 = -0.16666666666666632
const S2 = 0.00833333333332249
const S3 = -0.0001984126982985795
const S4 = 0.0000027557313707070068
const S5 = -2.5050760253406863e-8
const S6 = 1.58969099521155e-10
const C1 = 0.0416666666666666
const C2 = -0.001388888888887411
const C3 = 0.00002480158728947673
const C4 = -2.7557314351390663e-7
const C5 = 2.087572321298175e-9
const C6 = -1.1359647557788195e-11

const PI = Math.PI
const HALF_PI = PI / 2
const LN2_HI = 0.6931471803691238
const LN2_LO = 1.9082149292705877e-10
const INV_LN2 = 1.4426950408889634
const SQRT_HALF = 0.7071067811865476

const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
// Index of the high word depends on byte order; probe it once.
f64[0] = 1
const HI = u32[1] === 0x3ff00000 ? 1 : 0
const LO = 1 - HI

function kernelSin(r: number): number {
  const z = r * r
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))))
}

function kernelCos(r: number): number {
  const z = r * r
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
}

/** Quadrant 0-3 and the remainder r in [-pi/4, pi/4] with x = n * pi/2 + r. */
function reduce(x: number): { n: number; r: number } {
  const n = Math.round(x * TWO_OVER_PI)
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3
  return { n: ((n % 4) + 4) % 4, r }
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN
  const { n, r } = reduce(x)
  if (n === 0) return kernelSin(r)
  if (n === 1) return kernelCos(r)
  if (n === 2) return -kernelSin(r)
  return -kernelCos(r)
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN
  const { n, r } = reduce(x)
  if (n === 0) return kernelCos(r)
  if (n === 1) return -kernelSin(r)
  if (n === 2) return -kernelCos(r)
  return kernelSin(r)
}

/** arctan for |t| <= tan(pi/12), by its Taylor series. */
function atanSmall(t: number): number {
  const z = t * t
  let sum = 0
  for (let k = 17; k >= 0; k -= 1) sum = sum * z + (k % 2 === 0 ? 1 : -1) / (2 * k + 1)
  return t * sum
}

const SQRT3 = Math.sqrt(3)
const TAN_PI_12 = 2 - SQRT3

/** arctan for any finite t, in (-pi/2, pi/2). */
export function atan(t: number): number {
  if (Number.isNaN(t)) return Number.NaN
  const a = Math.abs(t)
  let result: number
  if (a > 1) {
    // atan(a) = pi/2 - atan(1/a)
    result = HALF_PI - atanFolded(1 / a)
  } else {
    result = atanFolded(a)
  }
  return t < 0 ? -result : result
}

/** arctan for 0 <= a <= 1. */
function atanFolded(a: number): number {
  if (a <= TAN_PI_12) return atanSmall(a)
  // atan(a) = pi/6 + atan((a*sqrt3 - 1) / (sqrt3 + a)), the argument is within +-tan(pi/12).
  return PI / 6 + atanSmall((a * SQRT3 - 1) / (SQRT3 + a))
}

/** Angle of the vector (x, y) from the +x axis, like Math.atan2 (but (+-0, +-0) gives 0). */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  if (x === 0 && y === 0) return 0
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI
  if (y === 0) return x > 0 ? 0 : PI
  const base = atan(y / x)
  if (x > 0) return base
  return y > 0 ? base + PI : base - PI
}

/** Natural log. NaN below 0, -Infinity at 0. */
export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN
  if (x === 0) return Number.NEGATIVE_INFINITY
  if (x === Number.POSITIVE_INFINITY) return x
  let scaled = x
  let e = 0
  if (scaled < 2.2250738585072014e-308) {
    scaled *= 18014398509481984 // 2^54, exact
    e = -54
  }
  f64[0] = scaled
  const hi = u32[HI]
  e += (hi >>> 20) - 1023
  u32[HI] = (hi & 0x000fffff) | 0x3ff00000 // mantissa m in [1, 2)
  let m = f64[0]
  if (m > 1 / SQRT_HALF) {
    m *= 0.5
    e += 1
  }
  const s = (m - 1) / (m + 1)
  const z = s * s
  let sum = 0
  for (let k = 12; k >= 0; k -= 1) sum = sum * z + 1 / (2 * k + 1)
  const logM = 2 * s * sum
  return e * LN2_HI + (logM + e * LN2_LO)
}

/** e^x, via 2^k * e^r. */
export function exp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x > 709.78) return Number.POSITIVE_INFINITY
  if (x < -745.2) return 0
  const k = Math.round(x * INV_LN2)
  const r = x - k * LN2_HI - k * LN2_LO
  let term = 1
  let total = 1
  for (let i = 1; i <= 18; i += 1) {
    term = (term * r) / i
    total += term
  }
  return scale2(total, k)
}

/** value * 2^k with exact steps (split so the factor never overflows). */
function scale2(value: number, k: number): number {
  let v = value
  let left = k
  while (left > 1000) {
    v *= twoPow(1000)
    left -= 1000
  }
  while (left < -1000) {
    v *= twoPow(-1000)
    left += 1000
  }
  return v * twoPow(left)
}

function twoPow(k: number): number {
  f64[0] = 0
  u32[HI] = (k + 1023) << 20
  u32[LO] = 0
  return f64[0]
}

/** Square root of dx*dx + dy*dy (replaces Math.hypot, whose rounding is not specified). */
export function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

/** base^exponent for base >= 0. Whole exponents multiply; others go through exp and log. */
export function pow(base: number, exponent: number): number {
  if (exponent === 0) return 1
  if (Number.isInteger(exponent) && Math.abs(exponent) <= 64) {
    let result = 1
    let b = base
    let n = Math.abs(exponent)
    while (n > 0) {
      if (n % 2 === 1) result *= b
      b *= b
      n = Math.floor(n / 2)
    }
    return exponent < 0 ? 1 / result : result
  }
  if (base === 0) return exponent > 0 ? 0 : Number.POSITIVE_INFINITY
  if (base < 0) return Number.NaN
  return exp(exponent * log(base))
}
