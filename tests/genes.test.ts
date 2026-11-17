import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../src/content/index.ts'
import { childHue, goldenHue, wrapHue } from '../src/sim/genes.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { createRng } from '../src/sim/rng.ts'
import { step } from '../src/sim/step.ts'
import type { Tuning, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { asexual, edenWithDanger, neutralTraits, noCone, noSeasons } from './variants.ts'

// Bloodline colour gene (M20): hue helpers, founders, inheritance with drift, replay, and proof that
// the gene stream changes no behaviour (Eden seeds a and b match the numbers recorded before M20).

const withDrift = (drift: number): Pick<Tuning, 'gene'> => ({ gene: { drift } })

function run(seed: string, ticks: number): World {
  const world = createWorld(seed, edenPreset, rules)
  for (let i = 0; i < ticks; i += 1) step(world, rules)
  return world
}

/** Smallest distance between two hues on the circle, in degrees. */
function gap(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 360 - d)
}

describe('wrapHue', () => {
  it('keeps hues in 0 up to 360', () => {
    expect(wrapHue(0)).toBe(0)
    expect(wrapHue(359.5)).toBe(359.5)
    expect(wrapHue(360)).toBe(0)
    expect(wrapHue(725)).toBe(5)
    expect(wrapHue(-10)).toBe(350)
    expect(wrapHue(-360)).toBe(0)
    expect(wrapHue(-720.5)).toBe(359.5)
  })

  it('never returns 360 for a tiny negative input', () => {
    const h = wrapHue(-1e-17)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(360)
  })
})

describe('goldenHue', () => {
  it('gives the first 60 indices distinct hues in range', () => {
    const seen = new Set<number>()
    for (let n = 0; n < 60; n += 1) {
      const h = goldenHue(n)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
      seen.add(h)
    }
    expect(seen.size).toBe(60)
  })
})

describe('childHue', () => {
  it('stays within drift of one parent, including across the 0/360 wrap', () => {
    const stream = createRng('hue').gene
    for (let i = 0; i < 500; i += 1) {
      const child = childHue(358, 3, withDrift(6), stream)
      expect(child).toBeGreaterThanOrEqual(0)
      expect(child).toBeLessThan(360)
      expect(Math.min(gap(child, 358), gap(child, 3))).toBeLessThanOrEqual(6)
    }
  })

  it('takes each parent sometimes', () => {
    const stream = createRng('hue2').gene
    let mother = 0
    let father = 0
    for (let i = 0; i < 400; i += 1) {
      const child = childHue(100, 200, withDrift(6), stream)
      if (gap(child, 100) <= 6) mother += 1
      else if (gap(child, 200) <= 6) father += 1
    }
    expect(mother).toBeGreaterThan(100)
    expect(father).toBeGreaterThan(100)
    expect(mother + father).toBe(400)
  })

  it('copies a parent exactly when drift is 0', () => {
    const stream = createRng('hue3').gene
    for (let i = 0; i < 50; i += 1) {
      const child = childHue(12.345, 301.5, withDrift(0), stream)
      expect(child === 12.345 || child === 301.5).toBe(true)
    }
  })

  it('draws one number for an asexual child and two for a sexual one', () => {
    const a = createRng('d').gene
    childHue(10, null, withDrift(6), a)
    const b = createRng('d').gene
    childHue(10, 20, withDrift(6), b)
    const ref = createRng('d').gene
    // sfc32 bumps its counter `d` by one per draw.
    expect(a.d - ref.d).toBe(1)
    expect(b.d - ref.d).toBe(2)
  })
})

describe('hues in a world', () => {
  it('gives founders distinct golden hues and records them', () => {
    const world = createWorld('founders', edenPreset, rules)
    const hues = world.bots.map((bot) => bot.hue)
    expect(new Set(hues).size).toBe(hues.length)
    world.bots.forEach((bot, i) => {
      expect(bot.hue).toBe(goldenHue(i))
      expect(world.lineage[i]!.hue).toBe(bot.hue)
    })
  })

  it('gives a placed bot the golden hue of its id, with no random draw', () => {
    const world = createWorld('placed', edenPreset, rules)
    const before = structuredClone(world.rng.gene)
    const res = applyCommand(world, rules, { type: 'placeBot', x: 10, y: 10 })
    expect(res.ok).toBe(true)
    const bot = world.bots[world.bots.length - 1]!
    expect(bot.hue).toBe(goldenHue(bot.id))
    expect(world.rng.gene).toEqual(before)
  })

  it('hands hues down: every child is within drift of one of its parents', () => {
    const world = run('family', 3000)
    expect(world.totalBirths).toBeGreaterThan(20)
    const byId = new Map(world.lineage.map((r) => [r.id, r]))
    let checked = 0
    for (const rec of world.lineage) {
      if (rec.parentId === null) continue
      const mother = byId.get(rec.parentId)
      const father = rec.fatherId === null ? undefined : byId.get(rec.fatherId)
      if (mother === undefined || (rec.fatherId !== null && father === undefined)) continue
      const near = Math.min(gap(rec.hue, mother.hue), father === undefined ? 360 : gap(rec.hue, father.hue))
      expect(near).toBeLessThanOrEqual(rules.tuning.gene.drift + 1e-9)
      checked += 1
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('works with the sexes off (one parent, one draw)', () => {
    const r = asexual(rules)
    const world = createWorld('solo', edenPreset, r)
    for (let i = 0; i < 2000; i += 1) step(world, r)
    expect(world.totalBirths).toBeGreaterThan(5)
    for (const bot of world.bots) {
      expect(bot.hue).toBeGreaterThanOrEqual(0)
      expect(bot.hue).toBeLessThan(360)
    }
  })

  it('replays to the same hash', () => {
    const world = createWorld('replay', edenPreset, rules)
    for (let i = 0; i < 1500; i += 1) step(world, rules)
    applyCommand(world, rules, { type: 'placeBot', x: 20, y: 20 })
    for (let i = 0; i < 1500; i += 1) step(world, rules)
    const again = replayWorld('replay', edenPreset, rules, world.commands, world.tick)
    expect(stateHash(again)).toBe(stateHash(world))
  })

  it('leaves behaviour alone: Eden at 5000 ticks matches the numbers from before M20', () => {
    // On Eden as it was before M21b (`edenWithDanger`): the recorded numbers belong to that map.
    const old = (seed: string): World => {
      // Without seasons (S2): the recorded numbers come from a world with a fixed regrowth rate.
      const neutral = noCone(noSeasons(neutralTraits(rules))) // and without the V2 vision cone
      const world = createWorld(seed, edenWithDanger(), neutral)
      for (let i = 0; i < 5000; i += 1) step(world, neutral)
      return world
    }
    // Re-pinned in M22 on `neutralTraits` (was [70, 299] and [67, 277]): the four new traits have no effect there,
    // but the birth stream takes 12 more draws per child, so the world is a different roll of the same rules.
    const a = old('a')
    expect([a.bots.length, a.totalBirths]).toEqual([66, 300])
    const b = old('b')
    expect([b.bots.length, b.totalBirths]).toEqual([75, 294])
  })
})
