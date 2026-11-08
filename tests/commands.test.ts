import { describe, expect, it } from 'vitest'

import { edenPreset, nodeDefs, rules } from '../src/content/index.ts'
import { applyCommand, checkCommand } from '../src/sim/commands.ts'
import { stateHash } from '../src/sim/hash.ts'
import { replayWorld } from '../src/sim/replay.ts'
import { step } from '../src/sim/step.ts'
import type { Command, Preset, World } from '../src/sim/types.ts'
import { createWorld } from '../src/sim/world.ts'

// Command and replay tests need the real rules and preset, so they live here
// (src/sim files may not import src/content).

const empty: Preset = {
  id: 'empty',
  label: 'Empty',
  width: 20,
  height: 20,
  nodes: [],
  scatter: [],
  bots: [],
  scatterBots: 0,
}

function advanceTo(world: World, tick: number): void {
  while (world.tick < tick) step(world, rules)
}

describe('applyCommand', () => {
  it('places a node with the numbers for its kind and logs it', () => {
    const world = createWorld('a', empty, rules)
    const result = applyCommand(world, rules, { type: 'placeNode', kind: 'danger', x: 5.5, y: 6.5 })
    expect(result).toEqual({ ok: true, id: 1 })
    const node = world.nodes[0]
    expect(node).toMatchObject({ id: 1, kind: 'danger', x: 5.5, y: 6.5, radius: nodeDefs.danger.radius, damage: nodeDefs.danger.damage })
    expect(world.nextId).toBe(2)
    expect(world.commands).toEqual([{ tick: 0, cmd: { type: 'placeNode', kind: 'danger', x: 5.5, y: 6.5 } }])
    expect(world.log.at(-1)).toMatchObject({ type: 'command', command: 'placeNode', nodeKind: 'danger', nodeId: 1 })
  })

  it('places a resource full, and a bot with default traits and full health', () => {
    const world = createWorld('a', empty, rules)
    applyCommand(world, rules, { type: 'placeNode', kind: 'resource', x: 3.5, y: 3.5 })
    expect(world.nodes[0]?.amount).toBe(nodeDefs.resource.capacity)
    const result = applyCommand(world, rules, { type: 'placeBot', x: 10.5, y: 10.5 })
    expect(result.ok).toBe(true)
    const bot = world.bots[0]
    expect(bot).toMatchObject({ x: 10.5, y: 10.5, energy: rules.tuning.bot.startEnergy, health: rules.tuning.bot.maxHealth, generation: 0 })
    expect(bot?.traits).toEqual(rules.tuning.traits)
  })

  it('removes a node and logs which kind it was', () => {
    const world = createWorld('a', empty, rules)
    applyCommand(world, rules, { type: 'placeNode', kind: 'shelter', x: 5.5, y: 5.5 })
    const result = applyCommand(world, rules, { type: 'removeNode', id: 1 })
    expect(result.ok).toBe(true)
    expect(world.nodes).toHaveLength(0)
    expect(world.log.at(-1)).toMatchObject({ command: 'removeNode', nodeKind: 'shelter', nodeId: 1 })
    expect(world.commands).toHaveLength(2)
  })

  it('rejects out-of-bounds, unknown ids and duplicates without changing anything', () => {
    const world = createWorld('a', empty, rules)
    applyCommand(world, rules, { type: 'placeNode', kind: 'resource', x: 5.5, y: 5.5 })
    const before = stateHash(world)
    const bad: Command[] = [
      { type: 'placeNode', kind: 'danger', x: -1, y: 5 },
      { type: 'placeNode', kind: 'danger', x: 5, y: 21 },
      { type: 'placeNode', kind: 'danger', x: Number.NaN, y: 5 },
      { type: 'placeNode', kind: 'resource', x: 5.5, y: 5.5 },
      { type: 'removeNode', id: 999 },
      { type: 'placeBot', x: 30, y: 5 },
    ]
    for (const cmd of bad) {
      const result = applyCommand(world, rules, cmd)
      expect(result.ok, JSON.stringify(cmd)).toBe(false)
      expect(checkCommand(world, rules, cmd)).not.toBeNull()
    }
    expect(stateHash(world)).toBe(before)
  })

  it('allows different kinds on the same spot (a grove)', () => {
    const world = createWorld('a', empty, rules)
    expect(applyCommand(world, rules, { type: 'placeNode', kind: 'danger', x: 5.5, y: 5.5 }).ok).toBe(true)
    expect(applyCommand(world, rules, { type: 'placeNode', kind: 'resource', x: 5.5, y: 5.5 }).ok).toBe(true)
  })

  it('respects the population cap and the node cap', () => {
    const capped = { ...rules, tuning: { ...rules.tuning, population: { cap: 2 }, player: { ...rules.tuning.player, maxNodes: 2 } } }
    const world = createWorld('a', empty, capped)
    expect(applyCommand(world, capped, { type: 'placeBot', x: 1, y: 1 }).ok).toBe(true)
    expect(applyCommand(world, capped, { type: 'placeBot', x: 2, y: 2 }).ok).toBe(true)
    expect(applyCommand(world, capped, { type: 'placeBot', x: 3, y: 3 })).toMatchObject({ ok: false })
    expect(applyCommand(world, capped, { type: 'placeNode', kind: 'resource', x: 5.5, y: 5.5 }).ok).toBe(true)
    expect(applyCommand(world, capped, { type: 'placeNode', kind: 'danger', x: 9.5, y: 9.5 }).ok).toBe(true)
    expect(applyCommand(world, capped, { type: 'placeNode', kind: 'shelter', x: 12.5, y: 12.5 })).toMatchObject({ ok: false })
  })

  it('keeps stepping when a node bots were heading for is removed', () => {
    const world = createWorld('a', edenPreset, rules)
    advanceTo(world, 200)
    for (const node of [...world.nodes]) applyCommand(world, rules, { type: 'removeNode', id: node.id })
    expect(world.nodes).toHaveLength(0)
    advanceTo(world, 600)
    expect(world.tick).toBe(600)
  })

  it('does not shift the ai stream when a bot is placed', () => {
    const world = createWorld('a', empty, rules)
    const aiBefore = JSON.stringify(world.rng.ai)
    applyCommand(world, rules, { type: 'placeBot', x: 5, y: 5 })
    expect(JSON.stringify(world.rng.ai)).toBe(aiBefore)
  })
})

