import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bytesToBase64Url, encodeShare, encodeShareLegacy } from '../persist/share.ts'
import type { Save } from '../persist/save.ts'
import { loadFromLocation, shareUrl, watchShareLinks } from './shareLink.ts'
import { advance, dispatch, exportSave, getSnapshot, resetWorld, setPaused, settled } from './store.ts'

// Opening a share link: new (#run2=) and old (#run=) forms, the fragment stripped at once, errors as a notice
// with the old run kept, and links pasted later (hashchange). There is no DOM in the test environment, so
// `window` is a small stand-in with the three things shareLink.ts uses.

type FakeWindow = {
  location: { hash: string; pathname: string; search: string; origin: string }
  history: { replaceState: (state: unknown, title: string, url: string) => void }
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
  replaced: string[]
  listeners: Set<() => void>
}

function installWindow(hash: string): FakeWindow {
  const fake: FakeWindow = {
    location: { hash, pathname: '/GardenOfEden/', search: '', origin: 'https://example.test' },
    history: {
      replaceState: (_state, _title, url) => {
        fake.replaced.push(url)
        fake.location.hash = ''
      },
    },
    addEventListener: (type, listener) => {
      if (type === 'hashchange') fake.listeners.add(listener)
    },
    removeEventListener: (type, listener) => {
      if (type === 'hashchange') fake.listeners.delete(listener)
    },
    replaced: [],
    listeners: new Set(),
  }
  vi.stubGlobal('window', fake)
  return fake
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(done()).toBe(true)
}

beforeEach(async () => {
  setPaused(false)
  resetWorld('link-test')
  await settled()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function playSomeRun(): Promise<Save> {
  resetWorld('link-src')
  await advance(60, 1)
  await dispatch({ type: 'placeNode', kind: 'water', x: 10.5, y: 10.5 })
  await dispatch({ type: 'placeBot', x: 12.5, y: 12.5 })
  await advance(40, 1)
  return exportSave()
}

describe('opening a share link', () => {
  it('loads a compressed link, paused at its tick, and strips the fragment at once', async () => {
    const save = await playSomeRun()
    const encoded = await encodeShare(save)
    if (!encoded.ok) throw new Error('encode failed')
    expect(encoded.format).toBe('deflate')
    resetWorld('elsewhere')
    await settled()
    const win = installWindow(encoded.fragment)

    const pending = loadFromLocation()
    expect(win.replaced).toEqual(['/GardenOfEden/']) // stripped before anything is unpacked
    expect(win.location.hash).toBe('')
    expect(await pending).toBe(true)
    await until(() => getSnapshot().seed === 'link-src' && getSnapshot().load === null)

    expect(getSnapshot()).toMatchObject({ seed: 'link-src', tick: 100, commandCount: 2, paused: true })
    expect(getSnapshot().saveNotice).toMatchObject({ level: 'ok' })
    expect(getSnapshot().saveNotice?.text).not.toContain('does not match')
  })

  it('loads an old-format link the same way', async () => {
    const save = await playSomeRun()
    const old = encodeShareLegacy(save)
    if (!old.ok) throw new Error('encode failed')
    resetWorld('elsewhere')
    await settled()
    installWindow(old.fragment)

    expect(await loadFromLocation()).toBe(true)
    await until(() => getSnapshot().seed === 'link-src' && getSnapshot().load === null)
    expect(getSnapshot()).toMatchObject({ seed: 'link-src', tick: 100, commandCount: 2, paused: true })
    expect(getSnapshot().saveNotice).toMatchObject({ level: 'ok' })
  })

  it('shows an error and keeps the current run for a damaged compressed link', async () => {
    await playSomeRun()
    const before = await exportSave()
    const runId = getSnapshot().runId
    const win = installWindow(`#run2=${bytesToBase64Url(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1]))}`)

    expect(await loadFromLocation()).toBe(true)
    expect(win.replaced).toHaveLength(1)
    const snap = getSnapshot()
    expect(snap.saveNotice).toMatchObject({ level: 'error' })
    expect(snap.saveNotice?.text).toContain('Your current run was kept')
    expect(snap.load).toBeNull()
    expect(snap.runId).toBe(runId)
    expect(await exportSave()).toEqual(before)
  })

  it('ignores a fragment that is not a share link, and leaves it in the address bar', async () => {
    const win = installWindow('#section-2')
    expect(await loadFromLocation()).toBe(false)
    expect(win.replaced).toEqual([])
    expect(win.location.hash).toBe('#section-2')
  })

  it('loads a link pasted later (hashchange) and stops listening when cleaned up', async () => {
    const save = await playSomeRun()
    const encoded = await encodeShare(save)
    if (!encoded.ok) throw new Error('encode failed')
    resetWorld('elsewhere')
    await settled()
    const win = installWindow('')
    const stop = watchShareLinks()
    expect(win.listeners.size).toBe(1)

    win.location.hash = encoded.fragment
    for (const listener of [...win.listeners]) listener()
    await until(() => getSnapshot().seed === 'link-src' && getSnapshot().load === null)
    expect(getSnapshot()).toMatchObject({ tick: 100, commandCount: 2, paused: true })
    expect(win.location.hash).toBe('')

    stop()
    expect(win.listeners.size).toBe(0)
  })

  it('builds the address for a link from the page without its old fragment', () => {
    installWindow('#run2=old')
    expect(shareUrl('#run2=abc')).toBe('https://example.test/GardenOfEden/#run2=abc')
  })
})
