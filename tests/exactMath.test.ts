import { describe, expect, it } from 'vitest'
import { atan, atan2, cos, exp, hypot, log, pow, sin } from '../src/sim/exactMath.ts'

// The exact-math helpers must stay close to the engine's Math (accuracy) and must not
// change: the golden values below are the bit patterns they gave when they were written,
// so a change in them changes every run's hash on purpose, not by accident.

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function close(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
}

describe('exactMath accuracy', () => {
  const next = lcg(7)
  const angles: number[] = []
  for (let i = 0; i < 20000; i += 1) angles.push(next() * 60 - 30)
  angles.push(0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, 1e3, -1e3)

  it('sin and cos agree with Math to about 1e-15', () => {
    for (const x of angles) {
      expect(close(sin(x), Math.sin(x), 5e-15), `sin(${x})`).toBe(true)
      expect(close(cos(x), Math.cos(x), 5e-15), `cos(${x})`).toBe(true)
    }
  })

  it('atan, atan2 agree with Math', () => {
    for (let i = 0; i < 20000; i += 1) {
      const y = next() * 40 - 20
      const x = next() * 40 - 20
      expect(close(atan2(y, x), Math.atan2(y, x), 5e-15), `atan2(${y}, ${x})`).toBe(true)
      expect(close(atan(y), Math.atan(y), 5e-15), `atan(${y})`).toBe(true)
    }
    expect(atan2(0, 0)).toBe(0)
    expect(atan2(0, -1)).toBeCloseTo(Math.PI, 15)
    expect(atan2(3, 0)).toBeCloseTo(Math.PI / 2, 15)
    expect(atan2(-3, 0)).toBeCloseTo(-Math.PI / 2, 15)
  })

  it('log, exp, pow, hypot agree with Math', () => {
    for (let i = 0; i < 20000; i += 1) {
      const u = next()
      const x = u * u * 100 + 1e-12
      expect(close(log(x), Math.log(x), 5e-15), `log(${x})`).toBe(true)
      const y = next() * 40 - 20
      expect(close(exp(y), Math.exp(y), 1e-14 * Math.abs(Math.exp(y))), `exp(${y})`).toBe(true)
      expect(close(pow(x, 3), Math.pow(x, 3), 1e-14 * Math.abs(Math.pow(x, 3))), `pow(${x}, 3)`).toBe(true)
      expect(close(pow(x, 2.5), Math.pow(x, 2.5), 1e-13 * Math.abs(Math.pow(x, 2.5))), `pow(${x}, 2.5)`).toBe(true)
      expect(close(hypot(y, x), Math.hypot(y, x), 1e-15)).toBe(true)
    }
    expect(log(0)).toBe(Number.NEGATIVE_INFINITY)
    expect(Number.isNaN(log(-1))).toBe(true)
    expect(log(Number.MIN_VALUE)).toBeCloseTo(Math.log(Number.MIN_VALUE), 10)
    expect(pow(2, -2)).toBe(0.25)
    expect(pow(5, 0)).toBe(1)
  })

  it('returns fixed bit patterns (engine independent)', () => {
    const view = new DataView(new ArrayBuffer(8))
    const bits = (v: number): string => {
      view.setFloat64(0, v)
      return view.getBigUint64(0).toString(16)
    }
    const probes = [sin(4.037518479857714), cos(4.037518479857714), atan2(-2.5, 7.25), log(0.123456789), pow(1.37, 3), exp(1.5)]
    expect(probes.map(bits)).toEqual(GOLDEN)
  })
})

const GOLDEN: string[] = ['bfe8fc36d704a910', 'bfe3fe549f43b252', 'bfd540765a5b20a0', 'c000bc233add5d72', '40049221858bc59d', '4011ed3fe64fc541']
