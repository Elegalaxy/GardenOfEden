// Close kin (G1, mate choice). `kinship` is the same score as lineage.ts `relatedness` (parent and child or
// full siblings 1, half siblings 0.5, else 0), but computed from two living bots' own parent ids, so it needs
// no lineage record (records can be pruned). A null parent matches nothing, so founders and placed bots are
// kin to nobody (and, with sexes off, nobody is). Only parents and siblings count; cousins and further are 0.
//
// `tuning.mateChoice` (off in Eden): with it on, a male seeks the nearest ready female who is not close kin
// and `pairMates` pairs unrelated bots first; kin pair only as a last resort (`lastResort`). No random draws.

import type { Bot, Tuning } from './types.ts'

type Kin = Pick<Bot, 'id' | 'parentId' | 'fatherId'>

/** 1 for parent and child or full siblings, 0.5 for half siblings, else 0. Mirrors `relatedness`. */
export function kinship(a: Kin, b: Kin): number {
  if (a.parentId === b.id || a.fatherId === b.id) return 1
  if (b.parentId === a.id || b.fatherId === a.id) return 1
  const sameMother = a.parentId !== null && a.parentId === b.parentId
  const sameFather = a.fatherId !== null && a.fatherId === b.fatherId
  if (sameMother && sameFather) return 1
  return sameMother || sameFather ? 0.5 : 0
}

/** True when mate choice is on and the two are at least `avoidAt` related. */
export function avoidsKin(a: Kin, b: Kin, tuning: Pick<Tuning, 'mateChoice'>): boolean {
  return tuning.mateChoice.enabled && kinship(a, b) >= tuning.mateChoice.avoidAt
}

/** Refuses nonsense mate-choice numbers (createWorld and the CLI call it, even with the rule off). */
export function checkMateChoice(choice: Tuning['mateChoice']): void {
  if (typeof choice.enabled !== 'boolean') throw new Error('mateChoice.enabled must be true or false')
  if (typeof choice.lastResort !== 'boolean') throw new Error('mateChoice.lastResort must be true or false')
  if (!Number.isFinite(choice.avoidAt) || choice.avoidAt <= 0 || choice.avoidAt > 1) {
    throw new Error('mateChoice.avoidAt must be above 0 and at most 1')
  }
}
