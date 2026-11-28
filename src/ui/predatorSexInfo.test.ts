import { describe, expect, it } from 'vitest'

import { edenPreset, featureRules } from '../content/index.ts'
import { createWorld } from '../sim/world.ts'
import { loneBreeding, predatorBornPhrase, predatorLifeInfo, predatorSexHint } from './predatorInfo.ts'

// Predator sexes as the page words them (an experimental rule).

const run = featureRules(['predatorSexes'])
const { tuning } = run
const world = createWorld('a', edenPreset, run)
const predators = world.nodes.filter((node) => node.kind === 'predator')
const female = predators.find((node) => node.hunt!.sex === 'female')!.hunt!
const male = predators.find((node) => node.hunt!.sex === 'male')!.hunt!
const info = (hunt: typeof female, sexState = { lone: false, noMate: false }) => predatorLifeInfo(hunt, tuning, 3, 80, sexState)!

describe('the next cub with predator sexes', () => {
  it('uses the kills of a pair and says males bear none', () => {
    expect(info(female)).toMatchObject({ killsPerCub: tuning.predator.sexes.killsPerCub, cubBlock: 'kills' })
    expect(info(male).cubBlock).toBe('male')
  })

  it('names a missing mate for a ready female, and drops both rules for a lone parent', () => {
    const life = { ...female.life!, kidsKills: 9, age: tuning.predator.ecology.adultAge, energy: tuning.predator.ecology.maxEnergy }
    const ready = { ...female, life }
    expect(info(ready).cubBlock).toBeNull()
    expect(info(ready, { lone: false, noMate: true }).cubBlock).toBe('mate')
    expect(info(ready, { lone: true, noMate: true }).cubBlock).toBeNull()
    expect(info(male, { lone: true, noMate: false }).cubBlock).toBe('kills')
  })

  it('counts a world as lone only after loneAfter ticks of one sex', () => {
    const ecology = { sexes: { oneSexSince: 100, mated: 0, alone: 0 } }
    expect(loneBreeding(ecology, 100 + tuning.predator.sexes.loneAfter - 1, tuning)).toBe(false)
    expect(loneBreeding(ecology, 100 + tuning.predator.sexes.loneAfter, tuning)).toBe(true)
    expect(loneBreeding(world.ecology, 5000, tuning)).toBe(false)
    expect(loneBreeding(undefined, 5000, tuning)).toBe(false)
  })
})

describe('predator sex wording', () => {
  it('sums up the sexes and cubs', () => {
    expect(predatorSexHint(world.nodes, { sexes: { oneSexSince: null, mated: 3, alone: 1 } })).toBe('3 F · 2 M, cubs of pairs 3, lone 1.')
    expect(predatorSexHint(world.nodes, {})).toBe('')
  })

  it('says whether a living cub came from a pair', () => {
    const cub = { ...female.life!, origin: 'cub' as const, parentId: 1 }
    expect(predatorBornPhrase({ sex: 'female', life: { ...cub, fatherId: 3 } })).toBe('born to a pair')
    expect(predatorBornPhrase({ sex: 'female', life: cub })).toBe('born alone')
    expect(predatorBornPhrase({ life: cub })).toBe('born')
    expect(predatorBornPhrase(female)).toBe('born')
    expect(predatorBornPhrase(undefined)).toBe('born')
  })
})
