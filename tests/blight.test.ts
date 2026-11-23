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
    expect(stateHash(world)).toBe('03cc23ee3c4d0701')
    expect(world.rng).toEqual({
      world: { a: 4041835896, b: 1899320074, c: 4088289150, d: 3567969942 },
      ai: { a: 321916596, b: 2610628031, c: 3134457327, d: 2412767411 },
      birth: { a: 1289067818, b: 779964505, c: 4112049781, d: 1463747834 },
      gene: { a: 3872702325, b: 2792906123, c: 2495194922, d: 3659276800 },
      predator: { a: 3274643797, b: 1042723523, c: 3442147681, d: 1357584517 },
    })
  })

  it('leaves Eden seed b at 20,000 ticks bit-identical', { timeout: 600_000 }, () => {
    const world = createWorld('b', edenPreset, rules)
    while (world.tick < 20000) step(world, rules)
    expect(stateHash(world)).toBe('a44d483eff987840')
    expect(world.rng).toEqual({
      world: { a: 1846205129, b: 4169043728, c: 2857540989, d: 3500638510 },
      ai: { a: 1309321463, b: 4173848300, c: 2551022459, d: 1384168370 },
      birth: { a: 322622143, b: 1613824137, c: 3343008496, d: 3188233374 },
      gene: { a: 2175261815, b: 4178708600, c: 1156174852, d: 4005967197 },
      predator: { a: 1664120539, b: 560783549, c: 2628320706, d: 2899233424 },
    })
  })
})
