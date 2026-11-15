import { describe, expect, it } from 'vitest'

import { stateHash } from '../sim/hash.ts'
import type { Command } from '../sim/types.ts'
import { bulkCommands } from './bulk.ts'
import type { FromWorker } from './protocol.ts'
import { BATCH_KIND_REASON, BATCH_SIZE_REASON, MAX_BATCH, createSimHost } from './simHost.ts'

// A `commands` batch (bulk placing, M19) must leave exactly the world, hash, heat and command list that the same commands
// sent one at a time leave; it only answers once.

function seeded(): () => number {
  let state = 99
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function mixed(): Command[] {
  return [...bulkCommands(null, 60, 96, 64, seeded()), ...bulkCommands('danger', 20, 96, 64, seeded()), ...bulkCommands('water', 20, 96, 64, seeded())]
}

describe('the commands message', () => {
  it('gives the same hash, commands and heat as the same commands one by one', () => {
    const cmds = mixed()
    const single = createSimHost()
    single.handle({ type: 'advance', ticks: 40 })
    for (const cmd of cmds) single.handle({ type: 'command', reqId: 1, cmd })
    single.handle({ type: 'advance', ticks: 60 })

    const batch = createSimHost()
    batch.handle({ type: 'advance', ticks: 40 })
    batch.handle({ type: 'commands', reqId: 1, cmds })
    batch.handle({ type: 'advance', ticks: 60 })

    expect(stateHash(batch.world)).toBe(stateHash(single.world))
    expect(batch.world.commands).toEqual(single.world.commands)
    expect(batch.world.commands.length).toBeGreaterThan(50)
    expect(batch.heat.total.traffic).toEqual(single.heat.total.traffic)
  })

  it('answers with one frame, one result list and one heat snapshot', () => {
    const host = createSimHost()
    host.handle({ type: 'heat', layer: 'traffic', range: 'all' })
    const out: FromWorker[] = host.handle({ type: 'commands', reqId: 7, cmds: mixed() })
    expect(out.map((m) => m.type)).toEqual(['frame', 'commandsResult', 'heatSnapshot'])
    const result = out[1]
    if (result?.type !== 'commandsResult') throw new Error('no result')
    expect(result.reqId).toBe(7)
    expect(result.results).toHaveLength(100)
    expect(result.results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(95) // a few spots can sit too close to an existing node
  })

  it('refuses other command kinds and the part beyond the batch limit, and applies the rest', () => {
    const host = createSimHost()
    const cmds: Command[] = [
      { type: 'triggerEvent', event: 'drought', x: 1, y: 1 },
      ...bulkCommands(null, MAX_BATCH, 96, 64, seeded()),
    ]
    const out = host.handle({ type: 'commands', reqId: 1, cmds })
    const result = out.find((m) => m.type === 'commandsResult')
    if (result?.type !== 'commandsResult') throw new Error('no result')
    expect(result.results[0]).toEqual({ ok: false, reason: BATCH_KIND_REASON })
    expect(result.results[MAX_BATCH]).toEqual({ ok: false, reason: BATCH_SIZE_REASON })
    expect(result.results.filter((r) => r.ok)).toHaveLength(MAX_BATCH - 1)
    expect(host.world.commands).toHaveLength(MAX_BATCH - 1)
  })
})
