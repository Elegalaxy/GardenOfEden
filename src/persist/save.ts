// Save format (M9). A run is fully determined by its seed, preset and the commands
// the player gave, so a save holds only that plus the tick the run had reached and
// the state hash it had there. Loading replays the commands up to `tick` and
// compares the hash (a mismatch means the simulation changed since the save).
//
//   { version: 1, seed, presetId, tick, hash, commands: [{ tick, cmd }, ...] }
//
// Everything read from a file, a link or localStorage is untrusted. `decodeSave`
// parses with JSON.parse only (nothing is evaluated), checks every field and
// rebuilds each command from known fields in the sim's own key order (the order
// matters: `World.commands` is part of the state hash). It never throws; a
// problem comes back as a typed `SaveError` with a message a player can read.
//
// This file knows only sim types, not content. Whether the preset exists, and
// whether the replay accepts every command, is checked by the ui when it loads.
// New formats bump `SAVE_VERSION`; an older save is upgraded in `upgradeSave`.

import type { Command, EventKind, NodeKind } from '../sim/types.ts'

export const SAVE_VERSION = 1

/** Longest save text accepted, in characters (about 5,000 commands fit). */
export const MAX_SAVE_CHARS = 1_000_000
export const MAX_COMMANDS = 5_000
/** Highest tick a save may claim (about 28 hours at 1x speed). */
export const MAX_TICK = 1_000_000
/** Coordinates beyond this are nonsense for any map; the replay checks the real map bounds. */
export const MAX_COORD = 100_000
const MAX_ID = 1_000_000_000

/** Kinds a `placeNode` command may carry (ruins are made by the sim). Kept in step with content by tests/save.test.ts. */
export const PLACEABLE_KINDS = ['resource', 'danger', 'shelter', 'water'] as const satisfies readonly NodeKind[]
export const EVENT_KINDS = ['drought', 'bounty', 'plague', 'meteor'] as const satisfies readonly EventKind[]

export type SavedCommand = { tick: number; cmd: Command }

export type Save = {
  version: number
  seed: string
  presetId: string
  /** The tick the run had reached when saved. */
  tick: number
  /** `stateHash` of the world at `tick`: 16 lowercase hex characters. */
  hash: string
  commands: SavedCommand[]
}

export type SaveErrorCode =
  | 'too-large'
  | 'not-json'
  | 'not-a-save'
  | 'unsupported-version'
  | 'newer-version'
  | 'bad-field'
  | 'too-many-commands'
  | 'bad-command'
  | 'bad-order'

export type SaveError = { code: SaveErrorCode; message: string }
export type SaveResult = { ok: true; save: Save } | { ok: false; error: SaveError }

const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/
const PRESET_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const HASH_PATTERN = /^[0-9a-f]{16}$/
const TOP_KEYS = ['version', 'seed', 'presetId', 'tick', 'hash', 'commands']

function fail(code: SaveErrorCode, message: string): { ok: false; error: SaveError } {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTick(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_TICK
}

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORD
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key))
}

function inList<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/** Rebuilds one command from known fields only, or null when its shape is wrong. */
function readCommand(raw: unknown): Command | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'placeNode':
      if (!onlyKeys(raw, ['type', 'kind', 'x', 'y']) || !inList(PLACEABLE_KINDS, raw.kind)) return null
      if (!isCoord(raw.x) || !isCoord(raw.y)) return null
      return { type: 'placeNode', kind: raw.kind, x: raw.x, y: raw.y }
    case 'removeNode':
      if (!onlyKeys(raw, ['type', 'id'])) return null
      if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 0 || raw.id > MAX_ID) return null
      return { type: 'removeNode', id: raw.id }
    case 'placeBot':
      if (!onlyKeys(raw, ['type', 'x', 'y']) || !isCoord(raw.x) || !isCoord(raw.y)) return null
      return { type: 'placeBot', x: raw.x, y: raw.y }
    case 'triggerEvent': {
      if (!onlyKeys(raw, ['type', 'event', 'x', 'y']) || !inList(EVENT_KINDS, raw.event)) return null
      if (raw.x !== undefined && !isCoord(raw.x)) return null
      if (raw.y !== undefined && !isCoord(raw.y)) return null
      const cmd: Command = { type: 'triggerEvent', event: raw.event }
      if (raw.x !== undefined) cmd.x = raw.x
      if (raw.y !== undefined) cmd.y = raw.y
      return cmd
    }
    default:
      return null
  }
}

