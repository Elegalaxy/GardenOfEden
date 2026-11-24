import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { cautionRow, formatCautionBar, judgeCautionBar } from '../src/harness/cautionBar.ts'
import { surveySeed } from '../src/harness/survey.ts'

// A short real run through the caution-bar path (3 seeds, 300 ticks): the survey rows turn into caution rows and a printed table.
describe('caution bar on a short run', () => {
  it('prints a row per seed, a summary and a verdict', () => {
    const rows = ['a', 'b', 'c'].map((seed) => cautionRow(surveySeed(seed, edenPreset, rules, 300, 100)))
    expect(rows.map((r) => r.seed)).toEqual(['a', 'b', 'c'])
    for (const r of rows) {
      expect(r.final).toBeGreaterThan(0)
      expect(r.caution).not.toBeNull()
    }
    const text = formatCautionBar(rows)
    expect(text.split('\n')).toHaveLength(1 + 3 + 1 + 2)
    expect(text).toMatch(/living 3 {2}extinct 0 of 3/)
    expect(text).toMatch(/PASS|FAIL/)
    expect(judgeCautionBar(rows).extinct).toBe(0)
  })
})
