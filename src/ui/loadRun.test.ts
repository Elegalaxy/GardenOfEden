import { beforeEach, describe, expect, it } from 'vitest'

import { SAVE_VERSION } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { stateHash } from '../sim/hash.ts'
import { MISMATCH_WARNING, advance, cancelLoad, dispatch, exportSave, getSnapshot, resetWorld, setPaused, startLoad } from './store.ts'

// Loading is the store's job: rebuild in slices, check the hash, swap only when complete.

beforeEach(() => {
  setPaused(false)
  resetWorld('load-test')
})

function playSomeRun(): Save {
  resetWorld('load-src')
  advance(120, 1)
  dispatch({ type: 'placeNode', kind: 'water', x: 10.5, y: 10.5 })
  dispatch({ type: 'placeBot', x: 12.5, y: 12.5 })
  advance(80, 1)
  dispatch({ type: 'triggerEvent', event: 'drought' })
  advance(30, 1)
  return exportSave()
}

describe('exportSave', () => {
  it('holds the seed, preset, tick, commands and the state hash of the live world', () => {
    const save = playSomeRun()
    expect(save).toMatchObject({ version: SAVE_VERSION, seed: 'load-src', presetId: 'eden', tick: 230 })
    expect(save.commands).toHaveLength(3)
    expect(save.hash).toBe(stateHash(getSnapshot().world))
  })
})

describe('startLoad', () => {
  it('rebuilds the run, pauses at the saved tick and says so', async () => {
    const save = playSomeRun()
    const liveHash = save.hash
    resetWorld('somewhere-else')
    expect(getSnapshot().seed).toBe('somewhere-else')

    const pending = startLoad(save)
    expect(getSnapshot().load).toEqual({ tick: 0, target: 230 })
    const outcome = await pending

    expect(outcome).toEqual({ status: 'loaded', hashMatches: true })
    const snap = getSnapshot()
    expect(snap).toMatchObject({ seed: 'load-src', presetId: 'eden', tick: 230, commandCount: 3, paused: true, load: null })
    expect(stateHash(snap.world)).toBe(liveHash)
    expect(snap.saveNotice).toMatchObject({ level: 'ok' })
    expect(snap.saveNotice?.text).toContain('tick 230')
    // The loaded run can be saved again and gives the same save.
    expect(exportSave()).toEqual(save)
  })

  it('warns, but still loads, when the hash does not match', async () => {
    const save = { ...playSomeRun(), hash: '0000000000000000' }
    expect(await startLoad(save)).toEqual({ status: 'loaded', hashMatches: false })
    expect(getSnapshot().saveNotice).toMatchObject({ level: 'warn' })
    expect(getSnapshot().saveNotice?.text).toContain(MISMATCH_WARNING)
  })

  it('keeps the old run when a command is refused', async () => {
    const save = playSomeRun()
    resetWorld('keep-me')
    advance(40, 1)
    const before = getSnapshot().world
    const hashBefore = stateHash(before)

    const bad: Save = { ...save, commands: [{ tick: 5, cmd: { type: 'placeNode', kind: 'resource', x: 9999, y: 1 } }] }
    const outcome = await startLoad(bad)

    expect(outcome.status).toBe('failed')
    const snap = getSnapshot()
    expect(snap.world).toBe(before)
    expect(stateHash(snap.world)).toBe(hashBefore)
    expect(snap).toMatchObject({ seed: 'keep-me', tick: 40, load: null })
    expect(snap.saveNotice).toMatchObject({ level: 'error' })
    expect(snap.saveNotice?.text).toContain('Your current run was kept')
  })

  it('keeps the old run when the preset is unknown or the seed invalid', async () => {
    const save = playSomeRun()
    resetWorld('keep-me')
    const before = getSnapshot().world
    expect((await startLoad({ ...save, presetId: 'nowhere' })).status).toBe('failed')
    expect(getSnapshot().saveNotice?.text).toContain('preset')
    expect((await startLoad({ ...save, seed: 'bad seed!' })).status).toBe('failed')
    expect(getSnapshot().world).toBe(before)
    expect(getSnapshot().load).toBeNull()
  })

  it('can be cancelled, and then the old run is untouched', async () => {
    const long: Save = { version: SAVE_VERSION, seed: 'long-run', presetId: 'eden', tick: 500_000, hash: '0000000000000000', commands: [] }
    resetWorld('keep-me')
    advance(25, 1)
    const before = getSnapshot().world
    const hashBefore = stateHash(before)

    const pending = startLoad(long)
    expect(getSnapshot().load).not.toBeNull()
    cancelLoad()
    expect(await pending).toEqual({ status: 'cancelled' })

    const snap = getSnapshot()
    expect(snap.load).toBeNull()
    expect(snap.world).toBe(before)
    expect(stateHash(snap.world)).toBe(hashBefore)
    expect(snap.seed).toBe('keep-me')
    expect(snap.saveNotice?.text).toContain('cancelled')
  })

  it('can be cancelled part-way, after some slices have run', async () => {
    const long: Save = { version: SAVE_VERSION, seed: 'long-run', presetId: 'eden', tick: 500_000, hash: '0000000000000000', commands: [] }
    resetWorld('keep-me')
    const before = getSnapshot().world
    const pending = startLoad(long)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const progress = getSnapshot().load
    expect(progress).not.toBeNull()
    expect(progress?.tick).toBeGreaterThan(0)
    expect(progress?.tick).toBeLessThan(500_000)
    cancelLoad()
    expect((await pending).status).toBe('cancelled')
    expect(getSnapshot().world).toBe(before)
  })

  it('stops the clock, the tools and a restart while a load runs, and refuses a second load', async () => {
    const save = playSomeRun()
    resetWorld('keep-me')
    const tickBefore = getSnapshot().tick
    const pending = startLoad(save)

    advance(10, 1)
    expect(getSnapshot().tick).toBe(tickBefore)
    expect(dispatch({ type: 'placeBot', x: 5.5, y: 5.5 }).ok).toBe(false)
    expect(getSnapshot().commandCount).toBe(0)
    expect(resetWorld('other')).toBe(false)
    expect((await startLoad(save).catch(() => null))?.status).toBe('failed')

    expect((await pending).status).toBe('loaded')
    expect(resetWorld('other')).toBe(true)
  })

  it('loads a run saved at tick 0 with no commands', async () => {
    resetWorld('zero-run')
    const save = exportSave()
    resetWorld('elsewhere')
    expect(await startLoad(save)).toEqual({ status: 'loaded', hashMatches: true })
    expect(getSnapshot()).toMatchObject({ seed: 'zero-run', tick: 0, commandCount: 0, paused: true })
  })
})
