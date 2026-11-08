import { describe, expect, it } from 'vitest'

import { fractionOf, signedDelta, traitNumber, trendOf } from './traitMath.ts'

describe('traitNumber', () => {
  it('rounds each trait to its own number of decimals', () => {
    expect(traitNumber('senseRadius', 6.449)).toBe('6.4')
    expect(traitNumber('caution', 0.4549)).toBe('0.45')
    expect(traitNumber('reproThreshold', 62)).toBe('62.0')
    expect(traitNumber('metabolism', 1)).toBe('1.00')
  })
})

describe('trendOf and signedDelta', () => {
  it('points up and down with a sign, using a real minus', () => {
    expect(trendOf('senseRadius', 0.4)).toBe('up')
    expect(trendOf('caution', -0.12)).toBe('down')
    expect(signedDelta('senseRadius', 0.4)).toBe('+0.4')
    expect(signedDelta('caution', -0.12)).toBe('−0.12')
  })

  it('calls a change flat when it rounds to zero', () => {
    expect(trendOf('senseRadius', 0.04)).toBe('flat')
    expect(trendOf('metabolism', -0.004)).toBe('flat')
    expect(signedDelta('senseRadius', 0.04)).toBe('0.0')
    expect(signedDelta('metabolism', -0.004)).toBe('0.00')
  })
})

describe('fractionOf', () => {
  it('places a value in its range and clamps outside it', () => {
    expect(fractionOf(5, 0, 10)).toBe(0.5)
    expect(fractionOf(-1, 0, 10)).toBe(0)
    expect(fractionOf(11, 0, 10)).toBe(1)
  })

  it('is 0 for an empty range', () => {
    expect(fractionOf(3, 3, 3)).toBe(0)
  })
})
