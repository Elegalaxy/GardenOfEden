// What the event log lists: the sim's ring of newest events plus every player command.
//
// The sim keeps only the newest `logCap` events, so old commands fall out of `world.log`, but
// `world.commands` keeps all of them. Every accepted command appends exactly one entry to
// both, in the same order, so the command events still in the ring are the newest M of the N
// commands. The older N - M are rebuilt here from the command records. The ring drops events
// oldest first, so every rebuilt command was pushed before everything in the ring: the merged
// list is the rebuilt commands followed by the ring, already in tick order, with no entry twice.
//
// A command record has less than the logged event: no id for a placed node, bot or crater, and
// no kind or position for a removed node (the node is gone). Those entries are rebuilt with
// what is known and `located: false` when the position is not.

import type { Command, SimEvent } from '../sim/types.ts'

export type LogEntry = {
  event: SimEvent
  /** False when `event.x` and `event.y` are unknown (a rebuilt removal), so no position is shown. */
  located: boolean
}

export type CommandRecord = { tick: number; cmd: Command }

/** The log event an old command would have left, with whatever the record still knows. */
export function commandEvent(record: CommandRecord): LogEntry {
  const { tick, cmd } = record
  switch (cmd.type) {
    case 'placeNode':
      return { event: { tick, type: 'command', command: 'placeNode', nodeKind: cmd.kind, x: cmd.x, y: cmd.y }, located: true }
    case 'removeNode':
      return { event: { tick, type: 'command', command: 'removeNode', nodeId: cmd.id, x: 0, y: 0 }, located: false }
    case 'placeBot':
      return { event: { tick, type: 'command', command: 'placeBot', x: cmd.x, y: cmd.y }, located: true }
    case 'triggerEvent':
      return {
        event: { tick, type: 'command', command: 'triggerEvent', eventKind: cmd.event, x: cmd.x ?? 0, y: cmd.y ?? 0 },
        located: true,
      }
  }
}

/** Oldest first: the commands the ring no longer holds, then the ring itself. */
export function mergeLog(log: readonly SimEvent[], commands: readonly CommandRecord[]): LogEntry[] {
  let inRing = 0
  for (const event of log) if (event.type === 'command') inRing += 1
  const missing = Math.max(0, commands.length - inRing)
  const merged: LogEntry[] = []
  for (let i = 0; i < missing; i += 1) merged.push(commandEvent(commands[i]!))
  for (const event of log) merged.push({ event, located: true })
  return merged
}
