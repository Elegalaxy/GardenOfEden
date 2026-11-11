// How the page reaches the simulation host (M13). A `SimClient` posts messages to the host and
// hands back what it sends. There are two:
//   createWorkerClient   runs the host in a Web Worker (sim.worker.ts), so stepping, replaying and
//                        hashing never block the page. If the Worker is missing, cannot start, or
//                        fails before it says `ready`, it quietly becomes an inline client, replays
//                        the messages sent meanwhile and calls `onFallback` so the page can say so.
//   createInlineClient   runs the same host on the page's own thread (queueMicrotask for messages,
//                        setTimeout between slices of a load). Used by tests and as the fallback.
// Both copy every message with structuredClone (the worker does so by itself), so the page never
// shares objects with the live world. A frame's packed bots are transferred, not copied (protocol.ts `transferListOf`).

import { createHostRunner } from './simHost.ts'
import type { HostOptions, SimHost } from './simHost.ts'
import { transferListOf } from './protocol.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

export type SimClient = {
  /** 'worker' while a real Worker is in use, 'inline' when the host runs on the page's thread. */
  readonly kind: 'worker' | 'inline'
  post(msg: ToWorker): void
  /** Sets the one handler for messages from the host. */
  listen(handler: (msg: FromWorker) => void): void
  /** Called once if a worker client had to fall back to inline. The text says why. */
  onFallback(handler: (reason: string) => void): void
  terminate(): void
}

export type InlineClient = SimClient & { readonly host: SimHost }

export function createInlineClient(options: HostOptions = {}): InlineClient {
  let handler: (msg: FromWorker) => void = () => {}
  let stopped = false
  const runner = createHostRunner((msg) => {
    const copy = structuredClone(msg, { transfer: transferListOf(msg) })
    queueMicrotask(() => {
      if (!stopped) handler(copy)
    })
  }, options)
  return {
    kind: 'inline',
    host: runner.host,
    post(msg) {
      const copy = structuredClone(msg)
      queueMicrotask(() => {
        if (!stopped) runner.receive(copy)
      })
    },
    listen(next) {
      handler = next
    },
    onFallback() {},
    terminate() {
      stopped = true
    },
  }
}

export function createWorkerClient(): SimClient {
  let handler: (msg: FromWorker) => void = () => {}
  let fallbackHandler: (reason: string) => void = () => {}
  let worker: Worker | null = null
  let inline: InlineClient | null = null
  let ready = false
  let fellBackBecause: string | null = null
  // Messages sent before the worker said `ready`, kept so an inline fallback can replay them.
  let early: ToWorker[] = []

  const fallBack = (reason: string): void => {
    if (inline !== null) return
    worker?.terminate()
    worker = null
    inline = createInlineClient()
    inline.listen(handler)
    for (const msg of early) inline.post(msg)
    early = []
    fellBackBecause = reason
    fallbackHandler(reason)
  }

  if (typeof Worker === 'undefined') {
    fallBack('This browser has no Web Workers.')
  } else {
    try {
      worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        if (event.data.type === 'ready') {
          ready = true
          early = []
        }
        handler(event.data)
      }
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault()
        if (!ready) fallBack(`The simulation worker could not start (${event.message || 'load error'}).`)
        else handler({ type: 'error', message: `The simulation worker stopped (${event.message || 'unknown error'}).` })
      }
    } catch (error) {
      fallBack(`The simulation worker could not start (${error instanceof Error ? error.message : 'unknown error'}).`)
    }
  }

  return {
    get kind() {
      return inline === null ? 'worker' : 'inline'
    },
    post(msg) {
      if (inline !== null) {
        inline.post(msg)
        return
      }
      if (!ready) early.push(msg)
      worker?.postMessage(msg)
    },
    listen(next) {
      handler = next
      inline?.listen(next)
    },
    onFallback(next) {
      fallbackHandler = next
      if (fellBackBecause !== null) next(fellBackBecause)
    },
    terminate() {
      worker?.terminate()
      inline?.terminate()
    },
  }
}
