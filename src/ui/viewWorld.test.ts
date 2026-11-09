import { describe, expect, it } from 'vitest'

import { edenPreset, rules, tuning } from '../content/index.ts'
import { applyCommand, checkCommand } from '../sim/commands.ts'
import { step } from '../sim/step.ts'
import { TRAIT_NAMES, meanTraits, traitStats } from '../sim/traits.ts'
import type { Command, World } from '../sim/types.ts'
import { createWorld, takeSample, totalDeaths, totalFood, totalRuinFood } from '../sim/world.ts'
import { activeEntries } from '../sim/worldEvents.ts'
import { blockedReason } from './eventInfo.ts'
import { botAt, findBot, findNode, nodeAt, pickAt } from './geometry.ts'
import type { Frame } from './protocol.ts'
import { drawWorld } from './render.ts'
import { buildFrame } from './simHost.ts'
import { applyFrame, toViewWorld } from './viewWorld.ts'
import type { ViewWorld } from './viewWorld.ts'

// The page draws and reads from a ViewWorld built out of frames. These tests check that it answers
// every question the panels ask exactly as the World it mirrors does.

function busyWorld(): World {
  const world = createWorld('mirror', edenPreset, rules)
  for (let i = 0; i < 300; i += 1) step(world, rules)
  applyCommand(world, rules, { type: 'placeNode', kind: 'danger', x: 30.5, y: 30.5 })
  applyCommand(world, rules, { type: 'triggerEvent', event: 'plague', x: 50.5, y: 20.5 })
  applyCommand(world, rules, { type: 'triggerEvent', event: 'drought' })
  applyCommand(world, rules, { type: 'triggerEvent', event: 'meteor', x: 70.5, y: 40.5 })
  for (let i = 0; i < 40; i += 1) step(world, rules)
  return world
}

const run = (world: World, runId = 0): Frame['run'] => ({
  runId,
  seed: world.seed,
  presetId: 'eden',
  width: world.width,
  height: world.height,
})

describe('ViewWorld', () => {
  const world = busyWorld()
  const view = toViewWorld(world, 'eden')

  it('has the same per-tick facts as the world, bots without memory', () => {
    expect(view).toMatchObject({ seed: 'mirror', tick: world.tick, width: world.width, height: world.height, runId: 0, presetId: 'eden' })
    expect(view.nodes).toEqual(world.nodes)
    expect(view.events).toEqual(world.events)
    expect(view.samples).toEqual(world.samples)
    expect(view.log).toEqual(world.log)
    expect(view.commands).toEqual(world.commands)
    expect(view.commandCount).toBe(world.commands.length)
    expect(view.deathsByCause).toEqual(world.deathsByCause)
    expect(view.lineageLength).toBe(world.lineage.length)
    expect(view.bots).toHaveLength(world.bots.length)
    expect(view.bots.some((bot) => Object.hasOwn(bot, 'memory'))).toBe(false)
    expect(view.nodes).not.toBe(world.nodes)
  })

  it('gives the numbers the panels compute the same answers', () => {
    expect(takeSample(view)).toEqual(takeSample(world))
    expect(totalFood(view)).toBe(totalFood(world))
    expect(totalRuinFood(view)).toBe(totalRuinFood(world))
    expect(totalDeaths(view)).toBe(totalDeaths(world))
    expect(traitStats(view.bots)).toEqual(traitStats(world.bots))
    expect(meanTraits(view.bots)).toEqual(meanTraits(world.bots))
    expect(activeEntries(view, tuning)).toEqual(activeEntries(world, tuning))
    expect(activeEntries(view, tuning).length).toBeGreaterThan(1)
    for (const name of TRAIT_NAMES) expect(traitStats(view.bots)?.[name].mean).toBe(traitStats(world.bots)?.[name].mean)
  })

  it('gives the same picks, lookups and hover checks as the world', () => {
    for (let x = 0.5; x < world.width; x += 6.5) {
      for (let y = 0.5; y < world.height; y += 5.5) {
        for (const alpha of [0, 0.5, 1]) {
          expect(pickAt(view, x, y, alpha, 3)).toEqual(pickAt(world, x, y, alpha, 3))
          expect(botAt(view, x, y, alpha, 3)?.id).toBe(botAt(world, x, y, alpha, 3)?.id)
        }
        expect(nodeAt(view, x, y)?.id).toBe(nodeAt(world, x, y)?.id)
      }
    }
    for (const bot of world.bots) expect(findBot(view, bot.id)?.id).toBe(bot.id)
    for (const node of world.nodes) expect(findNode(view, node.id)).toEqual(node)
    expect(findBot(view, 999_999)).toBeUndefined()
  })

  it('accepts and refuses commands exactly as the world does (the hover ghost)', () => {
    const commands: Command[] = [
      { type: 'placeNode', kind: 'danger', x: 30.5, y: 30.5 }, // too close to the one just placed
      { type: 'placeNode', kind: 'shelter', x: 30.5, y: 30.5 },
      { type: 'placeNode', kind: 'ruin', x: 1.5, y: 1.5 },
      { type: 'placeNode', kind: 'resource', x: -1, y: 5 },
      { type: 'removeNode', id: world.nodes[0]!.id },
      { type: 'removeNode', id: 123456 },
      { type: 'placeBot', x: 2.5, y: 2.5 },
      { type: 'placeBot', x: 9999, y: 2.5 },
      { type: 'triggerEvent', event: 'drought' }, // already running
      { type: 'triggerEvent', event: 'bounty' },
      { type: 'triggerEvent', event: 'plague', x: 10.5, y: 10.5 },
      { type: 'triggerEvent', event: 'meteor', x: 10.5, y: 10.5 },
    ]
    for (const cmd of commands) expect(checkCommand(view, rules, cmd)).toBe(checkCommand(world, rules, cmd))
    expect(commands.map((cmd) => checkCommand(view, rules, cmd)).filter((reason) => reason !== null).length).toBeGreaterThan(3)
    for (const kind of ['drought', 'bounty', 'plague', 'meteor'] as const) {
      expect(blockedReason(view, rules, kind)).toBe(blockedReason(world, rules, kind))
    }
  })

  it('draws exactly what the world draws', () => {
    const record = (source: unknown): string[] => {
      const calls: string[] = []
      const ctx = new Proxy(
        {},
        {
          get: (_target, name) => {
            if (name === 'measureText') return (text: string) => ({ width: text.length * 6 })
            return (...args: unknown[]) => void calls.push(`${String(name)}(${JSON.stringify(args)})`)
          },
          set: (_target, name, value) => {
            calls.push(`${String(name)}=${JSON.stringify(value)}`)
            return true
          },
        },
      ) as unknown as CanvasRenderingContext2D
      const overlay = { selection: { kind: 'bot' as const, id: world.bots[0]!.id }, hover: null, ghost: null }
      drawWorld(ctx, source as ViewWorld, 0.4, { width: 800, height: 600 }, tuning, overlay)
      return calls
    }
    const fromView = record(view)
    const fromWorld = record(world)
    expect(fromView.length).toBeGreaterThan(500)
    expect(fromView).toEqual(fromWorld)
  })
})

