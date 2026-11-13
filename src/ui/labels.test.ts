import { describe, expect, it } from 'vitest'

import type { DeathCause, EventKind, IntentKind, NodeKind } from '../sim/types.ts'
import { CAUSE_LABEL, CAUSE_SENTENCE, EVENT_LABEL, EVENT_LETTER, INTENT_LABEL, KIND_LABEL, KIND_LETTER, causeSentence, chordWidth, commandLetter, commandName, eventSubject, fertilityLabel, fitLabel } from './labels.ts'
import { tuning } from '../content/index.ts'
import { NODE_LETTER } from './render.ts'

const KINDS: NodeKind[] = ['resource', 'danger', 'shelter', 'ruin', 'water']

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
    const intents: IntentKind[] = ['wander', 'seekFood', 'seekWater', 'flee', 'rest', 'reproduce']
    for (const intent of intents) expect(INTENT_LABEL[intent].length).toBeGreaterThan(0)
    expect(INTENT_LABEL.seekWater).toBe('Seeking water')
  })

  it('names the plague and meteor death causes', () => {
    expect(CAUSE_LABEL.plague).toBe('Plague')
    expect(CAUSE_LABEL.meteor).toBe('Meteor')
  })

  it('words every death cause as one grammatical sentence', () => {
    const expected: Record<DeathCause, string> = {
      starve: 'Died of hunger',
      thirst: 'Died of thirst',
      danger: 'Killed by danger',
      plague: 'Killed by plague',
      meteor: 'Killed by a meteor',
      age: 'Died of old age',
    }
    for (const cause of Object.keys(expected) as DeathCause[]) expect(causeSentence(cause)).toBe(expected[cause])
    expect(causeSentence(undefined)).toBe('Died of hunger')
    for (const cause of Object.keys(CAUSE_LABEL) as DeathCause[]) expect(CAUSE_SENTENCE[cause]).toMatch(/^(Died of|Killed by) /)
  })

  it('gives each world event a marker letter that clashes with no other marker (R D S W B X)', () => {
    const kinds: EventKind[] = ['drought', 'bounty', 'plague', 'meteor']
    const markerLetters = [
      ...(['resource', 'danger', 'shelter', 'water'] as NodeKind[]).map((kind) => commandLetter('placeNode', kind)),
      commandLetter('placeBot'),
      commandLetter('removeNode'),
      ...kinds.map((kind) => commandLetter('triggerEvent', undefined, kind)),
    ]
    expect(markerLetters).toEqual(['R', 'D', 'S', 'W', 'B', 'X', 'H', 'F', 'P', 'M'])
    expect(new Set(markerLetters).size).toBe(markerLetters.length)
    for (const kind of kinds) expect(EVENT_LETTER[kind]).toBe(commandLetter('triggerEvent', undefined, kind))
  })

  it('names the event commands and their log subject', () => {
    expect(commandName('triggerEvent', undefined, 'drought')).toBe('trigger drought')
    expect(EVENT_LABEL.meteor).toBe('Meteor')
    expect(eventSubject({ tick: 5, type: 'event', eventKind: 'plague', x: 0, y: 0 })).toBe('Plague')
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
  })
})
