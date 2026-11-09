import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import { createWorld } from '../src/sim/world.ts'
import { makeScript, parseEventSpec } from '../src/harness/script.ts'
import { surveySeed } from '../src/harness/survey.ts'

// The harness can apply scripted world events (`--event drought@3000`).

describe('parseEventSpec', () => {
  it('reads a global event and an area event', () => {
    expect(parseEventSpec('drought@3000')).toEqual({ tick: 3000, cmd: { type: 'triggerEvent', event: 'drought' } })
    expect(parseEventSpec('bounty@0')).toEqual({ tick: 0, cmd: { type: 'triggerEvent', event: 'bounty' } })
    expect(parseEventSpec('plague@6000:48,32.5')).toEqual({
      tick: 6000,
      cmd: { type: 'triggerEvent', event: 'plague', x: 48, y: 32.5 },
    })
    expect(parseEventSpec('meteor@5000:30,20')).toMatchObject({ cmd: { event: 'meteor', x: 30, y: 20 } })
  })

  it('rejects bad input with a readable message', () => {
    expect(() => parseEventSpec(undefined)).toThrow(/--event must look like/)
    expect(() => parseEventSpec('drought')).toThrow(/--event must look like/)
    expect(() => parseEventSpec('flood@10')).toThrow(/kind must be one of/)
    expect(() => parseEventSpec('plague@10')).toThrow(/needs a place/)
    expect(() => parseEventSpec('drought@10:1,2')).toThrow(/global/)
    expect(() => parseEventSpec('drought@-5')).toThrow()
    expect(() => parseEventSpec('drought@9999999')).toThrow(/whole number/)
  })
})

describe('makeScript', () => {
  it('applies each command when the world reaches its tick, in tick order, and reports refusals', () => {
    const script = makeScript([
      parseEventSpec('bounty@20'),
      parseEventSpec('drought@10'),
      parseEventSpec('drought@15'),
      parseEventSpec('meteor@5:999,999'),
    ])
    const world = createWorld('a', edenPreset, rules)
    const refused: string[] = []
    for (let i = 0; i < 30; i += 1) {
      refused.push(...script.due(world, rules))
      step(world, rules)
    }
    expect(world.commands.map((entry) => [entry.tick, entry.cmd.type === 'triggerEvent' ? entry.cmd.event : ''])).toEqual([
      [10, 'drought'],
      [20, 'bounty'],
    ])
    expect(refused).toHaveLength(2)
    expect(refused[0]).toContain('tick 5: meteor refused')
    expect(refused[1]).toContain('tick 15: drought refused: Drought is already active')
  })

  it('gives a survey run the same state as replaying the commands, and a different one from a control run', () => {
    const result = surveySeed('a', edenPreset, rules, 1500, 100, [parseEventSpec('drought@500')])
    expect(result.refused).toEqual([])
    const replayed = replayWorld('a', edenPreset, rules, [parseEventSpec('drought@500')], 1500)
    expect(result.hash).toBe(stateHash(replayed))
    expect(result.hash).not.toBe(surveySeed('a', edenPreset, rules, 1500, 100).hash)
  })
})
