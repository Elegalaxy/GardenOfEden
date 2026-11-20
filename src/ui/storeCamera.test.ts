import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CAMERA } from './camera.ts'
import { findBot } from './geometry.ts'
import { checkFollow, clickMap, fitCamera, getCamera, getSnapshot, resetWorld, select, setCamera, setTool, settled, toggleFollow, zoomStep } from './store.ts'

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
