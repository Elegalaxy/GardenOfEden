import { describe, expect, it } from 'vitest'

import { checkPredatorSexes, findMate, lastOfSex, predatorAutoSex, predatorSexCounts, startSex } from './predatorSexes.ts'
import type { Sex, Tuning, WorldNode } from './types.ts'

// Unit tests for the pure helpers of predator sexes (PS1). The sim itself is covered in tests/predatorSexes.test.ts, which needs the real rules.

const good: Tuning['predator']['sexes'] = { enabled: true, mateRange: 50, loneAfter: 10, killsPerCub: 2, crossover: true }

function pred(id: number, x: number, sex: Sex | undefined, age = 100): WorldNode {
  const hunt = { life: { age }, ...(sex === undefined ? {} : { sex }) }
  return { id, kind: 'predator', x, y: 0, hunt } as unknown as WorldNode
}

const tuning = { predator: { sexes: good, ecology: { adultAge: 100 } } } as unknown as Pick<Tuning, 'predator'>

describe('checkPredatorSexes', () => {
  it('accepts good numbers and names each bad one', () => {
    expect(() => checkPredatorSexes(good)).not.toThrow()
    expect(() => checkPredatorSexes({ ...good, mateRange: 0 })).toThrow(RangeError)
    expect(() => checkPredatorSexes({ ...good, loneAfter: 0.5 })).toThrow(/loneAfter/)
    expect(() => checkPredatorSexes({ ...good, killsPerCub: 0 })).toThrow(/killsPerCub/)
  })
})

describe('sex helpers', () => {
  it('predatorAutoSex takes the sex there are fewer of, a tie gives female, and nodes without a sex do not count', () => {
    expect(predatorAutoSex([])).toBe('female')
    expect(predatorAutoSex([pred(1, 0, 'female')])).toBe('male')
    expect(predatorAutoSex([pred(1, 0, 'female'), pred(2, 0, 'male')])).toBe('female')
    expect(predatorAutoSex([pred(1, 0, 'male'), pred(2, 0, 'male'), pred(3, 0, undefined)])).toBe('female')
    expect(predatorSexCounts([pred(1, 0, 'male'), pred(2, 0, undefined)])).toEqual({ females: 0, males: 1 })
  })

  it('startSex sets the key and ignores a null state', () => {
    const node = pred(1, 0, undefined)
    startSex(node.hunt, 'male')
    expect(node.hunt?.sex).toBe('male')
    expect(() => startSex(null, 'male')).not.toThrow()
  })

  it('findMate wants an adult male in range, nearest first, ties to the first in id order', () => {
    const female = pred(1, 0, 'female')
    expect(findMate([female], female, tuning)).toBeNull()
    const near = pred(2, 10, 'male')
    const far = pred(3, 40, 'male')
    const tied = pred(4, 10, 'male')
    expect(findMate([female, far, near, tied], female, tuning)).toBe(near)
    expect(findMate([female, pred(5, 60, 'male')], female, tuning)).toBeNull() // out of range
    expect(findMate([female, pred(6, 5, 'male', 99)], female, tuning)).toBeNull() // not adult yet
    expect(findMate([female, pred(7, 5, 'female')], female, tuning)).toBeNull()
  })

  it('lastOfSex is true for the sole predator of its sex only', () => {
    const f1 = pred(1, 0, 'female')
    const f2 = pred(2, 0, 'female')
    const m = pred(3, 0, 'male')
    expect(lastOfSex([f1, f2, m], m)).toBe(true)
    expect(lastOfSex([f1, f2, m], f1)).toBe(false)
    expect(lastOfSex([f1, m], f1)).toBe(true)
    expect(lastOfSex([pred(4, 0, undefined)], pred(4, 0, undefined))).toBe(false)
  })
})
