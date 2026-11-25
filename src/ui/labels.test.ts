import { describe, expect, it } from 'vitest'

import type { DeathCause, EventKind, IntentKind, NodeKind } from '../sim/types.ts'
import { CAUSE_LABEL, illnessLabel, CAUSE_SENTENCE, EVENT_LABEL, EVENT_LETTER, INTENT_LABEL, KIND_LABEL, KIND_LETTER, causeSentence, chordWidth, commandLetter, commandName, eventSubject, fertilityLabel, fitLabel, inbreedingLabel, featureNames, inbredBirthsLabel, intentLabel, memoryCapacity, predatorActivity, sightText } from './labels.ts'
import { tuning } from '../content/index.ts'
import { NODE_LETTER } from './render.ts'

const KINDS: NodeKind[] = ['resource', 'danger', 'shelter', 'ruin', 'water', 'predator']

describe('labels', () => {
  it('gives every node kind its own letter, the same on the map and in the legend', () => {
    const letters = KINDS.map((kind) => KIND_LETTER[kind])
    expect(new Set(letters).size).toBe(KINDS.length)
    expect(KIND_LETTER.water).toBe('W')
    for (const kind of KINDS) expect(NODE_LETTER[kind]).toBe(KIND_LETTER[kind])
  })

  it('names water and its command', () => {
    expect(KIND_LABEL.water).toBe('water')
    expect(commandLetter('placeNode', 'water')).toBe('W')
    expect(commandName('placeNode', 'water')).toBe('place water')
    expect(commandName('removeNode', 'water')).toBe('remove water')
    expect(eventSubject({ tick: 1, type: 'command', command: 'placeNode', nodeKind: 'water', nodeId: 12, x: 0, y: 0 })).toBe('Water #12')
  })

  it('labels the thirst death cause and the seek-water goal', () => {
    const causes: DeathCause[] = ['starve', 'thirst', 'danger', 'plague', 'meteor', 'age']
    for (const cause of causes) expect(CAUSE_LABEL[cause].length).toBeGreaterThan(0)
    expect(CAUSE_LABEL.thirst).toBe('Thirst')
    const intents: IntentKind[] = ['wander', 'seekFood', 'seekWater', 'flee', 'rest', 'reproduce', 'seekMate']
    for (const intent of intents) expect(INTENT_LABEL[intent].length).toBeGreaterThan(0)
    expect(INTENT_LABEL.seekWater).toBe('Seeking water')
  })

  it('calls the internal danger kind a crater and a fleeing bot names what it flees', () => {
    expect(KIND_LABEL.danger).toBe('crater')
    expect(CAUSE_LABEL.danger).toBe('Crater')
    expect(intentLabel('flee', { kind: 'predator' })).toBe('Fleeing a predator')
    expect(intentLabel('flee', { kind: 'danger' })).toBe('Fleeing a crater')
    expect(intentLabel('flee')).toBe('Fleeing danger')
    expect(intentLabel('seekFood', { kind: 'resource' })).toBe('Seeking food')
  })

  it('names the plague and meteor death causes', () => {
    expect(CAUSE_LABEL.plague).toBe('Plague')
    expect(CAUSE_LABEL.meteor).toBe('Meteor')
  })

  it('words every death cause as one grammatical sentence', () => {
    const expected: Record<DeathCause, string> = {
      starve: 'Died of hunger',
      thirst: 'Died of thirst',
      danger: 'Killed in a meteor crater',
      plague: 'Killed by plague',
      meteor: 'Killed by a meteor',
      predator: 'Killed by a predator',
      age: 'Died of old age',
      poison: 'Poisoned by toxic food',
      disease: 'Died of disease',
    }
    for (const cause of Object.keys(expected) as DeathCause[]) expect(causeSentence(cause)).toBe(expected[cause])
    expect(causeSentence(undefined)).toBe('Died of hunger')
    for (const cause of Object.keys(CAUSE_LABEL) as DeathCause[]) expect(CAUSE_SENTENCE[cause]).toMatch(/^(Died of|Killed by|Killed in|Poisoned by) /)
  })

  it('gives each world event a marker letter that clashes with no other marker (R V S W B X)', () => {
    const kinds: EventKind[] = ['drought', 'bounty', 'plague', 'meteor', 'blight', 'outbreak']
    const markerLetters = [
      ...(['resource', 'predator', 'shelter', 'water'] as NodeKind[]).map((kind) => commandLetter('placeNode', kind)),
      commandLetter('placeBot'),
      commandLetter('removeNode'),
      ...kinds.map((kind) => commandLetter('triggerEvent', undefined, kind)),
    ]
    expect(markerLetters).toEqual(['R', 'V', 'S', 'W', 'B', 'X', 'H', 'F', 'P', 'M', 'L', 'I'])
    expect(new Set(markerLetters).size).toBe(markerLetters.length)
    for (const kind of kinds) expect(EVENT_LETTER[kind]).toBe(commandLetter('triggerEvent', undefined, kind))
  })

  it('names the event commands and their log subject', () => {
    expect(commandName('triggerEvent', undefined, 'drought')).toBe('trigger drought')
    expect(EVENT_LABEL.meteor).toBe('Meteor')
    expect(eventSubject({ tick: 5, type: 'event', eventKind: 'plague', x: 0, y: 0 })).toBe('Plague')
  })
})

