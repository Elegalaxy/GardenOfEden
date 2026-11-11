// The simulation worker (M13): a thin adapter. All the logic is in simHost.ts; this file only
// connects it to the worker's message port. It is started by simClient.ts. The 'webworker' lib is
// not in the TypeScript config (it clashes with the DOM lib the page needs), so `self` is typed here.

import { transferListOf } from './protocol.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import { createHostRunner } from './simHost.ts'

const ctx = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null
}

const runner = createHostRunner((message) => ctx.postMessage(message, transferListOf(message)))
ctx.onmessage = (event) => runner.receive(event.data)
ctx.postMessage({ type: 'ready' })
