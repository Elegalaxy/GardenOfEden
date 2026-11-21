import { beforeEach, describe, expect, it } from 'vitest'

import { cycleBotColour, getSnapshot, resetWorld, setBotColour, settled } from './store.ts'

// The page's bot colour setting (M20): the mode the C key cycles, and the trait for the trait mode.

beforeEach(async () => {
  setBotColour({ mode: 'plain', trait: 'senseRadius' })
  resetWorld('colour-store')
  await settled()
})

describe('the bot colour in the store', () => {
  it('starts plain, on the first trait', () => {
    expect(getSnapshot().botColour).toEqual({ mode: 'plain', trait: 'senseRadius' })
  })

  it('cycles plain, bloodline, sex, trait, illness and round again with the C key', () => {
    const seen = [getSnapshot().botColour.mode]
    for (let i = 0; i < 5; i += 1) {
      cycleBotColour()
      seen.push(getSnapshot().botColour.mode)
    }
    expect(seen).toEqual(['plain', 'bloodline', 'sex', 'trait', 'illness', 'plain'])
  })

  it('keeps the trait while the mode changes, and changes the trait on its own', () => {
    setBotColour({ trait: 'caution' })
    cycleBotColour()
    expect(getSnapshot().botColour).toEqual({ mode: 'bloodline', trait: 'caution' })
  })

  it('does not publish a new object when nothing changed', () => {
    const before = getSnapshot()
    setBotColour({ mode: 'plain' })
    expect(getSnapshot()).toBe(before)
  })

  it('survives a new world (it is a view setting)', async () => {
    setBotColour({ mode: 'sex' })
    resetWorld('another')
    await settled()
    expect(getSnapshot().botColour.mode).toBe('sex')
  })
})
