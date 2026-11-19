// Rough ground (R1, `Tuning.terrain`, off). A node of kind `rough` is a permanent disc (radius only: every other field is 0 and drainMult 1,
// so it adds no key to WorldNode). A mover whose step STARTS inside any rough disc walks its normal step length times the multiplier
// (`botSpeedMult` for bots, `predatorSpeedMult` for predators); discs that overlap do not compound. Slow only: the step costs the usual
// energy, and bots do not perceive rough ground (perception.ts skips the kind), so it is never remembered or avoided.
//
// `step` builds one list of rough nodes per tick (`roughNodes`) and passes it to the movers, or passes null with terrain off, in which
// case no step is ever multiplied and the code path is the old one. The test is a squared-distance compare (dx*dx + dy*dy <= r*r), only
// + - * and <=, so it is bit-exact across engines. No random draws. `createWorld` makes the nodes from `Preset.terrain` after everything
// else, so no other node or bot changes id or position. This file imports only types.ts.

import type { Tuning, World, WorldNode } from './types.ts'

/** Throws when the terrain numbers cannot work: both multipliers finite in (0, 1], `maxCount` a whole number from 0. */
export function checkTerrain(terrain: Tuning['terrain']): void {
  const { botSpeedMult, predatorSpeedMult, maxCount } = terrain
  if (!(Number.isFinite(botSpeedMult) && botSpeedMult > 0 && botSpeedMult <= 1)) {
    throw new RangeError(`terrain.botSpeedMult must be a finite number above 0 and at most 1, received ${botSpeedMult}`)
  }
  if (!(Number.isFinite(predatorSpeedMult) && predatorSpeedMult > 0 && predatorSpeedMult <= 1)) {
    throw new RangeError(`terrain.predatorSpeedMult must be a finite number above 0 and at most 1, received ${predatorSpeedMult}`)
  }
  if (!(Number.isInteger(maxCount) && maxCount >= 0)) {
    throw new RangeError(`terrain.maxCount must be a whole number from 0, received ${maxCount}`)
  }
}

/** Is rough ground switched on? */
export function terrainOn(tuning: Pick<Tuning, 'terrain'>): boolean {
  return tuning.terrain.enabled
}

/** The rough nodes of the world, in node order. */
export function roughNodes(world: Pick<World, 'nodes'>): WorldNode[] {
  return world.nodes.filter((node) => node.kind === 'rough')
}

/** Is the point inside (or on the edge of) any rough disc? */
export function onRough(rough: readonly Pick<WorldNode, 'x' | 'y' | 'radius'>[], x: number, y: number): boolean {
  for (const node of rough) {
    const dx = x - node.x
    const dy = y - node.y
    if (dx * dx + dy * dy <= node.radius * node.radius) return true
  }
  return false
}
