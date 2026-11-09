import { describe, expect, it } from 'vitest'

import { edenPreset, rules } from '../content/index.ts'
import { applyCommand } from '../sim/commands.ts'
import { step } from '../sim/step.ts'
import type { Command, SimEvent } from '../sim/types.ts'
import { createWorld } from '../sim/world.ts'
import { commandEvent, mergeLog } from './logMerge.ts'

describe('commandEvent', () => {
  it('rebuilds each command with what the record knows', () => {
    expect(commandEvent({ tick: 4, cmd: { type: 'placeNode', kind: 'water', x: 3.5, y: 2.5 } })).toEqual({
      event: { tick: 4, type: 'command', command: 'placeNode', nodeKind: 'water', x: 3.5, y: 2.5 },
      located: true,
    })
    expect(commandEvent({ tick: 5, cmd: { type: 'placeBot', x: 1.5, y: 1.5 } }).event).toMatchObject({ command: 'placeBot', x: 1.5, y: 1.5 })
    expect(commandEvent({ tick: 6, cmd: { type: 'removeNode', id: 9 } })).toEqual({
      event: { tick: 6, type: 'command', command: 'removeNode', nodeId: 9, x: 0, y: 0 },
      located: false,
    })
    expect(commandEvent({ tick: 7, cmd: { type: 'triggerEvent', event: 'drought' } }).event).toMatchObject({
      command: 'triggerEvent',
      eventKind: 'drought',
    })
    expect(commandEvent({ tick: 8, cmd: { type: 'triggerEvent', event: 'meteor', x: 4.5, y: 5.5 } }).event).toMatchObject({
      eventKind: 'meteor',
      x: 4.5,
      y: 5.5,
    })
  })
})

describe('mergeLog', () => {
  const birth = (tick: number): SimEvent => ({ tick, type: 'birth', botId: tick, x: 1, y: 1 })
  const command = (tick: number): SimEvent => ({ tick, type: 'command', command: 'placeBot', botId: 100 + tick, x: 1, y: 1 })

  it('is just the ring when every command is still in it', () => {
    const log = [birth(1), command(2), birth(3)]
    const merged = mergeLog(log, [{ tick: 2, cmd: { type: 'placeBot', x: 1, y: 1 } }])
    expect(merged.map((entry) => entry.event)).toEqual(log)
    expect(merged.every((entry) => entry.located)).toBe(true)
  })

  it('puts the commands the ring dropped first, without repeating the ones it kept', () => {
    const commands = [
      { tick: 1, cmd: { type: 'placeBot', x: 1, y: 1 } },
      { tick: 2, cmd: { type: 'placeBot', x: 2, y: 2 } },
      { tick: 3, cmd: { type: 'placeBot', x: 3, y: 3 } },
    ] satisfies { tick: number; cmd: Command }[]
    const log = [birth(5), command(3), birth(6)]
    const merged = mergeLog(log, commands)
    expect(merged).toHaveLength(5)
    expect(merged.map((entry) => entry.event.tick)).toEqual([1, 2, 5, 3, 6])
    // Two commands rebuilt (ticks 1, 2), the logged one (tick 3) kept as is.
    expect(merged.filter((entry) => entry.event.type === 'command')).toHaveLength(3)
    expect(merged[0]!.event).toMatchObject({ tick: 1, x: 1, y: 1 })
    expect(merged[3]!.event).toBe(log[1])
  })

  it('shows two commands on the same tick once each', () => {
    const commands = [
      { tick: 7, cmd: { type: 'placeBot', x: 1, y: 1 } },
      { tick: 7, cmd: { type: 'placeBot', x: 2, y: 2 } },
    ] satisfies { tick: number; cmd: Command }[]
    const merged = mergeLog([command(7)], commands)
    expect(merged.filter((entry) => entry.event.type === 'command')).toHaveLength(2)
    expect(merged[0]!.event).toMatchObject({ x: 1, y: 1 })
  })

  it('never drops a ring entry if the command list is shorter than the ring says', () => {
    const log = [command(1), command(2)]
    expect(mergeLog(log, [])).toHaveLength(2)
  })

  it('keeps every command of a real run after the sim ring has trimmed them', () => {
    const small = { ...rules, tuning: { ...rules.tuning, logCap: 6 } }
    const world = createWorld('log', edenPreset, small)
    const placed: Command[] = []
    for (let i = 0; i < 8; i += 1) {
      const cmd: Command = { type: 'placeNode', kind: 'resource', x: 0.5 + i * 2, y: 0.5 }
      expect(applyCommand(world, small, cmd).ok).toBe(true)
      placed.push(cmd)
      for (let t = 0; t < 40; t += 1) step(world, small)
    }
    expect(world.log).toHaveLength(6)
    expect(world.log.filter((event) => event.type === 'command').length).toBeLessThan(placed.length)

    const merged = mergeLog(world.log, world.commands)
    const commandEntries = merged.filter((entry) => entry.event.type === 'command')
    expect(commandEntries).toHaveLength(placed.length)
    expect(commandEntries.map((entry) => entry.event.x)).toEqual(placed.map((cmd) => (cmd.type === 'placeNode' ? cmd.x : -1)))
    // Tick order throughout, and the ring is untouched at the end.
    const ticks = merged.map((entry) => entry.event.tick)
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
    expect(merged.slice(-world.log.length).map((entry) => entry.event)).toEqual(world.log)
  })
})
