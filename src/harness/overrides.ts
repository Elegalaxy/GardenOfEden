// Harness-only tuning overrides for sweeps (`--set seasons.amplitude=0.4`, repeatable): the value of an existing
// number or boolean in the rules' tuning is replaced in a copy, so a sweep needs no edit to tuning.ts. The path must
// already exist (an unknown path is an error with a clear message, never silently ignored), and the new value must be
// a number or `true`/`false` of the same kind as the old one. Objects, arrays and text cannot be set. The rules passed
// in are never changed. Nothing here is used by the game itself.

import type { Rules } from '../sim/types.ts'

export type Override = { path: string[]; value: number | boolean }

/** Parses `a.b=1.5` or `a.b=true`; throws an Error that says what is wrong. */
export function parseOverride(text: string | undefined): Override {
  const at = text === undefined ? -1 : text.indexOf('=')
  if (text === undefined || at <= 0) throw new Error(`--set must look like path.to.number=value, received ${text ?? 'nothing'}`)
  const path = text.slice(0, at).split('.')
  if (path.some((part) => part === '')) throw new Error(`--set path has an empty part: ${text}`)
  const raw = text.slice(at + 1)
  if (raw === 'true' || raw === 'false') return { path, value: raw === 'true' }
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(value)) throw new Error(`--set value must be a finite number, true or false, received ${raw}`)
  return { path, value }
}

function setIn(node: unknown, path: string[], value: number | boolean, whole: string): unknown {
  const [head, ...rest] = path
  if (typeof node !== 'object' || node === null || Array.isArray(node) || !Object.prototype.hasOwnProperty.call(node, head)) {
    throw new Error(`--set ${whole}: no such tuning setting`)
  }
  const record = node as Record<string, unknown>
  const old = record[head]
  if (rest.length > 0) return { ...record, [head]: setIn(old, rest, value, whole) }
  if (typeof old !== typeof value || (typeof old !== 'number' && typeof old !== 'boolean')) {
    throw new Error(`--set ${whole}: only an existing ${typeof value} setting can be replaced by a ${typeof value}`)
  }
  return { ...record, [head]: value }
}

/** The rules with each override applied to a copy of the tuning, in order. */
export function withOverrides(rules: Rules, overrides: readonly Override[]): Rules {
  let tuning: unknown = rules.tuning
  for (const { path, value } of overrides) tuning = setIn(tuning, path, value, `${path.join('.')}=${value}`)
  return { ...rules, tuning: tuning as Rules['tuning'] }
}
