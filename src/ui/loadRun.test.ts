import { beforeEach, describe, expect, it } from 'vitest'

import { SIM_VERSION } from '../content/index.ts'
import { SAVE_VERSION } from '../persist/save.ts'
import type { Save } from '../persist/save.ts'
import { MISMATCH_WARNING, advance, mismatchWarning, cancelLoad, dispatch, exportSave, getSnapshot, resetWorld, setPaused, settled, startLoad } from './store.ts'

// Loading is the worker's job (rebuild in slices, check the hash, swap only when complete); the store shows it.
// The tests run it through the inline client.

beforeEach(async () => {
  setPaused(false)
  resetWorld('load-test')
  await settled()
})

async function playSomeRun(): Promise<Save> {
  resetWorld('load-src')
  await advance(120, 1)
  await dispatch({ type: 'placeNode', kind: 'water', x: 10.5, y: 10.5 })
  await dispatch({ type: 'placeBot', x: 12.5, y: 12.5 })
  await advance(80, 1)
  await dispatch({ type: 'triggerEvent', event: 'drought' })
  await advance(30, 1)
  return exportSave()
}

describe('exportSave', () => {
  it('holds the seed, preset, tick, commands and the state hash of the live world', async () => {
    const save = await playSomeRun()
    expect(save).toMatchObject({ version: SAVE_VERSION, seed: 'load-src', presetId: 'eden', sim: SIM_VERSION, tick: 230 })
    expect(save.commands).toHaveLength(3)
    expect(save.hash).toMatch(/^[0-9a-f]{16}$/)
    // The hash is of the worker's world (simHost.test.ts checks it against replayWorld); asking again gives the same save.
    expect(await exportSave()).toEqual(save)
  })
})

