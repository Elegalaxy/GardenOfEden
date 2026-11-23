// Starting scenes. `eden` is the default: a 120x80 map with scattered food,
// and shelter, a few fixed "groves" (food with a predator that makes its home there:
// rich but risky), a few springs, and a founding population. Scattered positions come
// from the world stream, so the same seed always gives the same garden.

import type { Preset } from '../sim/types.ts'

// The Eden layout (map120: 120 x 80, the old 96 x 64 scaled by 1.25 and rounded to whole cells; counts scale by 1.5625, the area ratio;
// sense, predator and event radii do not scale). Scenario scripts below are derived from these.
export const GROVE_NW = { x: 30, y: 20 }
export const GROVE_SE = { x: 90, y: 60 }
export const GROVE_MID = { x: 60, y: 42 }
export const GROVE_SW = { x: 38, y: 74 }
export const GROVE_NE = { x: 92, y: 34 }
export const SPRING_W = { x: 18, y: 55 }
export const SPRING_NE = { x: 102, y: 18 }
export const SPRING_S = { x: 45, y: 68 }
// 6 cells due west of the south-east grove's centre, as before.
export const SPRING_SE = { x: GROVE_SE.x - 6, y: GROVE_SE.y }
export const MAP_CENTRE = { x: 60, y: 40 }

export const edenPreset: Preset = {
  id: 'eden',
  label: 'Eden',
  description: 'The standard garden: five groves with a predator each, springs spread across the map, and 62 bots to start.',
  width: 120,
  height: 80,
  nodes: [
    { kind: 'predator', ...GROVE_NW },
    { kind: 'resource', ...GROVE_NW },
    { kind: 'predator', ...GROVE_SE },
    { kind: 'resource', ...GROVE_SE },
    { kind: 'predator', ...GROVE_MID },
    { kind: 'resource', ...GROVE_MID },
    { kind: 'predator', ...GROVE_SW },
    { kind: 'resource', ...GROVE_SW },
    { kind: 'predator', ...GROVE_NE },
    { kind: 'resource', ...GROVE_NE },
    // Springs. Spread over the map so no stretch is far from water; the one at
    // (96, 60) is 6 cells from the south-east grove's centre, so its zone
    // touches that predator's threat radius and a bot coming from the west has to
    // skirt the predator to drink. The scattered ones below land
    // wherever the seed puts them, sometimes near food or shelter.
    { kind: 'water', ...SPRING_W },
    { kind: 'water', ...SPRING_NE },
    { kind: 'water', ...SPRING_S },
    { kind: 'water', ...SPRING_SE },
  ],
  scatter: [
    { kind: 'resource', count: 53 },
    { kind: 'shelter', count: 19 },
    { kind: 'water', count: 6 },
  ],
  bots: [],
  scatterBots: 62,
  // Rough ground (R1, made only while tuning.terrain.enabled). Layout A, a marsh belt on the east side, radius 6; each disc is more than
  // 6 cells from every grove centre and fixed spring (nearest: (75,55) is 15.8 from the south-east grove).
  // Layout B (patches, to compare in R2, not active): (12,10,r5), (40,8,r6), (26,32,r5), (86,32,r5), (58,58,r5).
  terrain: [
    { x: 75, y: 5, radius: 6 },
    { x: 76, y: 18, radius: 6 },
    { x: 74, y: 43, radius: 6 },
    { x: 75, y: 55, radius: 6 },
  ],
}

// A plain world: the same 120x80 map with nothing on it. The player places every
// node and bot (food, water and shelter first, or the first bots just die).
export const blankPreset: Preset = {
  id: 'blank',
  label: 'Blank',
  description: 'An empty map. Place food, water and shelter first, then the first bots.',
  width: 120,
  height: 80,
  nodes: [],
  scatter: [],
  bots: [],
  scatterBots: 0,
}

// Scenarios (doc/GAME_DESIGN "Scenarios"): ready-made starts built on the Eden layout, so the Eden numbers stay in one place.
// `script` events are applied by the sim at fixed ticks (src/sim/scenario.ts) and show in the log like any event. A scenario
// changes only the layout and the script, never tuning. The outbreak and plague spots avoid the spring at (45, 68) (an outbreak
// there kills seed f).

// Eden with only the middle grove's predator; every food node stays.
export const quietPreset: Preset = {
  ...edenPreset,
  id: 'quiet',
  label: 'Quiet Eden',
  description: 'Eden with a single predator in the middle grove: a gentler garden to watch a population settle.',
  nodes: edenPreset.nodes.filter((node) => !(node.kind === 'predator' && !(node.x === GROVE_MID.x && node.y === GROVE_MID.y))),
  scatter: edenPreset.scatter.map((group) => (group.kind === 'resource' ? { ...group, count: 62 } : group)),
}

export const plagueWorldPreset: Preset = {
  ...edenPreset,
  id: 'plague-world',
  label: 'Plague world',
  description: 'Eden hit by two outbreaks of disease and then a plague: watch immunity and recovery.',
  script: [
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'outbreak', ...SPRING_W } },
    { tick: 9000, cmd: { type: 'triggerEvent', event: 'outbreak', ...SPRING_NE } },
    { tick: 15000, cmd: { type: 'triggerEvent', event: 'plague', ...MAP_CENTRE } },
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

// Three more groves on top of Eden's five (a predator on a food node), each at least 8 cells from the fixed springs.
export const predatorHeavyPreset: Preset = {
  ...edenPreset,
  id: 'predator-heavy',
  label: 'Predator country',
  description: 'Eden with eight groves instead of five: more rich food, and more predators to dodge.',
  nodes: [
    ...edenPreset.nodes,
    { kind: 'predator', x: 15, y: 68 },
    { kind: 'resource', x: 15, y: 68 },
    { kind: 'predator', x: 105, y: 38 },
    { kind: 'resource', x: 105, y: 38 },
    { kind: 'predator', x: 50, y: 10 },
    { kind: 'resource', x: 50, y: 10 },
  ],
}

export const hardTimesPreset: Preset = {
  ...edenPreset,
  id: 'hard-times',
  label: 'Hard times (harsh)',
  description: 'Eden through a drought, a plague, a meteor and a blight. Harsh: it can end a world.',
  script: [
    { tick: 3000, cmd: { type: 'triggerEvent', event: 'drought' } },
    { tick: 6000, cmd: { type: 'triggerEvent', event: 'plague', ...MAP_CENTRE } },
    { tick: 7000, cmd: { type: 'triggerEvent', event: 'meteor', x: 30, y: 50 } },
    { tick: 9000, cmd: { type: 'triggerEvent', event: 'blight', x: 90, y: 25 } },
  ],
}

export const presets: Preset[] = [edenPreset, blankPreset, quietPreset, plagueWorldPreset, droughtBountyPreset, predatorHeavyPreset, hardTimesPreset]

export function findPreset(id: string): Preset | undefined {
  return presets.find((preset) => preset.id === id)
}
