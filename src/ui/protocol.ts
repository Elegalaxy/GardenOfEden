// The messages between the page and the simulation worker (M13). Types only: the
// simulation runs behind `SimHost` (simHost.ts), in a Web Worker in the browser, and the
// page talks to it through a `SimClient` (simClient.ts). Every message is plain data that
// survives structured clone (no functions, no class instances).
//
// To the worker:
//   advance{ticks, slow?}   run that many ticks, reply with a frame. `slow: true` asks for the slow
//                           data too (the page sets it while paused). At most one is in flight (the
//                           page's clock waits for the frame), so a slow worker throttles itself.
//   command{reqId, cmd}     apply a player command between two ticks, in message order.
//   reset{seed, presetId?}  start a new world (the eden preset when no preset is given).
//   load{save}              rebuild a saved run in slices; progress comes back as messages.
//   cancelLoad              stop that load; the current run is kept.
//   exportSave{reqId}       the run as a Save (the state hash is computed here, off the page's thread).
//   select{id}              the bot whose full record (with memory) rides along with slow data, or null.
//   query{reqId, kind, ...} read-only family-tree questions (lineage.ts), for the tree view (M14).
//   heat{layer, range}      reserved for the heatmaps (M15). The host accepts and ignores it for now.
//   sync{reqId}             answered with `synced` once every earlier message has been answered.
//
// From the worker:
//   ready                   the worker started (the page falls back to running the host itself if it never comes).
//   frame{frame, ack?}      the picture of the world (see Frame). `ack: 'advance'` answers an advance.
//   commandResult{...}      the command's result (the frame showing its effect is sent just before).
//   loadProgress, loadDone  the load's progress, and how it ended (a loaded run's frame is sent just before).
//   save, queryResult, synced, error

import type { CommandResult } from '../sim/commands.ts'
import type { FamilyView, FounderLine } from '../sim/lineage.ts'
import type { Save } from '../persist/save.ts'
import type {
  ActiveEvent,
  Bot,
  Command,
  DeathsByCause,
  Eaten,
  Sample,
  SimEvent,
  WorldNode,
} from '../sim/types.ts'

/** A bot as the page sees it every frame: everything except the memory list, which is bulky and only the inspector wants. */
export type ViewBot = Omit<Bot, 'memory'> & {
  /** Entries in the bot's memory. */
  memoryCount: number
  /** ...of which were learned from a parent or child. */
  learnedCount: number
}

/** Which run the frame is from, and the few facts that never change within one. */
export type RunInfo = {
  /** Changes whenever a different run replaces the current one (new world, or a load). */
  runId: number
  seed: string
  presetId: string
  width: number
  height: number
}

/** Sent with every frame. */
export type FastData = {
  tick: number
  nodes: WorldNode[]
  bots: ViewBot[]
  events: ActiveEvent[]
  totalBirths: number
  deathsByCause: DeathsByCause
  eaten: Eaten
  familyLearned: number
  /** Player commands applied so far in this run. */
  commandCount: number
  /** Records in the lineage store. */
  lineageLength: number
}

/** Sent at most about four times a second, when paused, and right after a command, a selection or a new run. */
export type SlowData = {
  samples: Sample[]
  log: SimEvent[]
  commands: { tick: number; cmd: Command }[]
  /** The selected bot with its full memory, or null when none is selected (or it is gone). */
  selectedBot: Bot | null
}

export type Frame = {
  run: RunInfo
  fast: FastData
  slow: SlowData | null
}

/** How a load ended. A loaded run is already on screen (its frame came first); a failed one carries the sentence to show. */
export type LoadResult =
  | { status: 'loaded'; hashMatches: boolean; seed: string; tick: number; commandCount: number }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

export type FamilyQuery = {
  kind: 'family'
  id: number
  up: number
  down: number
  maxNodes: number
  maxChildren?: number
}

export type FoundersQuery = { kind: 'founders' }

export type Query = FamilyQuery | FoundersQuery

export type QueryAnswer =
  | { kind: 'family'; view: FamilyView | null }
  | { kind: 'founders'; lines: FounderLine[] }

export type HeatRequest = { layer: string | null; range: number }

export type ToWorker =
  | { type: 'advance'; ticks: number; slow?: boolean }
  | { type: 'command'; reqId: number; cmd: Command }
  | { type: 'reset'; seed: string; presetId?: string }
  | { type: 'load'; save: Save }
  | { type: 'cancelLoad' }
  | { type: 'exportSave'; reqId: number }
  | { type: 'select'; id: number | null }
  | ({ type: 'query'; reqId: number } & Query)
  | ({ type: 'heat' } & HeatRequest)
  | { type: 'sync'; reqId: number }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'frame'; frame: Frame; ack?: 'advance' }
  | { type: 'commandResult'; reqId: number; result: CommandResult; meteorKills: number }
  | { type: 'loadProgress'; tick: number; target: number }
  | { type: 'loadDone'; outcome: LoadResult }
  | { type: 'save'; reqId: number; save: Save }
  | ({ type: 'queryResult'; reqId: number } & QueryAnswer)
  | { type: 'synced'; reqId: number }
  | { type: 'error'; message: string }
