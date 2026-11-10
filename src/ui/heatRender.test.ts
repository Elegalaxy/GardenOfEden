import { describe, expect, it } from 'vitest'

import { HEAT_BIN_COUNT } from './heat.ts'
import { HEAT_BIN_ALPHA, HEAT_RGB, heatBinColor, heatPixels } from './heatRender.ts'

describe('heat pixels', () => {
  it('leave an empty cell clear and give the busiest cell the strongest step', () => {
    const pixels = heatPixels({ cells: new Float32Array([0, 1, 5, 10]), layer: 'deaths', max: 10 })
    const alpha = (cell: number): number => pixels[cell * 4 + 3]!
    expect(alpha(0)).toBe(0)
    expect(alpha(1)).toBe(Math.round(HEAT_BIN_ALPHA[1]! * 255)) // 1 of 10 is in the first fifth
    expect(alpha(2)).toBe(Math.round(HEAT_BIN_ALPHA[3]! * 255)) // 5 of 10 is in the third fifth
    expect(alpha(3)).toBe(Math.round(HEAT_BIN_ALPHA[HEAT_BIN_COUNT]! * 255))
    expect([pixels[12], pixels[13], pixels[14]]).toEqual([...HEAT_RGB])
  })

  it('spread traffic on a square-root scale: a cell at a quarter of the maximum is already in the third step', () => {
    const traffic = heatPixels({ cells: new Float32Array([25, 100]), layer: 'traffic', max: 100 })
    const linear = heatPixels({ cells: new Float32Array([25, 100]), layer: 'deaths', max: 100 })
    expect(traffic[3]).toBeGreaterThan(linear[3]!)
  })

  it('grow in opacity with each step, and the legend swatch uses the same colour', () => {
    for (let bin = 1; bin <= HEAT_BIN_COUNT; bin += 1) expect(HEAT_BIN_ALPHA[bin]!).toBeGreaterThan(HEAT_BIN_ALPHA[bin - 1]!)
    expect(heatBinColor(1)).toBe(`rgba(${HEAT_RGB[0]}, ${HEAT_RGB[1]}, ${HEAT_RGB[2]}, ${HEAT_BIN_ALPHA[1]})`)
    expect(heatBinColor(0)).toContain(', 0)')
  })
})
