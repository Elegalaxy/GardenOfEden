// The shipped rules: the Rules value passed to createWorld and step. In a file of its own so that features.ts can
// build on it and index.ts can export both without an import cycle.

import type { Rules } from '../sim/types.ts'
import { nodeDefs } from './nodeDefs.ts'
import { tuning } from './tuning.ts'

export const rules: Rules = { tuning, nodeDefs }
