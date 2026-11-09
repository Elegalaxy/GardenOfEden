import { beforeEach, describe, expect, it } from 'vitest'

import { clickMap, dispatch, getSnapshot, isValidSeed, resetWorld, select, setTool, stepOnce, setPaused } from './store.ts'

// The store holds one module-level world, so every test starts a fresh one.
beforeEach(() => {
  setTool('inspect')
  resetWorld('store-test')
})

describe('isValidSeed', () => {
  it('accepts 1-32 letters, digits and dashes only', () => {
    expect(isValidSeed('a')).toBe(true)
    expect(isValidSeed('Run-2')).toBe(true)
    expect(isValidSeed('')).toBe(false)
    expect(isValidSeed('has space')).toBe(false)
    expect(isValidSeed('x'.repeat(33))).toBe(false)
  })
})

describe('dispatch', () => {
  it('applies a command, records it and leaves a notice', () => {
    const before = getSnapshot().commandCount
    const result = dispatch({ type: 'placeNode', kind: 'danger', x: 5.5, y: 5.5 })
    expect(result.ok).toBe(true)
    const snap = getSnapshot()
    expect(snap.commandCount).toBe(before + 1)
    expect(snap.notice).toMatchObject({ ok: true })
    expect(snap.notice?.text).toContain('danger')
  })

  it('reports a refused command without recording it', () => {
    dispatch({ type: 'placeNode', kind: 'danger', x: 5.5, y: 5.5 })
    const count = getSnapshot().commandCount
    const result = dispatch({ type: 'placeNode', kind: 'danger', x: 5.5, y: 5.5 })
    expect(result.ok).toBe(false)
    expect(getSnapshot().commandCount).toBe(count)
    expect(getSnapshot().notice).toMatchObject({ ok: false })
  })
})

describe('world events', () => {
  it('fires a global event at once, records it and says what it does', () => {
    const before = getSnapshot().commandCount
    const result = dispatch({ type: 'triggerEvent', event: 'drought' })
    expect(result.ok).toBe(true)
    const snap = getSnapshot()
    expect(snap.commandCount).toBe(before + 1)
    expect(snap.world.events).toHaveLength(1)
    expect(snap.notice).toMatchObject({ ok: true })
    expect(snap.notice?.text).toContain('Drought started')
  })

  it('refuses the same global event while it runs, without recording it', () => {
    dispatch({ type: 'triggerEvent', event: 'bounty' })
    const count = getSnapshot().commandCount
    expect(dispatch({ type: 'triggerEvent', event: 'bounty' }).ok).toBe(false)
    expect(getSnapshot().commandCount).toBe(count)
    expect(getSnapshot().notice).toMatchObject({ ok: false })
    expect(getSnapshot().notice?.text).toContain('already active')
  })

  it('starts a plague at the clicked cell with the plague tool', () => {
    setTool('plague')
    clickMap(20.4, 30.7, 1)
    const plague = getSnapshot().world.events[0]
    expect(plague).toMatchObject({ kind: 'plague', x: 20.5, y: 30.5 })
    expect(getSnapshot().notice?.text).toContain('Plague started')
  })

  it('drops a meteor with the meteor tool and reports the bots it killed', () => {
    setTool('meteor')
    const bot = getSnapshot().world.bots[0]!
    clickMap(bot.x, bot.y, 1)
    const snap = getSnapshot()
    expect(snap.world.nodes.some((node) => node.expires > 0)).toBe(true)
    expect(snap.notice?.text).toContain('Meteor struck')
    expect(snap.notice?.text).toMatch(/\d+ bots? killed/)
  })
})

describe('clickMap', () => {
  it('places the active tool at the centre of the clicked cell', () => {
    setTool('shelter')
    clickMap(10.9, 20.1, 1)
    const node = getSnapshot().world.nodes.at(-1)
    expect(node).toMatchObject({ kind: 'shelter', x: 10.5, y: 20.5 })
  })

  it('places water with the water tool, and the Remove tool takes it away again', () => {
    setTool('water')
    clickMap(30.2, 40.8, 1)
    const node = getSnapshot().world.nodes.at(-1)
    expect(node).toMatchObject({ kind: 'water', x: 30.5, y: 40.5 })
    expect(getSnapshot().notice?.text).toContain('water')

    setTool('remove')
    clickMap(30.5, 40.5, 1)
    expect(getSnapshot().world.nodes.some((n) => n.id === node!.id)).toBe(false)
  })

  it('places a bot with the bot tool', () => {
    const bots = getSnapshot().population
    setTool('bot')
    clickMap(1.2, 1.2, 1)
    expect(getSnapshot().population).toBe(bots + 1)
  })

  it('inspect selects what is under the click, and nothing on empty ground', () => {
    setTool('resource')
    clickMap(0.5, 0.5, 1)
    const placed = getSnapshot().world.nodes.at(-1)!
    setTool('inspect')
    clickMap(0.5, 0.5, 1)
    expect(getSnapshot().selection).toEqual({ kind: 'node', id: placed.id })
    select(null)
    expect(getSnapshot().selection).toBeNull()
  })

  it('remove deletes the node under the click, and says so when there is none', () => {
    setTool('danger')
    clickMap(90.5, 60.5, 1)
    const id = getSnapshot().world.nodes.at(-1)!.id
    setTool('remove')
    clickMap(90.5, 60.5, 1)
    expect(getSnapshot().world.nodes.some((node) => node.id === id)).toBe(false)
    clickMap(90.5, 60.5, 1)
    expect(getSnapshot().notice).toMatchObject({ ok: false })
  })
})

describe('resetWorld', () => {
  it('starts a new world, clears the selection and rejects an invalid seed', () => {
    select({ kind: 'bot', id: 1 })
    expect(resetWorld('not valid!')).toBe(false)
    expect(getSnapshot().seed).toBe('store-test')
    expect(resetWorld('other')).toBe(true)
    expect(getSnapshot().seed).toBe('other')
    expect(getSnapshot().selection).toBeNull()
    expect(getSnapshot().tick).toBe(0)
  })

  it('steps one tick only while paused', () => {
    setPaused(false)
    stepOnce()
    expect(getSnapshot().tick).toBe(0)
    setPaused(true)
    stepOnce()
    expect(getSnapshot().tick).toBe(1)
    setPaused(false)
  })
})
