import { describe, expect, it } from 'vitest'

import { AUTOSAVE_KEY, clearAutosave, readAutosave, writeAutosave } from './autosave.ts'
import type { KeyValueStore } from './autosave.ts'
import { SAVE_VERSION } from './save.ts'
import type { Save } from './save.ts'

const run: Save = {
  version: SAVE_VERSION,
  seed: 'a',
  presetId: 'eden',
  sim: 1,
  tick: 10,
  hash: '0123456789abcdef',
  commands: [{ tick: 3, cmd: { type: 'placeBot', x: 1.5, y: 2.5 } }],
}

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('quota')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

describe('autosave', () => {
  it('stores and reads back the latest run, and clears it', () => {
    const storage = memory()
    expect(readAutosave(storage)).toBeNull()
    expect(writeAutosave(storage, run)).toBe(true)
    expect(readAutosave(storage)).toEqual(run)
    expect(clearAutosave(storage)).toBe(true)
    expect(readAutosave(storage)).toBeNull()
  })

  it('treats damaged stored text as no autosave', () => {
    const storage = memory()
    storage.setItem(AUTOSAVE_KEY, '{"version":1,"seed":"a"}')
    expect(readAutosave(storage)).toBeNull()
    storage.setItem(AUTOSAVE_KEY, 'garbage')
    expect(readAutosave(storage)).toBeNull()
  })

  it('works without storage and survives storage that throws', () => {
    expect(writeAutosave(null, run)).toBe(false)
    expect(readAutosave(null)).toBeNull()
    expect(clearAutosave(null)).toBe(true)
    expect(writeAutosave(broken, run)).toBe(false)
    expect(readAutosave(broken)).toBeNull()
    expect(clearAutosave(broken)).toBe(false)
  })
})
