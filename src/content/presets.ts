// Starting scenes. `eden` is the default: a 96x64 map with scattered food,
// danger and shelter, a few fixed "groves" (food growing inside a danger
// zone: rich but risky), and a founding population. Scattered positions come
// from the world stream, so the same seed always gives the same garden.

import type { Preset } from '../sim/types.ts'

export const edenPreset: Preset = {
  id: 'eden',
  label: 'Eden',
  width: 96,
  height: 64,
  nodes: [
    { kind: 'danger', x: 24, y: 16 },
    { kind: 'resource', x: 24, y: 16 },
    { kind: 'danger', x: 72, y: 48 },
    { kind: 'resource', x: 72, y: 48 },
    { kind: 'danger', x: 48, y: 34 },
    { kind: 'resource', x: 48, y: 34 },
  ],
  scatter: [
    { kind: 'resource', count: 28 },
    { kind: 'danger', count: 4 },
    { kind: 'shelter', count: 7 },
  ],
  bots: [],
  scatterBots: 40,
}

export const presets: Preset[] = [edenPreset]

export function findPreset(id: string): Preset | undefined {
  return presets.find((preset) => preset.id === id)
}