describe('startLoad', () => {
  it('rebuilds the run, pauses at the saved tick and says so', async () => {
    const save = await playSomeRun()
    resetWorld('somewhere-else')
    await settled()
    expect(getSnapshot().seed).toBe('somewhere-else')

    const pending = startLoad(save)
    expect(getSnapshot().load).toEqual({ tick: 0, target: 230 })
    const outcome = await pending

    expect(outcome).toEqual({ status: 'loaded', hashMatches: true })
    const snap = getSnapshot()
    expect(snap).toMatchObject({ seed: 'load-src', presetId: 'eden', tick: 230, commandCount: 3, paused: true, load: null })
    expect(snap.world.commands).toHaveLength(3)
    expect(snap.saveNotice).toMatchObject({ level: 'ok' })
    expect(snap.saveNotice?.text).toContain('tick 230')
    // The loaded run can be saved again and gives the same save (same hash).
    expect(await exportSave()).toEqual(save)
  })

  it('warns, but still loads, when the hash does not match', async () => {
    const save = { ...(await playSomeRun()), hash: '0000000000000000' }
    expect(await startLoad(save)).toEqual({ status: 'loaded', hashMatches: false })
    expect(getSnapshot().saveNotice).toMatchObject({ level: 'warn' })
    expect(getSnapshot().saveNotice?.text).toContain(MISMATCH_WARNING)
  })

  it('words a hash mismatch by the simulation version', async () => {
    const save = { ...(await playSomeRun()), hash: '0000000000000000', sim: SIM_VERSION + 1 }
    await startLoad(save)
    expect(getSnapshot().saveNotice?.text).toContain(`newer version of the simulation (rules v${SIM_VERSION + 1}, now v${SIM_VERSION})`)
    expect(mismatchWarning(SIM_VERSION - 1, SIM_VERSION)).toContain(`older version of the simulation (rules v${SIM_VERSION - 1}, now v${SIM_VERSION})`)
    expect(mismatchWarning(3, 3)).toBe(MISMATCH_WARNING)
  })

  it('gives the loaded run a new run id, and no selection', async () => {
    const save = await playSomeRun()
    const before = getSnapshot().runId
    await startLoad(save)
    expect(getSnapshot().runId).toBeGreaterThan(before)
    expect(getSnapshot().selection).toBeNull()
  })

  it('keeps the old run when a command is refused', async () => {
    const save = await playSomeRun()
    resetWorld('keep-me')
    await advance(40, 1)
    const before = await exportSave()
    const runId = getSnapshot().runId

    const bad: Save = { ...save, commands: [{ tick: 5, cmd: { type: 'placeNode', kind: 'resource', x: 9999, y: 1 } }] }
    const outcome = await startLoad(bad)

    expect(outcome.status).toBe('failed')
    const snap = getSnapshot()
    expect(await exportSave()).toEqual(before) // same hash: the worker's world is untouched
    expect(snap.runId).toBe(runId)
    expect(snap).toMatchObject({ seed: 'keep-me', tick: 40, load: null })
    expect(snap.saveNotice).toMatchObject({ level: 'error' })
    expect(snap.saveNotice?.text).toContain('Your current run was kept')
  })

  it('keeps the old run when the preset is unknown or the seed invalid', async () => {
    const save = await playSomeRun()
    resetWorld('keep-me')
    await settled()
    const before = await exportSave()
    const runId = getSnapshot().runId
    expect((await startLoad({ ...save, presetId: 'nowhere' })).status).toBe('failed')
    expect(getSnapshot().saveNotice?.text).toContain('preset')
    expect((await startLoad({ ...save, seed: 'bad seed!' })).status).toBe('failed')
    expect(await exportSave()).toEqual(before)
    expect(getSnapshot().runId).toBe(runId)
    expect(getSnapshot().load).toBeNull()
  })

  it('can be cancelled, and then the old run is untouched', async () => {
    const long: Save = { version: SAVE_VERSION, seed: 'long-run', presetId: 'eden', sim: 1, tick: 500_000, hash: '0000000000000000', commands: [] }
    resetWorld('keep-me')
    await advance(25, 1)
    const before = await exportSave()
    const runId = getSnapshot().runId

    const pending = startLoad(long)
    expect(getSnapshot().load).not.toBeNull()
    cancelLoad()
    expect(await pending).toEqual({ status: 'cancelled' })

    const snap = getSnapshot()
    expect(snap.load).toBeNull()
    expect(snap.runId).toBe(runId)
    expect(await exportSave()).toEqual(before)
    expect(snap.seed).toBe('keep-me')
    expect(snap.saveNotice?.text).toContain('cancelled')
  })

  it('shows progress, and can be cancelled part-way, after some slices have run', async () => {
    const long: Save = { version: SAVE_VERSION, seed: 'long-run', presetId: 'eden', sim: 1, tick: 500_000, hash: '0000000000000000', commands: [] }
    resetWorld('keep-me')
    await settled()
    const runId = getSnapshot().runId
    const pending = startLoad(long)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const progress = getSnapshot().load
    expect(progress).not.toBeNull()
    expect(progress?.tick).toBeGreaterThan(0)
    expect(progress?.tick).toBeLessThan(500_000)
    expect(progress?.target).toBe(500_000)
    cancelLoad()
    expect((await pending).status).toBe('cancelled')
    expect(getSnapshot().runId).toBe(runId)
    expect(getSnapshot().seed).toBe('keep-me')
  })

  it('stops the clock, the tools and a restart while a load runs, and refuses a second load', async () => {
    const save = await playSomeRun()
    resetWorld('keep-me')
    await settled()
    const tickBefore = getSnapshot().tick
    const pending = startLoad(save)

    await advance(10, 1)
    expect(getSnapshot().tick).toBe(tickBefore)
    expect((await dispatch({ type: 'placeBot', x: 5.5, y: 5.5 })).ok).toBe(false)
    expect(getSnapshot().commandCount).toBe(0)
    expect(resetWorld('other')).toBe(false)
    expect((await startLoad(save).catch(() => null))?.status).toBe('failed')

    expect((await pending).status).toBe('loaded')
    expect(resetWorld('other')).toBe(true)
  })

  it('loads a run saved at tick 0 with no commands', async () => {
    resetWorld('zero-run')
    await settled()
    const save = await exportSave()
    resetWorld('elsewhere')
    await settled()
    expect(await startLoad(save)).toEqual({ status: 'loaded', hashMatches: true })
    expect(getSnapshot()).toMatchObject({ seed: 'zero-run', tick: 0, commandCount: 0, paused: true })
  })
})
