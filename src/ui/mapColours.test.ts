import { describe, expect, it } from 'vitest'

import { COLORS } from './render.ts'

// Marks drawn on the map must stand out from it: at least 3:1 (WCAG, graphics) against the map's fill and background.

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

describe('map colours', () => {
  it.each(['toxic'] as const)('%s stands out from the map', (name) => {
    expect(contrast(COLORS[name], COLORS.mapFill)).toBeGreaterThanOrEqual(3)
    expect(contrast(COLORS[name], COLORS.background)).toBeGreaterThanOrEqual(3)
  })
})
