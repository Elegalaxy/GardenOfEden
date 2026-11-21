import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CAMERA } from './camera.ts'
import { findBot } from './geometry.ts'
import { highlightsOf } from './highlights.ts'
import { centreOn, checkFollow, clickMap, fitCamera, getCamera, getPulse, getSnapshot, getTour, nextHighlight, resetWorld, select, setCamera, setTool, settled, toggleFollow, toggleTour, tourStep, TOUR_GAP_MS, zoomStep } from './store.ts'

// The page's camera (F1): zoom, pan and follow are a page setting, outside the snapshot.

beforeEach(async () => {
  setTool('inspect')
  resetWorld('camera-store')
  await settled()
})

describe('the camera in the store', () => {
  it('starts on the whole map, not following', () => {
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
  })

  it('zooms by steps and fits again', () => {
    zoomStep(1)
    expect(getCamera().zoom).toBe(1.5)
    zoomStep(1)
    zoomStep(1)
    expect(getCamera().zoom).toBe(3)
    zoomStep(-1)
    expect(getCamera().zoom).toBe(2)
    fitCamera()
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
    zoomStep(-1)
    expect(getCamera().zoom).toBe(1)
  })

  it('refuses to follow with nothing followable selected, and says so', () => {
    toggleFollow()
    expect(getCamera().follow).toBe(false)
    expect(getSnapshot().notice).toMatchObject({ ok: false, text: 'Select a bot or predator to follow.' })
    select({ kind: 'node', id: getSnapshot().world.nodes.find((n) => n.kind === 'resource')!.id })
    toggleFollow()
    expect(getCamera().follow).toBe(false)
  })

  it('follows the selected bot (zooming to 2 from the whole map) and stops when asked', () => {
    const bot = getSnapshot().world.bots[0]!
    select({ kind: 'bot', id: bot.id })
    toggleFollow()
    expect(getCamera()).toMatchObject({ follow: true, zoom: 2 })
    toggleFollow()
    expect(getCamera().follow).toBe(false)
    expect(getCamera().zoom).toBe(2)
  })

  it('stops following, with a notice, when the bot dies', async () => {
    const bot = getSnapshot().world.bots[0]!
    select({ kind: 'bot', id: bot.id })
    toggleFollow()
    expect(checkFollow()).toBe(false)
    setTool('meteor')
    clickMap(bot.x, bot.y, 1)
    await settled()
    expect(findBot(getSnapshot().world, bot.id)).toBeUndefined()
    expect(checkFollow()).toBe(true)
    expect(getCamera().follow).toBe(false)
    expect(getSnapshot().notice?.text).toBe(`Bot ${bot.id} is gone; stopped following.`)
    expect(checkFollow()).toBe(false)
  })

  it('goes back to the whole map on a new world', async () => {
    select({ kind: 'bot', id: getSnapshot().world.bots[0]!.id })
    toggleFollow()
    setCamera({ ...getCamera(), zoom: 3 })
    resetWorld('camera-store-2')
    await settled()
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
  })
})

