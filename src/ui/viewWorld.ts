// The page's copy of the world (M13). The simulation lives in a worker; the page keeps a
// `ViewWorld` built from the frames it sends and draws and reads from that. It has the
// fields of a `World` the panels use, with two differences: bots have no memory list (only
// counts, see ViewBot), and the big lists (samples, log, commands) are only as fresh as the
// last slow frame (about four times a second, and right after anything that changes them).
// The per-tick numbers (tick, nodes, bots, events, totals) are exact for every frame.
//
// A ViewWorld is updated in place by `applyFrame`, like the World it mirrors was, so a
// panel's memo keyed on the object keeps working; a frame from a different run starts a
// new object. The slow lists are replaced whole (never edited), so their identity says
// when they changed.

import type { Bot, World } from '../sim/types.ts'
import type { Frame, ViewBot } from './protocol.ts'
import { buildFrame } from './simHost.ts'

export type ViewWorld = Pick<
  World,
  | 'seed'
  | 'tick'
  | 'width'
  | 'height'
  | 'nodes'
  | 'events'
  | 'deathsByCause'
  | 'eaten'
  | 'totalBirths'
  | 'familyLearned'
  | 'samples'
  | 'log'
  | 'commands'
> & {
  runId: number
  presetId: string
  /** Player commands applied so far (exact every frame; `commands` itself is only as fresh as the slow data). */
  commandCount: number
  bots: ViewBot[]
  /** The selected bot with its full memory (slow data), or null. */
  selectedBot: Bot | null
  lineageLength: number
}

function fresh(frame: Frame): ViewWorld {
  const { run, fast, slow } = frame
  return {
    runId: run.runId,
    presetId: run.presetId,
    seed: run.seed,
    width: run.width,
    height: run.height,
    tick: fast.tick,
    nodes: fast.nodes,
    bots: fast.bots,
    events: fast.events,
    deathsByCause: fast.deathsByCause,
    eaten: fast.eaten,
    totalBirths: fast.totalBirths,
    familyLearned: fast.familyLearned,
    lineageLength: fast.lineageLength,
    commandCount: fast.commandCount,
    samples: slow?.samples ?? [],
    log: slow?.log ?? [],
    commands: slow?.commands ?? [],
    selectedBot: slow?.selectedBot ?? null,
  }
}

/** Puts a frame into the view. A frame from another run (or no view yet) gives a new ViewWorld; otherwise `view` is updated and returned. */
export function applyFrame(view: ViewWorld | null, frame: Frame): ViewWorld {
  if (view === null || view.runId !== frame.run.runId) return fresh(frame)
  const { fast, slow } = frame
  view.tick = fast.tick
  view.nodes = fast.nodes
  view.bots = fast.bots
  view.events = fast.events
  view.deathsByCause = fast.deathsByCause
  view.eaten = fast.eaten
  view.totalBirths = fast.totalBirths
  view.familyLearned = fast.familyLearned
  view.lineageLength = fast.lineageLength
  view.commandCount = fast.commandCount
  if (slow !== null) {
    view.samples = slow.samples
    view.log = slow.log
    view.commands = slow.commands
    view.selectedBot = slow.selectedBot
  }
  return view
}

/** A ViewWorld for a World: the first frame of a run, as the page sees it (used for the page's first paint, and by tests). */
export function toViewWorld(world: World, presetId: string, runId = 0, selectedId: number | null = null): ViewWorld {
  const run = { runId, seed: world.seed, presetId, width: world.width, height: world.height }
  return applyFrame(null, structuredClone(buildFrame(world, run, selectedId, true)))
}
