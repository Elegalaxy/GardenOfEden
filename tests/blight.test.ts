import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { stateHash } from '../src/sim/hash.ts'
import { step } from '../src/sim/step.ts'
import { createWorld } from '../src/sim/world.ts'

// Blight (B1) must not move an event-free run: Eden seeds a and b on the shipped rules, measured on main before the blight change.

describe('pins without a blight', () => {
  it('leaves Eden seed a at 5,000 ticks bit-identical', () => {
    const world = createWorld('a', edenPreset, rules)
    while (world.tick < 5000) step(world, rules)
    expect(stateHash(world)).toBe('731f770400f210aa')
    expect(world.rng).toEqual({
      world: { a: 3688263227, b: 3154447763, c: 1166763587, d: 3567969820 },
      ai: { a: 3770057721, b: 97827464, c: 51461658, d: 2412737640 },
      birth: { a: 380217656, b: 2732393019, c: 2193901339, d: 1463745650 },
      gene: { a: 3850647471, b: 3358185439, c: 2081543315, d: 3659276644 },
      predator: { a: 2349682960, b: 3235739550, c: 3616504036, d: 1357575783 },
    })
  })

  it('leaves Eden seed b at 20,000 ticks bit-identical', { timeout: 600_000 }, () => {
    const world = createWorld('b', edenPreset, rules)
    while (world.tick < 20000) step(world, rules)
    expect(stateHash(world)).toBe('be462fac79aff2af')
    expect(world.rng).toEqual({
      world: { a: 2108544604, b: 724006586, c: 3541576535, d: 3500638388 },
      ai: { a: 1188429527, b: 703103133, c: 1122700521, d: 1383984525 },
      birth: { a: 125994490, b: 546493350, c: 1333955491, d: 3188211926 },
      gene: { a: 1092691059, b: 4225256307, c: 113804040, d: 4005965665 },
      predator: { a: 3978175041, b: 1841855835, c: 2416030862, d: 2899171380 },
    })
  })
})
