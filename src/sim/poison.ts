// Toxic food (T1, `Tuning.poison`, off). With it on, `createWorld` makes the last `toxicCount` scattered resource nodes toxic (groves,
// placed food, ruins and water never are): each gets `toxin`, the health damage per unit eaten. Toxic food still gives its full energy, so
// poison is a trade-off, not a lie about the food. The damage is `take x toxin` for one bite, divided by the bot's hardiness like every
// other health damage, and lands in the same tick's `metabolise`; a bot whose health runs out dies of 'poison' only when that dose is
// strictly larger than the danger, plague and predator damage of the tick (metabolism.ts).
//
// A bot learns that a node is toxic by eating from it (`learnToxic` sets `toxic` on its memory entry; `remember` keeps the flag, and
// `chooseFood` skips such an entry unless the bot is brave). Family sharing carries the flag (family.ts). Nothing else reads it.
//
// With poison off nothing here runs and no key it adds (`toxin`, `toxic`, `eaten.toxic`, `deathsByCause.poison`) exists, so hashes are
// unchanged. No random draws. This file imports only types.ts.

import type { Bot, Tuning, WorldNode } from './types.ts'

/** Throws when the poison numbers cannot work: `toxicCount` a whole number from 0, `damagePerUnit` finite and not negative. */
export function checkPoison(poison: Tuning['poison']): void {
  const { toxicCount, damagePerUnit } = poison
  if (!(Number.isInteger(toxicCount) && toxicCount >= 0)) {
    throw new RangeError(`poison.toxicCount must be a whole number from 0, received ${toxicCount}`)
  }
  if (!(Number.isFinite(damagePerUnit) && damagePerUnit >= 0)) {
    throw new RangeError(`poison.damagePerUnit must be a finite number from 0, received ${damagePerUnit}`)
  }
}

/** Marks the last `toxicCount` nodes of the list (or all of them, when there are fewer) toxic: `toxin` = `damagePerUnit`, added after `hunt`. */
export function markToxic(nodes: readonly WorldNode[], tuning: Pick<Tuning, 'poison'>): void {
  const { toxicCount, damagePerUnit } = tuning.poison
  for (let i = Math.max(0, nodes.length - toxicCount); i < nodes.length; i += 1) nodes[i]!.toxin = damagePerUnit
}

/** The bot now knows this node is toxic: its memory entry (kept since it walked there) gets `toxic`. No entry, no change. */
export function learnToxic(bot: Pick<Bot, 'memory'>, nodeId: number): void {
  const entry = bot.memory.find((e) => e.nodeId === nodeId)
  if (entry !== undefined) entry.toxic = true
}