/** Hook for older formats. Version 1 is the first, so nothing to upgrade yet. */
function upgradeSave(raw: Record<string, unknown>): Record<string, unknown> {
  return raw
}

/** Checks an already parsed value. Never throws. */
export function validateSave(value: unknown): SaveResult {
  if (!isRecord(value)) return fail('not-a-save', 'This is not a Garden of Eden save.')
  const version = value.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('unsupported-version', 'This save has no usable version number, so it cannot be opened.')
  }
  if (version > SAVE_VERSION) {
    return fail(
      'newer-version',
      `This save was made by a newer version of the game (save format ${version}; this one reads up to ${SAVE_VERSION}). Update the game to open it.`,
    )
  }
  const raw = upgradeSave(value)
  if (!onlyKeys(raw, TOP_KEYS)) return fail('bad-field', 'This save has fields this version does not know.')
  if (typeof raw.seed !== 'string' || !SEED_PATTERN.test(raw.seed)) {
    return fail('bad-field', 'The save has an invalid seed (1 to 32 letters, digits or dashes).')
  }
  if (typeof raw.presetId !== 'string' || !PRESET_PATTERN.test(raw.presetId)) {
    return fail('bad-field', 'The save has an invalid preset name.')
  }
  if (!isTick(raw.tick)) {
    return fail('bad-field', `The save has an invalid tick (a whole number from 0 to ${MAX_TICK}).`)
  }
  if (typeof raw.hash !== 'string' || !HASH_PATTERN.test(raw.hash)) {
    return fail('bad-field', 'The save has an invalid state hash.')
  }
  if (!Array.isArray(raw.commands)) return fail('bad-field', 'The save has no list of commands.')
  if (raw.commands.length > MAX_COMMANDS) {
    return fail('too-many-commands', `The save has too many commands (the limit is ${MAX_COMMANDS}).`)
  }

  const commands: SavedCommand[] = []
  let previousTick = 0
  for (let i = 0; i < raw.commands.length; i += 1) {
    const entry: unknown = raw.commands[i]
    const label = `Command ${i + 1}`
    if (!isRecord(entry) || !onlyKeys(entry, ['tick', 'cmd'])) {
      return fail('bad-command', `${label} is not a recorded command.`)
    }
    if (!isTick(entry.tick)) return fail('bad-command', `${label} has an invalid tick.`)
    if (entry.tick > raw.tick) {
      return fail('bad-order', `${label} happens after the tick the run was saved at (${raw.tick}).`)
    }
    if (entry.tick < previousTick) {
      return fail('bad-order', `${label} is out of order: its tick is earlier than the command before it.`)
    }
    const cmd = readCommand(entry.cmd)
    if (cmd === null) return fail('bad-command', `${label} is not a command this game knows.`)
    previousTick = entry.tick
    commands.push({ tick: entry.tick, cmd })
  }

  return {
    ok: true,
    save: { version: SAVE_VERSION, seed: raw.seed, presetId: raw.presetId, tick: raw.tick, hash: raw.hash, commands },
  }
}

/** Parses and checks save text. Never throws. */
export function decodeSave(text: string): SaveResult {
  if (typeof text !== 'string') return fail('not-json', 'The save could not be read.')
  if (text.length > MAX_SAVE_CHARS) {
    return fail('too-large', 'This file is too large to be a save (over 1 MB).')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail('not-json', 'This is not a save file: it is not valid JSON.')
  }
  return validateSave(parsed)
}

/** The save as compact JSON text. */
export function encodeSave(save: Save): string {
  return JSON.stringify({
    version: save.version,
    seed: save.seed,
    presetId: save.presetId,
    tick: save.tick,
    hash: save.hash,
    commands: save.commands.map((entry) => ({ tick: entry.tick, cmd: entry.cmd })),
  })
}

/** Builds a save from the pieces of a live run. `hash` is `stateHash(world)` (computed by the caller, since this layer holds no sim code). */
export function makeSave(
  run: { seed: string; tick: number; commands: readonly SavedCommand[] },
  presetId: string,
  hash: string,
): Save {
  return {
    version: SAVE_VERSION,
    seed: run.seed,
    presetId,
    tick: run.tick,
    hash,
    commands: run.commands.map((entry) => ({ tick: entry.tick, cmd: { ...entry.cmd } })),
  }
}

/** File name for a downloaded save. Seeds are letters, digits and dashes, so this is always safe. */
export function saveFileName(save: Pick<Save, 'seed' | 'tick'>): string {
  return `garden-of-eden-${save.seed}-t${save.tick}.json`
}
