import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FromWorker, ToWorker } from './protocol.ts'
import { createInlineClient, createWorkerClient } from './simClient.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function collect(client: { listen(handler: (msg: FromWorker) => void): void }): FromWorker[] {
  const received: FromWorker[] = []
  client.listen((msg) => void received.push(msg))
  return received
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createInlineClient', () => {
  it('answers asynchronously, in order, from a host on the same thread', async () => {
    const client = createInlineClient()
    const received = collect(client)
    client.post({ type: 'advance', ticks: 5 })
    client.post({ type: 'sync', reqId: 1 })
    expect(received).toEqual([]) // nothing is delivered synchronously
    await tick()
    expect(received.map((m) => m.type)).toEqual(['frame', 'synced'])
    const frame = received[0]
    expect(frame?.type === 'frame' && frame.frame.fast.tick).toBe(5)
    expect(client.kind).toBe('inline')
  })

  it('copies messages both ways, so nothing is shared with the live world', async () => {
    const client = createInlineClient()
    const received = collect(client)
    const msg: ToWorker = { type: 'command', reqId: 1, cmd: { type: 'placeBot', x: 5.5, y: 5.5 } }
    client.post(msg)
    if (msg.type === 'command' && msg.cmd.type === 'placeBot') msg.cmd.x = 90.5 // changed after posting
    await tick()
    const frame = received.find((m) => m.type === 'frame')
    if (frame?.type !== 'frame') throw new Error('no frame')
    expect(client.host.world.commands[0]?.cmd).toEqual({ type: 'placeBot', x: 5.5, y: 5.5 })
    expect(frame.frame.fast.bots).not.toBe(client.host.world.bots)
    expect(frame.frame.fast.nodes).not.toBe(client.host.world.nodes)
    expect(frame.frame.fast.nodes).toEqual(client.host.world.nodes)
  })

  it('stops delivering after terminate', async () => {
    const client = createInlineClient()
    const received = collect(client)
    client.post({ type: 'sync', reqId: 1 })
    client.terminate()
    await tick()
    expect(received).toEqual([])
  })
})

describe('createWorkerClient', () => {
  it('falls back to the inline host when there is no Worker, telling whoever listens (even late)', async () => {
    vi.stubGlobal('Worker', undefined)
    const client = createWorkerClient()
    expect(client.kind).toBe('inline')
    const reasons: string[] = []
    client.onFallback((reason) => void reasons.push(reason))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('Web Workers')
    const received = collect(client)
    client.post({ type: 'advance', ticks: 3 })
    await tick()
    expect(received[0]).toMatchObject({ type: 'frame', frame: { fast: { tick: 3 } } })
  })

  it('falls back when the Worker cannot be constructed', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked by a policy')
        }
      },
    )
    const client = createWorkerClient()
    const reasons: string[] = []
    client.onFallback((reason) => void reasons.push(reason))
    expect(client.kind).toBe('inline')
    expect(reasons[0]).toContain('blocked by a policy')
  })

  it('falls back, replaying what was sent meanwhile, when the worker fails before it is ready', async () => {
    const made: { onerror: ((event: Partial<ErrorEvent>) => void) | null; terminated: boolean }[] = []
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: unknown = null
        onerror: ((event: Partial<ErrorEvent>) => void) | null = null
        terminated = false
        constructor() {
          made.push(this)
        }
        postMessage(): void {}
        terminate(): void {
          this.terminated = true
        }
      },
    )
    const client = createWorkerClient()
    const received = collect(client)
    const reasons: string[] = []
    client.onFallback((reason) => void reasons.push(reason))
    expect(client.kind).toBe('worker')

    client.post({ type: 'advance', ticks: 4 })
    client.post({ type: 'sync', reqId: 9 })
    made[0]!.onerror?.({ message: 'script failed to load', preventDefault() {} })

    expect(client.kind).toBe('inline')
    expect(made[0]!.terminated).toBe(true)
    expect(reasons[0]).toContain('script failed to load')
    await tick()
    expect(received.map((m) => m.type)).toEqual(['frame', 'synced'])
    expect(received[0]).toMatchObject({ frame: { fast: { tick: 4 } } })
  })

  it('reports an error from a worker that was running, instead of falling back', () => {
    const made: {
      onmessage: ((event: { data: FromWorker }) => void) | null
      onerror: ((event: Partial<ErrorEvent>) => void) | null
    }[] = []
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: { data: FromWorker }) => void) | null = null
        onerror: ((event: Partial<ErrorEvent>) => void) | null = null
        constructor() {
          made.push(this)
        }
        postMessage(): void {}
        terminate(): void {}
      },
    )
    const client = createWorkerClient()
    const received = collect(client)
    made[0]!.onmessage?.({ data: { type: 'ready' } })
    made[0]!.onerror?.({ message: 'boom', preventDefault() {} })
    expect(client.kind).toBe('worker')
    expect(received.map((m) => m.type)).toEqual(['ready', 'error'])
  })
})
