import { beforeEach, describe, expect, it } from 'vitest'

import { AUTOSAVE_KEY } from '../persist/autosave.ts'
import type { KeyValueStore } from '../persist/autosave.ts'
import { getAutosaveInfo, resetAutosaveForTests, unreadableAutosaveText, warnUnreadableAutosave } from './autosave.ts'
import { getSnapshot } from './store.ts'

// A stored run made before danger zones were retired (M21b) cannot be opened. The page must say so once per load
// and keep the stored text (the player decides with Clear).

function memory(text: string | null): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (text !== null) data.set(AUTOSAVE_KEY, text)
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const oldSave = JSON.stringify({
  version: 2,
  seed: 'a',
  presetId: 'eden',
  sim: 3,
  tick: 10,
  hash: '0123456789abcdef',
  commands: [{ tick: 3, cmd: { type: 'placeNode', kind: 'danger', x: 5, y: 5, radius: 3 } }],
})

beforeEach(() => resetAutosaveForTests(null))

describe('unreadable autosave notice', () => {
  it('warns once per page load with the older-rules text and keeps the stored run', () => {
    const storage = memory(oldSave)
    resetAutosaveForTests(storage)
    const info = getAutosaveInfo()
    expect(info.saved).toBeNull()
    expect(info.unreadable?.code).toBe('retired-kind')
    const before = getSnapshot().saveNotice?.seq ?? 0
    expect(warnUnreadableAutosave()).toBe(true)
    const notice = getSnapshot().saveNotice
    expect(notice?.level).toBe('warn')
    expect(notice?.seq).toBe(before + 1)
    expect(notice?.text).toContain("Your last autosave was made with older rules and can't be opened.")
    expect(warnUnreadableAutosave()).toBe(false)
    expect(getSnapshot().saveNotice?.seq).toBe(before + 1)
    expect(storage.data.get(AUTOSAVE_KEY)).toBe(oldSave)
  })

  it('says nothing when there is no autosave or a good one', () => {
    resetAutosaveForTests(memory(null))
    const before = getSnapshot().saveNotice?.seq ?? 0
    expect(warnUnreadableAutosave()).toBe(false)
    expect(getSnapshot().saveNotice?.seq ?? 0).toBe(before)
  })

  it('uses a generic text for other problems', () => {
    expect(unreadableAutosaveText({ code: 'not-json', message: 'x' })).toBe("Your last autosave can't be opened.")
  })
})
