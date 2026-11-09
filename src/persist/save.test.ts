import { describe, expect, it } from 'vitest'

import {
  EVENT_KINDS,
  MAX_COMMANDS,
  MAX_SAVE_CHARS,
  MAX_TICK,
  PLACEABLE_KINDS,
  SAVE_VERSION,
  decodeSave,
  encodeSave,
  makeSave,
  saveFileName,
  validateSave,
} from './save.ts'
import type { Save, SaveErrorCode } from './save.ts'

const HASH = '0123456789abcdef'

function sample(): Save {
  return {
    version: SAVE_VERSION,
    seed: 'Run-7',
    presetId: 'eden',
    tick: 1500,
    hash: HASH,
    commands: [
      { tick: 0, cmd: { type: 'placeNode', kind: 'water', x: 10.5, y: 20.5 } },
      { tick: 100, cmd: { type: 'placeBot', x: 3.5, y: 4.5 } },
      { tick: 100, cmd: { type: 'removeNode', id: 12 } },
      { tick: 900, cmd: { type: 'triggerEvent', event: 'drought' } },
      { tick: 1200, cmd: { type: 'triggerEvent', event: 'meteor', x: 30.5, y: 40.5 } },
    ],
  }
}

/** A plain object copy of a save, to break one field at a time. */
function raw(): Record<string, unknown> {
  return JSON.parse(encodeSave(sample())) as Record<string, unknown>
}

function expectError(value: unknown, code: SaveErrorCode): string {
  const result = validateSave(value)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected an error')
  expect(result.error.code).toBe(code)
  expect(result.error.message.length).toBeGreaterThan(10)
  return result.error.message
}

describe('encodeSave and decodeSave', () => {
  it('roundtrips a save, including key order inside every command', () => {
    const save = sample()
    const text = encodeSave(save)
    const decoded = decodeSave(text)
    expect(decoded).toEqual({ ok: true, save })
    // The hash of a run includes its commands in key order, so the order must survive.
    expect(encodeSave((decoded as { save: Save }).save)).toBe(text)
  })

  it('roundtrips an empty run at tick 0', () => {
    const save: Save = { version: SAVE_VERSION, seed: 'a', presetId: 'eden', tick: 0, hash: HASH, commands: [] }
    expect(decodeSave(encodeSave(save))).toEqual({ ok: true, save })
  })

  it('keeps a triggerEvent with only x or only y as given', () => {
    const value = raw()
    value.commands = [{ tick: 5, cmd: { type: 'triggerEvent', event: 'plague', x: 1, y: 2 } }]
    expect(validateSave(value).ok).toBe(true)
  })

  it('makeSave copies the commands so later play cannot change the save', () => {
    const live = [{ tick: 1, cmd: { type: 'placeBot' as const, x: 1, y: 2 } }]
    const save = makeSave({ seed: 'a', tick: 5, commands: live }, 'eden', HASH)
    live[0]!.cmd.x = 99
    expect(save.commands[0]?.cmd).toEqual({ type: 'placeBot', x: 1, y: 2 })
    expect(save.version).toBe(SAVE_VERSION)
  })

  it('names the file after the seed and tick', () => {
    expect(saveFileName({ seed: 'Run-7', tick: 1500 })).toBe('garden-of-eden-Run-7-t1500.json')
  })
})

