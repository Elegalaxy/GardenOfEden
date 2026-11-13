// Content assembled for the sim: the Rules value passed to createWorld and step.

import type { Rules } from '../sim/types.ts'
import { nodeDefs } from './nodeDefs.ts'
import { tuning } from './tuning.ts'

export { nodeDefs } from './nodeDefs.ts'
export { blankPreset, edenPreset, findPreset, presets } from './presets.ts'
export { tuning } from './tuning.ts'

export const rules: Rules = { tuning, nodeDefs }
