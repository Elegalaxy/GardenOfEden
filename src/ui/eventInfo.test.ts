import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../content/index.ts'
import { applyCommand } from '../sim/commands.ts'
import { createWorld } from '../sim/world.ts'
import {
  EVENT_INFOS,
  blockedReason,
  effectSummary,
  eventRows,
  formatMult,
  formatTicks,
  globalEventForKey,
  startedMessage,
} from './eventInfo.ts'

const { tuning } = rules

describe('event info', () => {
  it('lists the four events with distinct keys, and only drought and bounty are global', () => {
    expect(EVENT_INFOS.map((info) => info.kind)).toEqual(['drought', 'bounty', 'plague', 'meteor'])
    expect(new Set(EVENT_INFOS.map((info) => info.key)).size).toBe(4)
    expect(EVENT_INFOS.filter((info) => info.global).map((info) => info.kind)).toEqual(['drought', 'bounty'])
    expect(globalEventForKey('d')).toBe('drought')
    expect(globalEventForKey('b')).toBe('bounty')
    expect(globalEventForKey('p')).toBeNull()
    expect(globalEventForKey('1')).toBeNull()
  })

  it('formats numbers the way the panels show them', () => {
    expect(formatTicks(1500)).toBe('1,500 ticks')
    expect(formatTicks(-3)).toBe('0 ticks')
    expect(formatMult(0.35)).toBe('×0.35')
    expect(formatMult(3)).toBe('×3')
  })

  it('builds the cards from tuning, so the numbers shown are the numbers used', () => {
    expect(effectSummary('drought', tuning)).toBe(`food regrowth ×${tuning.events.drought.regrowMult}`)
    expect(eventRows('plague', tuning)).toEqual([
      { label: 'Lasts', value: `${tuning.events.plague.duration} ticks` },
      { label: 'Effect', value: `−${tuning.events.plague.damage} health / tick within ${tuning.events.plague.radius} cells` },
    ])
    expect(eventRows('meteor', tuning)[0]!.value).toContain('instant')
    expect(eventRows('bounty', tuning)[0]).toEqual({ label: 'Lasts', value: '1,000 ticks' })
  })

  it('explains why an event is blocked, and says nothing when it is free', () => {
    const world = createWorld('a', edenPreset, rules)
    expect(blockedReason(world, rules, 'drought')).toBeNull()
    expect(blockedReason(world, rules, 'plague')).toBeNull()
    applyCommand(world, rules, { type: 'triggerEvent', event: 'drought' })
    expect(blockedReason(world, rules, 'drought')).toContain('already active')
    expect(blockedReason(world, rules, 'bounty')).toBeNull()
    applyCommand(world, rules, { type: 'triggerEvent', event: 'bounty' })
    applyCommand(world, rules, { type: 'triggerEvent', event: 'plague', x: 10, y: 10 })
    expect(blockedReason(world, rules, 'plague')).toContain('Too many world events')
    expect(blockedReason(world, rules, 'meteor')).toBeNull()
  })

  it('words the notices for each event', () => {
    expect(startedMessage({ type: 'triggerEvent', event: 'bounty' }, tuning, 0)).toBe(
      'Bounty started: food regrowth ×3 for 1,000 ticks.',
    )
    expect(startedMessage({ type: 'triggerEvent', event: 'plague', x: 12.5, y: 7.5 }, tuning, 0)).toContain('Plague started at 12.5, 7.5')
    expect(startedMessage({ type: 'triggerEvent', event: 'meteor', x: 1.5, y: 2.5 }, tuning, 1)).toContain('1 bot killed')
    expect(startedMessage({ type: 'triggerEvent', event: 'meteor', x: 1.5, y: 2.5 }, tuning, 3)).toContain('3 bots killed')
  })
})