describe('decodeSave rejects', () => {
  it('text that is not JSON', () => {
    for (const text of ['', 'not json', '{"version":1', '<script>alert(1)</script>']) {
      const result = decodeSave(text)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('not-json')
    }
  })

  it('text that is too large, before parsing it', () => {
    const result = decodeSave(' '.repeat(MAX_SAVE_CHARS + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('too-large')
  })

  it('JSON that is not an object', () => {
    for (const value of [null, 3, 'x', [], true]) expectError(value, 'not-a-save')
  })

  it('a missing, wrong or non-integer version', () => {
    for (const version of [undefined, 0, -1, 1.5, '1', null]) {
      const value = raw()
      value.version = version
      expectError(value, 'unsupported-version')
    }
  })

  it('a newer version, with its own message', () => {
    const value = raw()
    value.version = SAVE_VERSION + 1
    expect(expectError(value, 'newer-version')).toContain('newer version')
  })

  it('an unknown top-level field', () => {
    const value = raw()
    value.extra = 1
    expectError(value, 'bad-field')
  })

  it('a bad seed', () => {
    for (const seed of [undefined, 5, '', 'has space', 'x'.repeat(33), '<b>', 'a/b']) {
      const value = raw()
      value.seed = seed
      expectError(value, 'bad-field')
    }
  })

  it('a bad preset id', () => {
    for (const presetId of [undefined, 5, '', 'x'.repeat(33), 'has space', '../x']) {
      const value = raw()
      value.presetId = presetId
      expectError(value, 'bad-field')
    }
  })

  it('a bad tick: negative, fractional, huge, NaN or not a number', () => {
    for (const tick of [-1, 1.5, MAX_TICK + 1, NaN, Infinity, '10', null, undefined]) {
      const value = raw()
      value.tick = tick
      expectError(value, 'bad-field')
    }
  })

  it('a bad hash', () => {
    for (const hash of [undefined, 5, '', 'ABCDEF0123456789', '0123456789abcde', '0123456789abcdefg', 'zzzzzzzzzzzzzzzz']) {
      const value = raw()
      value.hash = hash
      expectError(value, 'bad-field')
    }
  })

  it('commands that are not a list', () => {
    for (const commands of [undefined, null, {}, 'x', 3]) {
      const value = raw()
      value.commands = commands
      expectError(value, 'bad-field')
    }
  })

  it('too many commands', () => {
    const value = raw()
    value.commands = Array.from({ length: MAX_COMMANDS + 1 }, () => ({ tick: 0, cmd: { type: 'placeBot', x: 1, y: 1 } }))
    expectError(value, 'too-many-commands')
  })

  it('accepts exactly the most commands allowed', () => {
    const value = raw()
    value.commands = Array.from({ length: MAX_COMMANDS }, () => ({ tick: 0, cmd: { type: 'placeBot', x: 1, y: 1 } }))
    expect(validateSave(value).ok).toBe(true)
  })

  it('an entry that is not { tick, cmd }', () => {
    for (const entry of [null, 3, 'x', [], { tick: 1 }, { cmd: { type: 'placeBot', x: 1, y: 1 } }, { tick: 1, cmd: { type: 'placeBot', x: 1, y: 1 }, extra: 1 }]) {
      const value = raw()
      value.commands = [entry]
      expectError(value, 'bad-command')
    }
  })

  it('a command tick that is negative, fractional or not a number', () => {
    for (const tick of [-1, 0.5, '3', null, NaN]) {
      const value = raw()
      value.commands = [{ tick, cmd: { type: 'placeBot', x: 1, y: 1 } }]
      expectError(value, 'bad-command')
    }
  })

  it('commands out of order', () => {
    const value = raw()
    value.commands = [
      { tick: 50, cmd: { type: 'placeBot', x: 1, y: 1 } },
      { tick: 49, cmd: { type: 'placeBot', x: 2, y: 2 } },
    ]
    expectError(value, 'bad-order')
  })

  it('a command after the saved tick', () => {
    const value = raw()
    value.tick = 100
    value.commands = [{ tick: 101, cmd: { type: 'placeBot', x: 1, y: 1 } }]
    expectError(value, 'bad-order')
  })

  it('unknown command shapes', () => {
    const bad: unknown[] = [
      null,
      3,
      'placeBot',
      [],
      {},
      { type: 'eval', code: 'alert(1)' },
      { type: '__proto__' },
      { type: 'placeNode', kind: 'ruin', x: 1, y: 1 }, // ruins cannot be placed
      { type: 'placeNode', kind: 'lava', x: 1, y: 1 },
      { type: 'placeNode', kind: 'resource', x: 1 },
      { type: 'placeNode', kind: 'resource', x: '1', y: 1 },
      { type: 'placeNode', kind: 'resource', x: NaN, y: 1 },
      { type: 'placeNode', kind: 'resource', x: 1e9, y: 1 },
      { type: 'placeNode', kind: 'resource', x: 1, y: 1, extra: true },
      { type: 'removeNode' },
      { type: 'removeNode', id: -1 },
      { type: 'removeNode', id: 1.5 },
      { type: 'removeNode', id: '3' },
      { type: 'removeNode', id: 3, x: 1 },
      { type: 'placeBot', x: 1 },
      { type: 'placeBot', x: 1, y: Infinity },
      { type: 'triggerEvent' },
      { type: 'triggerEvent', event: 'flood' },
      { type: 'triggerEvent', event: 'meteor', x: null, y: 2 },
      { type: 'triggerEvent', event: 'meteor', x: 'a', y: 2 },
      { type: 'triggerEvent', event: 'drought', z: 1 },
    ]
    for (const cmd of bad) {
      const value = raw()
      value.commands = [{ tick: 0, cmd }]
      expectError(value, 'bad-command')
    }
  })

  it('never throws, whatever it is given', () => {
    for (const value of [undefined, null, 0, NaN, Symbol.iterator, () => 1]) {
      const result = validateSave(value)
      expect(result.ok).toBe(false)
    }
    const result = decodeSave('{"version":1,"__proto__":{"polluted":true}}')
    expect(result.ok).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('kind lists', () => {
  it('list every placeable kind and event kind once', () => {
    expect(new Set(PLACEABLE_KINDS).size).toBe(PLACEABLE_KINDS.length)
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length)
  })
})
