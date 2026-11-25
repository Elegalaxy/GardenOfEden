// The places the selected bot remembers, as a closed list under its rows: node, position and what it knows about it. Shown
// only while the run has a rule that flags memory entries (toxic food). The entries come with the slow data, so they are up
// to a quarter of a second old; each flag is a word, never a colour alone.

import type { MemoryEntry } from '../sim/types.ts'
import { findNode } from './geometry.ts'
import { KIND_LABEL, formatPoint, memoryFlags } from './labels.ts'
import { select } from './store.ts'
import type { ViewWorld } from './viewWorld.ts'

export function MemoryList({ memory, world }: { memory: readonly MemoryEntry[]; world: ViewWorld }) {
  return (
    <details className="memory-list">
      <summary>Remembered places ({memory.length})</summary>
      {memory.length === 0 ? (
        <p className="empty">Nothing remembered yet.</p>
      ) : (
        <ul>
          {memory.map((entry) => {
            const name = `${KIND_LABEL[entry.kind]} #${entry.nodeId}`
            const flags = memoryFlags(entry)
            return (
              <li key={entry.nodeId}>
                {findNode(world, entry.nodeId) === undefined ? (
                  <span>{name} (gone)</span>
                ) : (
                  <button type="button" className="link-button" onClick={() => select({ kind: 'node', id: entry.nodeId })}>
                    {name}
                  </button>
                )}
                <span className="memory-spot figure">{formatPoint(entry.x, entry.y)}</span>
                {flags.map((flag) => (
                  <span key={flag} className="memory-flag">
                    {flag}
                  </span>
                ))}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}
