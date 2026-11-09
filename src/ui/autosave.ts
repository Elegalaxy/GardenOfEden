// Autosave glue (M9). Keeps the latest run in localStorage (format and safe read/write
// in persist/autosave.ts) so "Resume last run" survives a reload.
//
// What counts as "the latest run": any run that has a command, or that the player
// started on purpose (a restart or a load). The run on screen when the page opens is
// not saved until one of those happens, so opening the page never overwrites the
// last real run. Writes hash the whole world, so they are throttled to one per
// `INTERVAL_MS` while the clock runs; a new command writes at once, and the page
// flushes when it is hidden or closed. "Clear" removes the stored run and stops saving
// this run until it changes again. Without storage everything here is a no-op.
//
// Since M13 the save (and its hash) is made by the simulation worker, so a write is a request
// that finishes a moment later and never stalls the page. A flush as the page closes is therefore
// best effort: if the page is gone before the answer arrives, the previous autosave stays.

import { useSyncExternalStore } from 'react'
import { clearAutosave, readAutosave, writeAutosave } from '../persist/autosave.ts'
import type { KeyValueStore } from '../persist/autosave.ts'
import type { Save } from '../persist/save.ts'
import { exportSave, getSnapshot, subscribe } from './store.ts'

const INTERVAL_MS = 10_000

export type AutosaveInfo = {
  /** The stored run, or null when there is none. */
  saved: Save | null
  /** False when browser storage is missing or a write failed. */
  available: boolean
}

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()
let storage: KeyValueStore | null | undefined
let info: AutosaveInfo | null = null

function getStorage(): KeyValueStore | null {
  if (storage === undefined) storage = browserStorage()
  return storage
}

function setInfo(next: AutosaveInfo): void {
  info = next
  for (const listener of listeners) listener()
}

export function getAutosaveInfo(): AutosaveInfo {
  if (info === null) {
    const store = getStorage()
    info = { saved: readAutosave(store), available: store !== null }
  }
  return info
}

function subscribeAutosave(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAutosave(): AutosaveInfo {
  return useSyncExternalStore(subscribeAutosave, getAutosaveInfo, getAutosaveInfo)
}

let suspended: { runId: number; commands: number } | null = null
/** Bumped by "Clear", so a save requested before it is not written after it. */
let clearGeneration = 0

/** Removes the stored run and stops saving the current one until it changes. */
export function clearStoredRun(): void {
  clearGeneration += 1
  const ok = clearAutosave(getStorage())
  const snap = getSnapshot()
  suspended = { runId: snap.runId, commands: snap.commandCount }
  setInfo({ saved: null, available: ok && getStorage() !== null })
}

/** Starts saving the latest run. Returns a function that stops it. */
export function startAutosave(): () => void {
  let lastKey = ''
  let lastWriteAt = Number.NEGATIVE_INFINITY

  const write = (force: boolean): void => {
    const snap = getSnapshot()
    if (snap.load !== null) return
    if (suspended !== null) {
      if (snap.runId === suspended.runId && snap.commandCount <= suspended.commands) return
      suspended = null
    }
    if (snap.commandCount === 0 && snap.runId === 0) return
    const key = `${snap.runId}:${snap.commandCount}:${snap.tick}`
    if (key === lastKey) return
    const commandChanged = !lastKey.startsWith(`${snap.runId}:${snap.commandCount}:`)
    const now = Date.now()
    if (!force && !commandChanged && now - lastWriteAt < INTERVAL_MS) return
    lastKey = key
    lastWriteAt = now
    const generation = clearGeneration
    exportSave()
      .then((save) => {
        if (generation !== clearGeneration) return
        const ok = writeAutosave(getStorage(), save)
        setInfo({ saved: ok ? save : (info?.saved ?? null), available: ok })
      })
      .catch(() => {
        // The simulation could not make a save; the previous autosave stays.
      })
  }

  const unsubscribe = subscribe(() => write(false))
  const flush = (): void => write(true)
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
