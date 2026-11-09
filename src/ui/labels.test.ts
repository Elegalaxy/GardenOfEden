import { describe, expect, it } from 'vitest'

import type { DeathCause, IntentKind, NodeKind } from '../sim/types.ts'
import { CAUSE_LABEL, INTENT_LABEL, KIND_LABEL, KIND_LETTER, commandLetter, commandName, eventSubject } from './labels.ts'
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
    const causes: DeathCause[] = ['starve', 'thirst', 'danger', 'age']
    for (const cause of causes) expect(CAUSE_LABEL[cause].length).toBeGreaterThan(0)
    expect(CAUSE_LABEL.thirst).toBe('Thirst')
    const intents: IntentKind[] = ['wander', 'seekFood', 'seekWater', 'flee', 'rest', 'reproduce']
    for (const intent of intents) expect(INTENT_LABEL[intent].length).toBeGreaterThan(0)
    expect(INTENT_LABEL.seekWater).toBe('Seeking water')
  })
})