describe('replay', () => {
  it('rebuilds the same state from seed + recorded commands', () => {
    const live = createWorld('a', edenPreset, rules)
    const script: { tick: number; cmd: Command }[] = [
      { tick: 0, cmd: { type: 'placeBot', x: 10.5, y: 10.5 } },
      { tick: 120, cmd: { type: 'placeNode', kind: 'danger', x: 36.5, y: 10.5 } },
      { tick: 120, cmd: { type: 'placeNode', kind: 'shelter', x: 30.5, y: 20.5 } },
      { tick: 400, cmd: { type: 'removeNode', id: 1 } },
      { tick: 900, cmd: { type: 'placeNode', kind: 'resource', x: 60.5, y: 30.5 } },
    ]
    for (const { tick, cmd } of script) {
      advanceTo(live, tick)
      expect(applyCommand(live, rules, cmd).ok, JSON.stringify(cmd)).toBe(true)
    }
    advanceTo(live, 1500)
    expect(live.commands).toHaveLength(script.length)

    const replayed = replayWorld('a', edenPreset, rules, live.commands, live.tick)
    expect(stateHash(replayed)).toBe(stateHash(live))
  })

  it('differs from a control run without the commands', () => {
    const control = createWorld('a', edenPreset, rules)
    advanceTo(control, 800)
    const live = createWorld('a', edenPreset, rules)
    advanceTo(live, 100)
    expect(applyCommand(live, rules, { type: 'placeNode', kind: 'danger', x: 40.5, y: 24.5 }).ok).toBe(true)
    advanceTo(live, 800)
    expect(stateHash(live)).not.toBe(stateHash(control))
    expect(stateHash(replayWorld('a', edenPreset, rules, live.commands, 800))).toBe(stateHash(live))
  })

  it('rejects commands out of tick order', () => {
    expect(() =>
      replayWorld('a', edenPreset, rules, [
        { tick: 10, cmd: { type: 'placeBot', x: 1, y: 1 } },
        { tick: 5, cmd: { type: 'placeBot', x: 2, y: 2 } },
      ]),
    ).toThrow(/tick order/)
  })
})
