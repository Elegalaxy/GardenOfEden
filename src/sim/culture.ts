// Culture: elders teach (C1, `Tuning.culture`, off). A user-approved exception to GAME_DESIGN section 5 item 1 (no sharing with strangers or
// other relatives): an old bot passes places it knows to a nearby young bot that is not its own child (a parent and its child already
// exchange memory, family.ts). What is taught is places only (`teachKinds`, water and shelter by default).
//
// Every `teachEvery` ticks (tick % teachEvery === 0), after family sharing, each young bot (age under `youngAge` x its longevity), in id
// order, takes ONE lesson from the nearest elder (age from `elderAge` x its longevity) within `teachRadius` cells; ties go to the lowest id.
// An elder that is the pupil's mother or father is skipped (grandparents and strangers may teach). A lesson copies at most `perLesson`
// entries of the elder's memory whose kind is in `teachKinds`, freshest sighting first, and only where the pupil lacks the node or knows
// an older sighting (the copy keeps `seenTick` and `amount`, as family sharing does); then the usual memory caps trim. The copy is flagged
// `taught: true` (last key of the entry; cleared when the pupil sees the node itself, absent from family copies) and counted in
// `world.culture.taught`. Elders never learn here, so no snapshot is needed and nothing chains.
//
// The elders are indexed in a coarse grid (the mating.ts pattern) built only on lesson ticks, so the work stays linear in the population.
// No random draws. State: `World.culture` {taught} exists only when culture was on at creation. This file imports only sim files.

import { mergeMemory } from './family.ts'
import { distance } from './perception.ts'
import type { Bot, NodeKind, Tuning, World } from './types.ts'

const KNOWN_KINDS: readonly NodeKind[] = ['resource', 'danger', 'shelter', 'ruin', 'water', 'predator']

/** Throws when the culture numbers cannot work: ages and radius finite above 0, elderAge above youngAge, teachEvery a whole number from 1, perLesson a whole number from 1, teachKinds a non-empty list of kinds bots remember. */
export function checkCulture(culture: Tuning['culture']): void {
  const { elderAge, youngAge, teachRadius, teachEvery, perLesson, teachKinds } = culture
  if (typeof culture.enabled !== 'boolean') throw new RangeError(`culture.enabled must be true or false, received ${String(culture.enabled)}`)
  if (!(Number.isFinite(elderAge) && elderAge > 0)) throw new RangeError(`culture.elderAge must be a finite number above 0, received ${elderAge}`)
  if (!(Number.isFinite(youngAge) && youngAge > 0)) throw new RangeError(`culture.youngAge must be a finite number above 0, received ${youngAge}`)
  if (!(elderAge > youngAge)) throw new RangeError(`culture.elderAge (${elderAge}) must be above culture.youngAge (${youngAge})`)
  if (!(Number.isFinite(teachRadius) && teachRadius > 0)) throw new RangeError(`culture.teachRadius must be a finite number above 0, received ${teachRadius}`)
  if (!(Number.isFinite(teachEvery) && teachEvery > 0)) throw new RangeError(`culture.teachEvery must be a finite number above 0, received ${teachEvery}`)
  if (!(Number.isInteger(perLesson) && perLesson >= 1)) throw new RangeError(`culture.perLesson must be a whole number from 1, received ${perLesson}`)
  if (!Array.isArray(teachKinds) || teachKinds.length === 0) throw new RangeError('culture.teachKinds must be a non-empty list of node kinds')
  for (const kind of teachKinds) {
    if (!KNOWN_KINDS.includes(kind)) throw new RangeError(`culture.teachKinds has "${String(kind)}", which bots do not remember (use ${KNOWN_KINDS.join(', ')})`)
  }
}

/** True for a bot old enough to teach (age from `elderAge` x longevity). */
export function isElder(bot: Pick<Bot, 'age' | 'traits'>, tuning: Pick<Tuning, 'culture'>): boolean {
  return bot.age >= tuning.culture.elderAge * bot.traits.longevity
}

/** True for a bot young enough to learn (age under `youngAge` x longevity). */
export function isYoung(bot: Pick<Bot, 'age' | 'traits'>, tuning: Pick<Tuning, 'culture'>): boolean {
  return bot.age < tuning.culture.youngAge * bot.traits.longevity
}

function key(cx: number, cy: number): number {
  return cx * 4096 + cy
}

/** The lesson phase (see the header). Adds to `world.culture.taught`. Returns at once with culture off, off-tick, or with no elder or no pupil. */
export function teachElders(world: World, tuning: Tuning): void {
  const culture = tuning.culture
  if (!culture.enabled || world.culture === undefined || world.tick % culture.teachEvery !== 0) return
  const cell = Math.max(4, culture.teachRadius)
  const grid = new Map<number, Bot[]>()
  let elders = 0
  let pupils = 0
  for (const bot of world.bots) {
    if (isElder(bot, tuning)) {
      const k = key(Math.floor(bot.x / cell), Math.floor(bot.y / cell))
      const list = grid.get(k)
      if (list === undefined) grid.set(k, [bot])
      else list.push(bot)
      elders += 1
    } else if (isYoung(bot, tuning)) pupils += 1
  }
  if (elders === 0 || pupils === 0) return
  const live = new Set<number>()
  for (const node of world.nodes) live.add(node.id)

  const radius = culture.teachRadius
  for (const pupil of world.bots) {
    if (isElder(pupil, tuning) || !isYoung(pupil, tuning)) continue
    let best: Bot | null = null
    let bestDistance = Infinity
    const x0 = Math.floor((pupil.x - radius) / cell)
    const x1 = Math.floor((pupil.x + radius) / cell)
    const y0 = Math.floor((pupil.y - radius) / cell)
    const y1 = Math.floor((pupil.y + radius) / cell)
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const list = grid.get(key(cx, cy))
        if (list === undefined) continue
        for (const elder of list) {
          if (elder.id === pupil.parentId || elder.id === pupil.fatherId) continue
          const d = distance(pupil.x, pupil.y, elder.x, elder.y)
          if (d <= radius && (d < bestDistance || (d === bestDistance && best !== null && elder.id < best.id))) {
            best = elder
            bestDistance = d
          }
        }
      }
    }
    if (best === null) continue
    world.culture.taught += mergeMemory(pupil, best.memory, best.id, tuning, live, { kinds: culture.teachKinds, limit: culture.perLesson, mark: true })
  }
}
