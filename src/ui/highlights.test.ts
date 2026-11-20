import { describe, expect, it } from 'vitest'

import type { DeathCause, PredatorEventKind, SimEvent } from '../sim/types.ts'
import { highlightKey, highlightText, highlightsOf, isHighlight, nextHighlightIndex } from './highlights.ts'

const death = (tick: number, cause: DeathCause, botId = 1): SimEvent => ({ tick, type: 'death', botId, cause, x: 3.5, y: 4.5 })
const predator = (tick: number, predatorEvent: PredatorEventKind): SimEvent => ({ tick, type: 'predator', nodeId: 9, predatorEvent, x: 10, y: 11 })
const command = (tick: number, eventKind: 'plague' | 'meteor' | 'blight' | 'outbreak' | 'drought' | 'bounty'): SimEvent => ({
  tick,
  type: 'command',
  command: 'triggerEvent',
  eventKind,
  x: 20,
  y: 8,
})

describe('isHighlight', () => {
  it('counts deaths by predator, meteor, plague, poison and disease only', () => {
    for (const cause of ['predator', 'meteor', 'plague', 'poison', 'disease'] as const) expect(isHighlight(death(1, cause))).toBe(true)
    for (const cause of ['starve', 'thirst', 'danger', 'age'] as const) expect(isHighlight(death(1, cause))).toBe(false)
  })

  it('counts predators born, struck, plagued or leaving, not the rest', () => {
    for (const kind of ['born', 'struck', 'plagued', 'left'] as const) expect(isHighlight(predator(1, kind))).toBe(true)
    for (const kind of ['arrived', 'starved', 'aged'] as const) expect(isHighlight(predator(1, kind))).toBe(false)
  })

  it('counts your plague, meteor, blight and outbreak, not drought, bounty, placing or removing', () => {
    for (const kind of ['plague', 'meteor', 'blight', 'outbreak'] as const) expect(isHighlight(command(1, kind))).toBe(true)
    for (const kind of ['drought', 'bounty'] as const) expect(isHighlight(command(1, kind))).toBe(false)
    expect(isHighlight({ tick: 1, type: 'command', command: 'placeNode', nodeKind: 'predator', x: 1, y: 1 })).toBe(false)
    expect(isHighlight({ tick: 1, type: 'command', command: 'removeNode', nodeId: 3, x: 1, y: 1 })).toBe(false)
  })

  it('never counts births or the end of a world event', () => {
    expect(isHighlight({ tick: 1, type: 'birth', botId: 2, x: 1, y: 1 })).toBe(false)
    expect(isHighlight({ tick: 1, type: 'event', eventKind: 'plague', x: 1, y: 1 })).toBe(false)
  })
})

describe('highlightsOf', () => {
  it('lists the highlights newest first and skips the rest', () => {
    const log: SimEvent[] = [
      death(1, 'predator'),
      { tick: 2, type: 'birth', botId: 5, x: 1, y: 1 },
      death(3, 'starve'),
      predator(4, 'struck'),
      command(5, 'meteor'),
      predator(6, 'arrived'),
    ]
    expect(highlightsOf(log).map((e) => e.tick)).toEqual([5, 4, 1])
    expect(highlightsOf([])).toEqual([])
  })

  it('finds your old commands that have scrolled out of the log ring', () => {
    const commands = [
      { tick: 7, cmd: { type: 'triggerEvent', event: 'plague', x: 5, y: 6 } as const },
      { tick: 8, cmd: { type: 'triggerEvent', event: 'drought' } as const },
    ]
    const found = highlightsOf([death(20, 'predator')], commands)
    expect(found.map((e) => e.tick)).toEqual([20, 7])
    expect(found[1]).toMatchObject({ eventKind: 'plague', x: 5, y: 6 })
  })
})

describe('highlight keys and text', () => {
  it('tells two highlights apart', () => {
    expect(highlightKey(death(1, 'predator', 1))).not.toBe(highlightKey(death(1, 'predator', 2)))
    expect(highlightKey(death(1, 'predator'))).toBe(highlightKey(death(1, 'predator')))
  })

  it('reuses the log wording', () => {
    expect(highlightText(death(1, 'predator', 4))).toBe('Killed by a predator (bot #4) at 3.5, 4.5')
    expect(highlightText(predator(1, 'struck'))).toBe('Predator #9 killed by a meteor at 10, 11')
    expect(highlightText(command(1, 'blight'))).toBe('You: trigger blight at 20, 8')
    expect(highlightText(command(1, 'outbreak'))).toBe('You: trigger outbreak at 20, 8')
    expect(highlightText(death(1, 'disease', 5))).toBe('Died of disease (bot #5) at 3.5, 4.5')
  })
})

describe('nextHighlightIndex', () => {
  it('starts at the newest, goes one older per press and wraps', () => {
    let index: number | null = null
    const seen: number[] = []
    for (let i = 0; i < 7; i += 1) {
      index = nextHighlightIndex(index, 3)
      seen.push(index)
    }
    expect(seen).toEqual([0, 1, 2, 0, 1, 2, 0])
  })

  it('has no index with nothing to show', () => {
    expect(nextHighlightIndex(null, 0)).toBe(-1)
    expect(nextHighlightIndex(2, 0)).toBe(-1)
  })
})