describe('illnessLabel (D3)', () => {
  it('says healthy for no stage, and the ticks left or the dose when the full record is known', () => {
    expect(illnessLabel(undefined, undefined, 100, 5)).toBe('Healthy')
    expect(illnessLabel('sick', { dose: 5, until: 220 }, 100, 5)).toBe('Sick, 120 ticks left')
    expect(illnessLabel('sick', { dose: 5, until: 101 }, 100, 5)).toBe('Sick, 1 tick left')
    expect(illnessLabel('immune', { dose: 0, until: 1000 }, 100, 5)).toBe('Immune, 900 left')
    expect(illnessLabel('immune', { dose: 0, until: 2100 }, 100, 5)).toBe('Immune, 2,000 left')
    expect(illnessLabel('exposed', { dose: 3, until: 0 }, 100, 5)).toBe('Exposed 3 / 5')
  })

  it('never shows negative ticks, and falls back to the bare stage without the record', () => {
    expect(illnessLabel('sick', { dose: 5, until: 90 }, 100, 5)).toBe('Sick, 0 ticks left')
    expect(illnessLabel('sick', undefined, 100, 5)).toBe('Sick')
    expect(illnessLabel('immune', undefined, 100, 5)).toBe('Immune')
    expect(illnessLabel('exposed', undefined, 100, 5)).toBe('Exposed')
  })
})

describe('fitLabel', () => {
  const measure = (text: string): number => text.length * 7

  it('takes the longest candidate that fits', () => {
    const candidates = ['P PLAGUE 800', 'P 800', 'P']
    expect(fitLabel(candidates, 100, measure)).toBe('P PLAGUE 800')
    expect(fitLabel(candidates, 40, measure)).toBe('P 800')
    expect(fitLabel(candidates, 8, measure)).toBe('P')
  })

  it('returns null when nothing fits, so the label is left out', () => {
    expect(fitLabel(['P PLAGUE 800', 'P'], 5, measure)).toBeNull()
    expect(fitLabel([], 100, measure)).toBeNull()
  })
})

