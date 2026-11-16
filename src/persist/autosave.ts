// Autosave (M9): the latest run kept in browser storage so "Resume last run" works
// after a reload. The storage is passed in (the ui hands over `localStorage`), so
// this file touches no globals and a test can use a plain object. Browser storage
// can be missing, full or blocked, so every call is wrapped and failure just means
// "no autosave": the page works without it.

import { decodeSave, encodeSave } from './save.ts'
import type { Save, SaveError } from './save.ts'

export const AUTOSAVE_KEY = 'garden-of-eden:autosave'

export type KeyValueStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** True when the run was stored. */
export function writeAutosave(storage: KeyValueStore | null, save: Save): boolean {
  if (storage === null) return false
  try {
    storage.setItem(AUTOSAVE_KEY, encodeSave(save))
    return true
  } catch {
    return false
  }
}

/** What is stored: a run, a stored text that is not an openable save (with the typed reason), or nothing. */
export type AutosaveRead = { save: Save | null; problem: SaveError | null }

/** Like `readAutosave`, but says why a stored text could not be opened (for example `retired-kind` after a rules change). Never throws. */
export function inspectAutosave(storage: KeyValueStore | null): AutosaveRead {
  if (storage === null) return { save: null, problem: null }
  try {
    const text = storage.getItem(AUTOSAVE_KEY)
    if (text === null) return { save: null, problem: null }
    const result = decodeSave(text)
    return result.ok ? { save: result.save, problem: null } : { save: null, problem: result.error }
  } catch {
    return { save: null, problem: null }
  }
}

/** The stored run, or null when there is none, the storage fails or the text is not a valid save. */
export function readAutosave(storage: KeyValueStore | null): Save | null {
  return inspectAutosave(storage).save
}

/** True when nothing is left stored (also when there was nothing). */
export function clearAutosave(storage: KeyValueStore | null): boolean {
  if (storage === null) return true
  try {
    storage.removeItem(AUTOSAVE_KEY)
    return true
  } catch {
    return false
  }
}
