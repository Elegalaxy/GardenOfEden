// Numbers for each kind of node. Only the fields a kind uses are non-zero.
// Danger hurts every bot inside its radius each tick; shelter heals and slows
// energy loss, and is the only place a bot reproduces.

import type { NodeDefs } from '../sim/types.ts'

export const nodeDefs: NodeDefs = {
  resource: { radius: 2, capacity: 100, regen: 0.5, damage: 0, heal: 0, drainMult: 1 },
  danger: { radius: 4, capacity: 0, regen: 0, damage: 3, heal: 0, drainMult: 1 },
  shelter: { radius: 3, capacity: 0, regen: 0, damage: 0, heal: 0.5, drainMult: 0.5 },
}