describe('chordWidth', () => {
  it('is the diameter through the centre and shrinks toward the edge', () => {
    expect(chordWidth(10, 0)).toBe(20)
    expect(chordWidth(10, 6)).toBeCloseTo(16)
    expect(chordWidth(10, -6)).toBeCloseTo(16)
    expect(chordWidth(10, 10)).toBe(0)
    expect(chordWidth(10, 12)).toBe(0)
  })

  it('labels fertility by age with a percent and a phase', () => {
    const { adultAge } = tuning.bot
    const { primeAge, declineAge, fertileUntil } = tuning.fertility
    expect(fertilityLabel(0, tuning)).toEqual({ percent: 0, phase: 'young' })
    expect(fertilityLabel(adultAge, tuning)).toEqual({ percent: Math.round(100 * tuning.fertility.startFraction), phase: 'rising' })
    expect(fertilityLabel(primeAge, tuning)).toEqual({ percent: 100, phase: 'prime' })
    expect(fertilityLabel(declineAge, tuning)).toEqual({ percent: 100, phase: 'declining' })
    expect(fertilityLabel((declineAge + fertileUntil) / 2, tuning)).toEqual({ percent: 50, phase: 'declining' })
    expect(fertilityLabel(fertileUntil, tuning)).toEqual({ percent: 0, phase: 'past' })
    // M22: a longevity of 1.2 stretches every threshold, so the same age is earlier in life.
    expect(fertilityLabel(adultAge, tuning, 1.2)).toEqual({ percent: 0, phase: 'young' })
    expect(fertilityLabel(adultAge * 1.2, tuning, 1.2)).toEqual({ percent: Math.round(100 * tuning.fertility.startFraction), phase: 'rising' })
    expect(fertilityLabel(fertileUntil, tuning, 1.2).phase).toBe('declining')
    expect(fertilityLabel(fertileUntil * 1.2, tuning, 1.2)).toEqual({ percent: 0, phase: 'past' })
  })

  it('formats the inbred births share', () => {
    expect(inbredBirthsLabel(0, 0)).toBe('—')
    expect(inbredBirthsLabel(0, 40)).toBe('0.0%')
    expect(inbredBirthsLabel(1, 8)).toBe('12.5%')
    expect(inbredBirthsLabel(184, 1000)).toBe('18.4%')
  })

  it('labels the inbreeding score', () => {
    expect(inbreedingLabel(0)).toBe('No')
    expect(inbreedingLabel(0.5)).toBe('Yes · 50%')
    expect(inbreedingLabel(1)).toBe('Yes · 100%')
  })
})

describe('predatorActivity', () => {
  it('reads resting first, then hunting, else prowling', () => {
    expect(predatorActivity({ targetId: 4, restUntil: 100 }, 90)).toEqual({ kind: 'resting', ticksLeft: 10 })
    expect(predatorActivity({ targetId: 4, restUntil: 100 }, 100)).toEqual({ kind: 'resting', ticksLeft: 0 })
    expect(predatorActivity({ targetId: 4, restUntil: 100 }, 101)).toEqual({ kind: 'hunting', targetId: 4 })
    expect(predatorActivity({ targetId: null, restUntil: 0 }, 5)).toEqual({ kind: 'prowling' })
    expect(predatorActivity(null, 5)).toEqual({ kind: 'prowling' })
  })

  it('reads sated after resting and before hunting (E3)', () => {
    expect(predatorActivity({ targetId: 4, restUntil: 100 }, 101, true)).toEqual({ kind: 'sated' })
    expect(predatorActivity({ targetId: null, restUntil: 0 }, 5, true)).toEqual({ kind: 'sated' })
    expect(predatorActivity({ targetId: 4, restUntil: 100 }, 90, true)).toEqual({ kind: 'resting', ticksLeft: 10 })
    expect(predatorActivity(null, 5, true)).toEqual({ kind: 'prowling' })
    expect(predatorActivity({ targetId: 4, restUntil: 0 }, 5, false)).toEqual({ kind: 'hunting', targetId: 4 })
  })

  it('sums the three memory slot classes', () => {
    expect(memoryCapacity(tuning.memory)).toBe(tuning.memory.cap + tuning.memory.waterCap + tuning.memory.predatorCap)
  })
})

describe('sightText', () => {
  it('gives ahead and behind with one decimal', () => {
    expect(sightText(6, 1, 0.7, true)).toBe('6.0 ahead · 4.2 behind (cells)')
    expect(sightText(8, 1, 0.35, true)).toBe('8.0 ahead · 2.8 behind (cells)')
  })

  it('gives one number with the cone off', () => {
    expect(sightText(6, 1, 0.7, false)).toBe('6.0 all round (cells)')
  })

  it('follows the real tuning', () => {
    const { botFront, botRear } = tuning.perception.cone
    expect(sightText(tuning.traits.senseRadius, botFront, botRear, true)).toContain('ahead')
  })
})

describe('featureNames', () => {
  it('lists the names of the experimental rules in canonical order', () => {
    expect(featureNames([])).toBe('')
    expect(featureNames(['poison'])).toBe('Toxic food')
    expect(featureNames(['culture', 'poison'])).toBe('Toxic food, Culture')
  })
})
