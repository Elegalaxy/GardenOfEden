// Starting scenes. `eden` is the default: a 96x64 map with scattered food,
// and shelter, a few fixed "groves" (food with a predator that makes its home there:
// rich but risky), a few springs, and a founding population. Scattered positions come
// from the world stream, so the same seed always gives the same garden.

import type { Preset } from '../sim/types.ts'

export const edenPreset: Preset = {
  id: 'eden',
  label: 'Eden',
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
  width: 96,
  height: 64,
  nodes: [],
  scatter: [],
  bots: [],
  scatterBots: 0,
}

export const presets: Preset[] = [edenPreset, blankPreset]

export function findPreset(id: string): Preset | undefined {
  return presets.find((preset) => preset.id === id)
}
