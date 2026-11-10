import { beforeEach, describe, expect, it } from 'vitest'

import { advance, cycleHeatLayer, getSnapshot, resetWorld, setHeatLayer, setHeatRange, setPaused, settled } from './store.ts'

// The page's side of the heatmaps: which layer is on, and the snapshot that comes back for it (run through the inline client).

beforeEach(async () => {
  setHeatLayer(null)
  setHeatRange('all')
  setPaused(false)
  resetWorld('heat-store')
  await settled()
})

describe('the heat layer in the store', () => {
  it('starts with none, all time and no snapshot', () => {
    expect(getSnapshot()).toMatchObject({ heatLayer: null, heatRange: 'all', heat: null })
  })

  it('shows the snapshot of the chosen layer once the worker answers, and clears it when switched off', async () => {
    setHeatLayer('traffic')
    expect(getSnapshot()).toMatchObject({ heatLayer: 'traffic', heat: null })
    await settled()
    const heat = getSnapshot().heat
    expect(heat).toMatchObject({ layer: 'traffic', range: 'all', runId: getSnapshot().runId, width: 96, height: 64 })
    setHeatLayer(null)
    expect(getSnapshot()).toMatchObject({ heatLayer: null, heat: null })
    await settled()
    expect(getSnapshot().heat).toBeNull()
  })

  it('gets a fresh snapshot, matching the picture, when the run is paused', async () => {
    setHeatLayer('births')
    await advance(120, 1)
    setPaused(true)
    await settled()
    const snap = getSnapshot()
    expect(snap.tick).toBe(120)
    expect(snap.heat).toMatchObject({ layer: 'births', tick: 120 })
    expect(snap.heat!.total).toBe(snap.births)
  })

  it('asks for the other range when it changes, and drops the old snapshot meanwhile', async () => {
    setHeatLayer('deaths')
    await settled()
    setHeatRange('recent')
    expect(getSnapshot()).toMatchObject({ heatRange: 'recent', heat: null })
    await settled()
    expect(getSnapshot().heat).toMatchObject({ layer: 'deaths', range: 'recent' })
  })

  it('follows a reset: the new run gets its own, empty snapshot', async () => {
    setHeatLayer('traffic')
    await advance(80, 1)
    setPaused(true)
    await settled()
    expect(getSnapshot().heat!.total).toBeGreaterThan(0)
    const oldRun = getSnapshot().runId
    resetWorld('another-seed')
    await settled()
    const snap = getSnapshot()
    expect(snap.runId).toBe(oldRun + 1)
    expect(snap.heat).toMatchObject({ runId: snap.runId, tick: 0, total: 0 })
  })

  it('cycles none, traffic, births, deaths, none', async () => {
    const seen = [getSnapshot().heatLayer]
    for (let i = 0; i < 4; i += 1) {
      cycleHeatLayer()
      seen.push(getSnapshot().heatLayer)
    }
    expect(seen).toEqual([null, 'traffic', 'births', 'deaths', null])
    await settled()
  })
})