describe('applyFrame', () => {
  it('updates the view in place for the same run and replaces the slow lists only when they come', () => {
    const world = createWorld('apply', edenPreset, rules)
    const first = toViewWorld(world, 'eden')
    const samples = first.samples
    const log = first.log
    for (let i = 0; i < 100; i += 1) step(world, rules)

    const fast = structuredClone(buildFrame(world, run(world), null, false))
    expect(fast.slow).toBeNull()
    const same = applyFrame(first, fast)
    expect(same).toBe(first)
    expect(first.tick).toBe(100)
    expect(first.bots).toEqual(fast.fast.bots)
    expect(first.samples).toBe(samples) // slow data keeps its previous value (and identity)
    expect(first.log).toBe(log)

    const slow = structuredClone(buildFrame(world, run(world), null, true))
    applyFrame(first, slow)
    expect(first.samples).toBe(slow.slow!.samples)
    expect(first.samples).not.toBe(samples)
    expect(first.samples.length).toBeGreaterThan(samples.length)
  })

  it('starts a new ViewWorld for a frame from another run, and for no view', () => {
    const world = createWorld('apply', edenPreset, rules)
    const first = toViewWorld(world, 'eden')
    const other = createWorld('different', edenPreset, rules)
    const next = applyFrame(first, structuredClone(buildFrame(other, run(other, 1), null, true)))
    expect(next).not.toBe(first)
    expect(next).toMatchObject({ runId: 1, seed: 'different', tick: 0 })
    expect(first.seed).toBe('apply') // the old one is left alone
    const none = applyFrame(null, structuredClone(buildFrame(other, run(other, 4), null, true)))
    expect(none.runId).toBe(4)
  })

  it('shows the selected bot with its memory only from slow frames', () => {
    const world = createWorld('apply', edenPreset, rules)
    for (let i = 0; i < 60; i += 1) step(world, rules)
    const target = world.bots.find((bot) => bot.memory.length > 0)!
    const view = toViewWorld(world, 'eden', 0, target.id)
    expect(view.selectedBot).toEqual(target)
    const memoryBefore = target.memory.length
    step(world, rules)
    applyFrame(view, structuredClone(buildFrame(world, run(world), target.id, false)))
    expect(view.tick).toBe(61)
    expect(view.selectedBot?.memory.length).toBe(memoryBefore) // unchanged until the next slow frame
  })
})
