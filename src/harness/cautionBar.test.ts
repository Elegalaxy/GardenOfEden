import { describe, expect, it } from 'vitest'

import { CAUTION_BAR_MAX_EXTINCT, CAUTION_BAR_MEDIAN, cautionRow, formatCautionBar, judgeCautionBar, median } from './cautionBar.ts'
import type { CautionRow } from './cautionBar.ts'

// The caution bar's pure logic with fixed inputs, plus the shape of a real (short) run. Needs no content, so it lives beside the module.

const row = (seed: string, caution: number | null, final = 50): CautionRow => ({ seed, final: caution === null ? 0 : final, caution })

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([0.3, 0.5, 0.4])).toBe(0.4)
    expect(median([0.4, 0.43, 0.41, 0.42])).toBe(0.415)
    expect(median([])).toBeNull()
  })
})

describe('judgeCautionBar', () => {
  it('passes at exactly the bar and with one extinct seed', () => {
    const rows = [row('a', 0.41), row('b', 0.41), row('c', 0.41), row('d', null)]
    expect(judgeCautionBar(rows)).toEqual({ living: 3, extinct: 1, median: 0.41, below: 0, pass: true })
    expect(CAUTION_BAR_MEDIAN).toBe(0.41)
    expect(CAUTION_BAR_MAX_EXTINCT).toBe(1)
  })

  it('fails below the median bar', () => {
    const v = judgeCautionBar([row('a', 0.4), row('b', 0.41), row('c', 0.4)])
    expect(v.median).toBe(0.4)
    expect(v.pass).toBe(false)
  })

  it('fails with two extinct seeds even when the median is high', () => {
    const v = judgeCautionBar([row('a', 0.5), row('b', 0.5), row('c', null), row('d', null)])
    expect(v).toMatchObject({ living: 2, extinct: 2, median: 0.5, pass: false })
  })

  it('counts living seeds below 0.39 for information only', () => {
    const v = judgeCautionBar([row('a', 0.38), row('b', 0.45), row('c', 0.46), row('d', 0.3), row('e', 0.5)])
    expect(v.below).toBe(2)
    expect(v.pass).toBe(true)
  })

  it('fails when nobody lives', () => {
    expect(judgeCautionBar([row('a', null), row('b', null)])).toMatchObject({ median: null, pass: false })
  })
})

describe('formatCautionBar', () => {
  it('prints one line per seed, the summary and the verdict', () => {
    const text = formatCautionBar([row('a', 0.43, 61), row('b', null)])
    const lines = text.split('\n')
    expect(lines[0]).toContain('caution')
    expect(lines[1]!.trim().split(/\s+/)).toEqual(['a', '61', '0.43', 'no'])
    expect(lines[2]!.trim().split(/\s+/)).toEqual(['b', '0', '-', 'yes'])
    expect(text).toContain('living 1  extinct 1 of 2')
    expect(text).toContain('median caution of living 0.430')
    expect(text).toContain('PASS')
  })
})

describe('cautionRow', () => {
  it('rounds the mean caution to two decimals like the survey and gives null for an empty world', () => {
    expect(cautionRow({ seed: 'a', final: 3, traits: { caution: 0.4149 } as never })).toEqual({ seed: 'a', final: 3, caution: 0.41 })
    expect(cautionRow({ seed: 'a', final: 0, traits: null }).caution).toBeNull()
  })
})
