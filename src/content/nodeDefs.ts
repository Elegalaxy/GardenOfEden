// Numbers for each kind of node. Only the fields a kind uses are non-zero.
// Danger hurts every bot inside its radius each tick; shelter heals and slows
// energy loss, and is the only place a bot reproduces. A ruin (left by a dead
// bot, see tuning.ts `ruin`) is small food that never regrows: `capacity` is
// the most one ruin can hold when deaths merge, `decay` is what it loses per
// tick. Its starting amount comes from the bot, not from here. Water is a
// permanent spring: it has a radius and nothing else, because drinking takes
// nothing from it (the drink rate is `bot.drinkRate` in tuning.ts).

import type { NodeDefs } from '../sim/types.ts'

export const nodeDefs: NodeDefs = {
  resource: { radius: 2, capacity: 100, regen: 0.5, damage: 0, heal: 0, drainMult: 1, decay: 0 },
  danger: { radius: 4, capacity: 0, regen: 0, damage: 3, heal: 0, drainMult: 1, decay: 0 },
  shelter: { radius: 3, capacity: 0, regen: 0, damage: 0, heal: 0.5, drainMult: 0.5, decay: 0 },
  water: { radius: 2, capacity: 0, regen: 0, damage: 0, heal: 0, drainMult: 1, decay: 0 },
  ruin: { radius: 1, capacity: 60, regen: 0, damage: 0, heal: 0, drainMult: 1, decay: 0.05 },
}
