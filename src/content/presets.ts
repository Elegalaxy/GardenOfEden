// Starting scenes. `eden` is the default: a 96x64 map with scattered food,
// and shelter, a few fixed "groves" (food with a predator that makes its home there:
// rich but risky), a few springs, and a founding population. Scattered positions come
// from the world stream, so the same seed always gives the same garden.

import type { Preset } from '../sim/types.ts'

export const edenPreset: Preset = {
  id: 'eden',
  label: 'Eden',
  description: 'The standard garden: three groves with a predator each, springs spread across the map, and 40 bots to start.',
  width: 96,
  height: 64,
  nodes: [
    { kind: 'predator', x: 24, y: 16 },
    { kind: 'resource', x: 24, y: 16 },
    { kind: 'predator', x: 72, y: 48 },
    { kind: 'resource', x: 72, y: 48 },
    { kind: 'predator', x: 48, y: 34 },
    { kind: 'resource', x: 48, y: 34 },
    // Springs. Spread over the map so no stretch is far from water; the one at
    // (78, 48) is 6 cells from the south-east grove's centre, so its zone
    // touches that predator's threat radius and a bot coming from the west has to
    // skirt the predator to drink. The scattered ones below land
    // wherever the seed puts them, sometimes near food or shelter.
    { kind: 'water', x: 14, y: 44 },
    { kind: 'water', x: 82, y: 14 },
    { kind: 'water', x: 36, y: 54 },
    { kind: 'water', x: 78, y: 48 },
  ],
  scatter: [
    { kind: 'resource', count: 34 },
    { kind: 'shelter', count: 12 },
    { kind: 'water', count: 4 },
  ],
  bots: [],
  scatterBots: 40,
  // Rough ground (R1, made only while tuning.terrain.enabled). Layout A, a marsh belt on the east side, radius 6; each disc is more than
  // 6 cells from every grove centre and fixed spring (nearest: (60,44) is 12.6 from the south-east grove).
  // Layout B (patches, to compare in R2, not active): (12,10,r5), (40,8,r6), (26,32,r5), (86,32,r5), (58,58,r5).
  terrain: [
    { x: 60, y: 4, radius: 6 },
    { x: 61, y: 14, radius: 6 },
    { x: 59, y: 34, radius: 6 },
    { x: 60, y: 44, radius: 6 },
  ],
}

// A plain world: the same 96x64 map with nothing on it. The player places every
// node and bot (food, water and shelter first, or the first bots just die).
export const blankPreset: Preset = {
  id: 'blank',
  label: 'Blank',
  description: 'An empty map. Place food, water and shelter first, then the first bots.',
  width: 96,
  height: 64,
  nodes: [],
  scatter: [],
  bots: [],
  scatterBots: 0,
}

// Scenarios (doc/GAME_DESIGN "Scenarios"): ready-made starts built on the Eden layout, so the Eden numbers stay in one place.
// `script` events are applied by the sim at fixed ticks (src/sim/scenario.ts) and show in the log like any event. A scenario
// changes only the layout and the script, never tuning. The outbreak and plague spots avoid the spring at (36, 54) (an outbreak
// there kills seed f).

// Eden with only the middle grove's predator; every food node stays.
export const quietPreset: Preset = {
  ...edenPreset,
  id: 'quiet',
  label: 'Quiet Eden',
  description: 'Eden with a single predator in the middle grove: a gentler garden to watch a population settle.',
  nodes: edenPreset.nodes.filter((node) => !(node.kind === 'predator' && !(node.x === 48 && node.y === 34))),
  scatter: edenPreset.scatter.map((group) => (group.kind === 'resource' ? { ...group, count: 40 } : group)),
}

export const plagueWorldPreset: Preset = {
  ...edenPreset,
  id: 'plague-world',
  label: 'Plague world',
  description: 'Eden hit by two outbreaks of disease and then a plague: watch immunity and recovery.',
  script: [
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'outbreak', x: 14, y: 44 } },
    { tick: 9000, cmd: { type: 'triggerEvent', event: 'outbreak', x: 82, y: 14 } },
    { tick: 15000, cmd: { type: 'triggerEvent', event: 'plague', x: 48, y: 32 } },
  ],
}

export const droughtBountyPreset: Preset = {
  ...edenPreset,
  id: 'drought-bounty',
  label: 'Drought and bounty',
  description: 'Eden through two droughts, each broken by a bounty that arrives while it still runs: boom and bust for the whole map.',
  script: [
    // Each bounty starts 500 ticks into its drought (the two overlap for 1,000 ticks and end together), because a full 1,500-tick drought
    // killed at least one of seeds a..j in every spacing tried (see the changelog).
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 3500, cmd: { type: 'triggerEvent', event: 'bounty' } },
    { tick: 9000, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 9500, cmd: { type: 'triggerEvent', event: 'bounty' } },
  ],
}

// Three more groves (a predator on a food node), each at least 8 cells from the fixed springs.
export const predatorHeavyPreset: Preset = {
  ...edenPreset,
  id: 'predator-heavy',
  label: 'Predator country',
  description: 'Eden with six groves instead of three: more rich food, and more predators to dodge.',
  nodes: [
    ...edenPreset.nodes,
    { kind: 'predator', x: 12, y: 54 },
    { kind: 'resource', x: 12, y: 54 },
    { kind: 'predator', x: 84, y: 30 },
    { kind: 'resource', x: 84, y: 30 },
    { kind: 'predator', x: 40, y: 8 },
    { kind: 'resource', x: 40, y: 8 },
  ],
}

export const hardTimesPreset: Preset = {
  ...edenPreset,
  id: 'hard-times',
  label: 'Hard times (harsh)',
  description: 'Eden through a drought, a plague, a meteor and a blight. Harsh: it can end a world.',
  script: [
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 6000, cmd: { type: 'triggerEvent', event: 'plague', x: 48, y: 32 } },
    { tick: 7000, cmd: { type: 'triggerEvent', event: 'meteor', x: 24, y: 40 } },
    { tick: 9000, cmd: { type: 'triggerEvent', event: 'blight', x: 72, y: 20 } },
  ],
}

export const presets: Preset[] = [edenPreset, blankPreset, quietPreset, plagueWorldPreset, droughtBountyPreset, predatorHeavyPreset, hardTimesPreset]

export function findPreset(id: string): Preset | undefined {
  return presets.find((preset) => preset.id === id)
}