describe('next highlight (F2)', () => {
  it('says so and does nothing when there is no highlight', () => {
    expect(nextHighlight()).toBe(false)
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
    expect(getSnapshot().notice).toMatchObject({ ok: false })
  })

  it('jumps to a meteor strike, goes older on the next press and starts over when a new highlight arrives', async () => {
    setTool('meteor')
    const a = getSnapshot().world.bots[0]!
    clickMap(a.x, a.y, 1)
    await settled()
    const world = getSnapshot().world
    const list = highlightsOf(world.log, world.commands)
    expect(list.length).toBeGreaterThan(1)

    expect(nextHighlight(1000)).toBe(true)
    const cam = getCamera()
    expect(cam.zoom).toBeGreaterThanOrEqual(2)
    expect(cam.follow).toBe(false)
    const first = list[0]!
    const half = world.width / (2 * cam.zoom)
    expect(cam.cx).toBeCloseTo(Math.min(world.width - half, Math.max(half, first.x)), 9)
    expect(getPulse()).toEqual({ x: first.x, y: first.y, start: 1000 })
    expect(getSnapshot().notice?.text).toContain(`Highlight 1 of ${list.length}`)

    nextHighlight(2000)
    expect(getSnapshot().notice?.text).toContain(`Highlight 2 of ${list.length}`)
    expect(getPulse()?.start).toBe(2000)

    // A new highlight arrives: the cycle starts at the newest again.
    const b = getSnapshot().world.bots.find((bot) => Math.hypot(bot.x - a.x, bot.y - a.y) > 12)!
    clickMap(b.x, b.y, 1)
    await settled()
    nextHighlight(3000)
    expect(getSnapshot().notice?.text).toContain('Highlight 1 of')
  })

  it('keeps a closer zoom and never follows', async () => {
    setTool('meteor')
    const bot = getSnapshot().world.bots[0]!
    clickMap(bot.x, bot.y, 1)
    await settled()
    setCamera({ zoom: 4, cx: 1, cy: 1, follow: true })
    nextHighlight(5)
    expect(getCamera().zoom).toBe(4)
    expect(getCamera().follow).toBe(false)
  })

  it('centres on a log row only while zoomed in', () => {
    const { width, height } = getSnapshot().world
    centreOn(10, 10)
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
    setCamera({ zoom: 2, cx: width / 2, cy: height / 2, follow: false })
    centreOn(width / 3, height / 3)
    expect(getCamera()).toMatchObject({ zoom: 2, follow: false })
    expect(getCamera().cx).toBeLessThan(width / 2)
    expect(getCamera().cy).toBeLessThan(height / 2)
  })
})

describe('auto-tour (F3)', () => {
  async function strike(): Promise<void> {
    setTool('meteor')
    const bot = getSnapshot().world.bots[0]!
    clickMap(bot.x, bot.y, 1)
    await settled()
  }

  it('is off at the start, toggles with a notice and waits when there is no highlight', () => {
    expect(getTour()).toBe(false)
    toggleTour()
    expect(getTour()).toBe(true)
    expect(getSnapshot().notice?.text).toContain('Auto-tour on')
    tourStep(0)
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
    toggleTour()
    expect(getTour()).toBe(false)
    expect(getSnapshot().notice?.text).toBe('Auto-tour off.')
  })

  it('does not replay the highlights already in the log, but jumps to the next new one', async () => {
    await strike()
    toggleTour()
    tourStep(10_000)
    expect(getCamera()).toEqual(DEFAULT_CAMERA)
    const before = highlightsOf(getSnapshot().world.log, getSnapshot().world.commands).length
    setTool('meteor')
    const target = getSnapshot().world.bots.reduce((best, b) => (b.x > best.x ? b : best))
    clickMap(target.x, target.y, 1)
    await settled()
    expect(highlightsOf(getSnapshot().world.log, getSnapshot().world.commands).length).toBeGreaterThan(before)
    // The frame that carried it already ran tourStep (the page clock), so either it jumped then or it does now.
    tourStep(performance.now() + 10_000)
    expect(getCamera().zoom).toBeGreaterThanOrEqual(2)
    expect(getCamera().follow).toBe(false)
    expect(getPulse()).not.toBeNull()
    expect(getTour()).toBe(true)
  })

  it('makes at most one jump per gap', async () => {
    toggleTour()
    await strike()
    const first = getPulse()
    expect(first).not.toBeNull()
    setTool('meteor')
    const target = getSnapshot().world.bots.reduce((best, b) => (b.x > best.x ? b : best))
    clickMap(target.x, target.y, 1)
    await settled()
    tourStep(performance.now())
    expect(getPulse()).toBe(first)
    tourStep(performance.now() + TOUR_GAP_MS + 1)
    expect(getPulse()).not.toBe(first)
    expect(getSnapshot().notice?.text).toContain('Auto-tour:')
  })

  it('turns off on a manual camera move, on N, on fit and on a new world', async () => {
    toggleTour()
    setCamera({ zoom: 2, cx: 20, cy: 10, follow: false })
    expect(getTour()).toBe(false)
    expect(getSnapshot().notice?.text).toContain('Auto-tour off')

    await strike()
    toggleTour()
    nextHighlight(5)
    expect(getTour()).toBe(false)

    toggleTour()
    zoomStep(1)
    expect(getTour()).toBe(false)

    toggleTour()
    fitCamera()
    expect(getTour()).toBe(false)

    toggleTour()
    resetWorld('camera-store-3')
    await settled()
    expect(getTour()).toBe(false)
  })
})
