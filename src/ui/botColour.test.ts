import { describe, expect, it } from 'vitest'

import {
  BOT_COLOUR_MODES,
  FEMALE_FILL,
  MALE_FILL,
  PLAIN_FILL,
  TRAIT_RAMP,
  bloodlineColour,
  botFill,
  botShape,
  isBotColourKey,
  nextBotColourMode,
  rampStep,
  traitRange,
} from './botColour.ts'
import type { ColourBot } from './botColour.ts'

const traits = { senseRadius: 6, caution: 0.5, reproThreshold: 65, metabolism: 1, sprint: 1, longevity: 1, hardiness: 1, wariness: 1 }
const bot = (over: Partial<ColourBot> = {}): ColourBot => ({ hue: 100, sex: 'female', traits, ...over })

/** Relative luminance of #rrggbb, and the contrast ratio against the map colour. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}
const contrast = (hex: string): number => (luminance(hex) + 0.05) / (luminance('#141a24') + 0.05)

/** An HSL colour (h degrees, s and l 0..1) as #rrggbb. */
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  const hex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

describe('mode cycle and key', () => {
  it('cycles plain, bloodline, sex, trait, plain', () => {
    expect(BOT_COLOUR_MODES).toEqual(['plain', 'bloodline', 'sex', 'trait'])
    expect(nextBotColourMode('plain')).toBe('bloodline')
    expect(nextBotColourMode('trait')).toBe('plain')
  })

  it('takes C on its own only', () => {
    const base = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
    expect(isBotColourKey({ key: 'c', ...base })).toBe(true)
    expect(isBotColourKey({ key: 'C', ...base })).toBe(true)
    expect(isBotColourKey({ key: 'c', ...base, ctrlKey: true })).toBe(false)
    expect(isBotColourKey({ key: 'h', ...base })).toBe(false)
  })
})

describe('botFill', () => {
  it('plain is one colour', () => {
    expect(botFill(bot({ hue: 10 }), 'plain', 'caution', null)).toBe(PLAIN_FILL)
    expect(botFill(bot({ hue: 200 }), 'plain', 'caution', null)).toBe(PLAIN_FILL)
  })

  it('bloodline follows the hue and lightens blues and purples', () => {
    expect(botFill(bot({ hue: 100 }), 'bloodline', 'caution', null)).toBe('hsl(100 70% 64%)')
    expect(botFill(bot({ hue: 250 }), 'bloodline', 'caution', null)).toBe('hsl(250 70% 72%)')
    expect(bloodlineColour(219.96)).toBe('hsl(220 70% 64%)')
  })

  it('every bloodline hue keeps 3:1 against the map', () => {
    for (let h = 0; h < 360; h += 1) {
      const l = h >= 220 && h <= 290 ? 0.72 : 0.64
      expect(contrast(hslToHex(h, 0.7, l))).toBeGreaterThanOrEqual(3)
    }
  })

  it('sex uses two fills', () => {
    expect(botFill(bot({ sex: 'female' }), 'sex', 'caution', null)).toBe(FEMALE_FILL)
    expect(botFill(bot({ sex: 'male' }), 'sex', 'caution', null)).toBe(MALE_FILL)
    expect(FEMALE_FILL).not.toBe(MALE_FILL)
  })

  it('trait spreads the range over five steps', () => {
    const range = { min: 0, max: 1 }
    const at = (v: number): string => botFill(bot({ traits: { ...traits, caution: v } }), 'trait', 'caution', range)
    expect(at(0)).toBe(TRAIT_RAMP[0])
    expect(at(0.5)).toBe(TRAIT_RAMP[2])
    expect(at(0.99)).toBe(TRAIT_RAMP[4])
    expect(at(1)).toBe(TRAIT_RAMP[4])
  })

  it('the ramp and sex fills keep 3:1 against the map', () => {
    for (const c of [...TRAIT_RAMP, FEMALE_FILL, MALE_FILL]) expect(contrast(c)).toBeGreaterThanOrEqual(3)
  })
})

describe('traitRange and rampStep', () => {
  it('reads min and max, null when empty', () => {
    expect(traitRange([], 'caution')).toBeNull()
    const bots = [0.2, 0.9, 0.5].map((caution) => bot({ traits: { ...traits, caution } }))
    expect(traitRange(bots, 'caution')).toEqual({ min: 0.2, max: 0.9 })
  })

  it('uses the middle step when everyone is equal or there is no range', () => {
    expect(rampStep(3, { min: 3, max: 3 })).toBe(2)
    expect(rampStep(3, null)).toBe(2)
  })
})

describe('botShape', () => {
  it('makes males diamonds in sex mode only', () => {
    expect(botShape(bot({ sex: 'male' }), 'sex')).toBe('diamond')
    expect(botShape(bot({ sex: 'female' }), 'sex')).toBe('circle')
    expect(botShape(bot({ sex: 'male' }), 'bloodline')).toBe('circle')
    expect(botShape(bot({ sex: 'male' }), 'plain')).toBe('circle')
  })
})
