import { describe, expect, it } from 'vitest'

import { edenPreset, findPreset, presets, rules, SIM_VERSION } from '../src/content/index.ts'
import { makeScript } from '../src/harness/script.ts'
import { decodeSave, encodeSave, makeSave } from '../src/persist/save.ts'
import { decodeShare, encodeShareLegacy } from '../src/persist/share.ts'
import { applyCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { checkScript } from '../src/sim/scenario.ts'
import { step } from '../src/sim/step.ts'
import type { Preset, ScriptEntry } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'

// Scenario presets: a preset script is applied by the sim itself (unrecorded), the plain worlds keep their hashes,
// and saves and replays need no new format.

/** Eden seed a at 5,000 ticks and seed b at 20,000 (the same values tests/disease.test.ts pins). */
const PIN_A_5000 = '03cc23ee3c4d0701'
const PIN_B_20000 = 'a44d483eff987840'

const SCENARIOS = presets.filter((preset) => preset.id !== 'eden' && preset.id !== 'blank')
const SCRIPTED = SCENARIOS.filter((preset) => preset.script !== undefined)
const SEEDS = ['a', 'b']

function bare(preset: Preset): Preset {
  const { script: _script, ...rest } = preset
  return rest
}

describe('plain worlds', () => {
  it('keeps Eden seed a at 5,000 ticks bit-identical', () => {
    const w = createWorld('a', edenPreset, rules)
    while (w.tick < 5000) step(w, rules)
    expect(stateHash(w)).toBe(PIN_A_5000)
    expect(w.script).toBeUndefined()
  })

  it('keeps Eden seed b at 20,000 ticks bit-identical', { timeout: 600_000 }, () => {
    const w = createWorld('b', edenPreset, rules)
    while (w.tick < 20000) step(w, rules)
    expect(stateHash(w)).toBe(PIN_B_20000)
  })
})

describe('scenario list', () => {
  it('has the five scenarios, each with a description and a valid script', () => {
    expect(SCENARIOS.map((preset) => preset.id)).toEqual(['quiet', 'plague-world', 'drought-bounty', 'predator-heavy', 'hard-times'])
    for (const preset of SCENARIOS) {
      expect(preset.description?.length ?? 0).toBeGreaterThan(10)
      expect(() => checkScript(preset)).not.toThrow()
      expect(findPreset(preset.id)).toBe(preset)
    }
  })

  it('keeps the predator count within the cap', () => {
    for (const preset of SCENARIOS) {
      const predators = preset.nodes.filter((node) => node.kind === 'predator').length
      expect(predators).toBeLessThanOrEqual(rules.tuning.predator.maxCount)
    }
  })
})

describe('scenario script', () => {
  for (const preset of SCRIPTED) {
    it(`${preset.id}: the sim applies it like the harness script, with no refusals`, { timeout: 600_000 }, () => {
      for (const seed of SEEDS) {
        const a = createWorld(seed, preset, rules)
        expect(a.script).toHaveLength(preset.script!.length)
        while (a.tick < 20000) step(a, rules)

        const b = createWorld(seed, bare(preset), rules)
        const script = makeScript(preset.script!)
        const refused: string[] = []
        refused.push(...script.due(b, rules))
        while (b.tick < 20000) {
          step(b, rules)
          refused.push(...script.due(b, rules))
        }
        expect(refused).toEqual([])
        expect(a.bots.length).toBe(b.bots.length)
        expect(a.deathsByCause).toEqual(b.deathsByCause)
        expect(a.totalBirths).toBe(b.totalBirths)
        expect(a.script).toBeUndefined()
        expect(a.commands).toEqual([])
      }
    })
  }

  it('a scenario without events has no script key', () => {
    for (const preset of SCENARIOS.filter((p) => p.script === undefined)) {
      expect(createWorld('a', preset, rules)).not.toHaveProperty('script')
    }
  })

  it('does not share entries with the preset', () => {
    const preset = findPreset('plague-world')!
    const w = createWorld('a', preset, rules)
    for (let i = 0; i < 3100; i += 1) step(w, rules)
    expect(w.script).toHaveLength(2)
    expect(preset.script).toHaveLength(3)
  })

  it('a replay with a player command mixed in matches the live run, and only that command is recorded', { timeout: 600_000 }, () => {
    const preset = findPreset('hard-times')!
    const live = createWorld('a', preset, rules)
    while (live.tick < 5000) step(live, rules)
    expect(applyCommand(live, rules, { type: 'placeBot', x: 30, y: 30 }).ok).toBe(true)
    while (live.tick < 6100) step(live, rules)
    // The scripted plague (tick 6,000) is in the log like any event (the log is a ring buffer, so look right after it).
    expect(live.log.some((event) => event.type === 'command' && event.eventKind === 'plague' && event.tick === 6000)).toBe(true)
    while (live.tick < 12000) step(live, rules)
    expect(live.commands).toEqual([{ tick: 5000, cmd: { type: 'placeBot', x: 30, y: 30 } }])

    const replayed = replayWorld('a', preset, rules, live.commands, 12000)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })
})

describe('checkScript', () => {
  const base = { id: 't' }
  const entry = (tick: number): ScriptEntry => ({ tick, cmd: { type: 'triggerEvent', event: 'drought' } })

  it('rejects tick 0, fractions and decreasing ticks', () => {
    expect(() => checkScript({ ...base, script: [entry(0)] })).toThrow(/whole number >= 1/)
    expect(() => checkScript({ ...base, script: [entry(2.5)] })).toThrow(/whole number >= 1/)
    expect(() => checkScript({ ...base, script: [entry(500), entry(400)] })).toThrow(/not decrease/)
    expect(() => checkScript({ ...base, script: [entry(400), entry(400)] })).not.toThrow()
  })

  it('rejects a command that is not a triggerEvent', () => {
    const bad = [{ tick: 10, cmd: { type: 'placeBot', x: 1, y: 1 } }] as unknown as ScriptEntry[]
    expect(() => checkScript({ ...base, script: bad })).toThrow(/only triggerEvent/)
  })

  it('createWorld refuses a bad script', () => {
    expect(() => createWorld('a', { ...edenPreset, script: [entry(0)] }, rules)).toThrow()
  })
})

describe('scenario save', () => {
  it('round-trips through a save file and a share link, and replays to the same hash', async () => {
    const preset = findPreset('plague-world')!
    const live = createWorld('c', preset, rules)
    while (live.tick < 3500) step(live, rules)
    applyCommand(live, rules, { type: 'placeBot', x: 20, y: 20 })
    while (live.tick < 4000) step(live, rules)
    const save = makeSave({ seed: live.seed, tick: live.tick, commands: live.commands }, preset.id, stateHash(live), SIM_VERSION)
    expect(save.presetId).toBe('plague-world')
    expect(save.commands).toHaveLength(1)

    const fromFile = decodeSave(encodeSave(save))
    expect(fromFile.ok).toBe(true)
    const encoded = encodeShareLegacy(save)
    expect(encoded.ok).toBe(true)
    if (!fromFile.ok || !encoded.ok) return
    const fromLink = await decodeShare(encoded.payload, 'plain')
    expect(fromLink.ok).toBe(true)
    if (!fromLink.ok) return

    for (const loaded of [fromFile.save, fromLink.save]) {
      expect(loaded.presetId).toBe('plague-world')
      const rebuilt = replayWorld(loaded.seed, findPreset(loaded.presetId)!, rules, loaded.commands, loaded.tick)
      expect(stateHash(rebuilt)).toBe(loaded.hash)
    }
  })
})
