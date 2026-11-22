// Disease with immunity (D1, `Tuning.disease`, off). The player starts it with the instant `outbreak` event; after that it spreads by contact.
// This is a user-approved exception to GAME_DESIGN section 5 item 1 ("no direct contact between bots"): the only other contact rules are mating
// (M17) and a parent and child sharing memory (M10).
//
// Per-bot state is `Bot.illness` (types.ts), absent until a bot is touched and deleted again when it clears:
//   exposed  `dose` counts ticks spent within `contactRadius` of a sick bot; at `catchAfter` the bot falls sick. Each tick without contact
//            takes 1 off the dose, and at 0 the key is deleted.
//   sick     takes `sickDrain` health damage a tick (metabolism.ts, divided by hardiness) until tick `until`, then becomes immune.
//   immune   cannot be exposed until tick `until`, then the key is deleted (it can catch the disease again).
// `startOutbreak` makes every living bot within `outbreakRadius` of the spot sick at once. A bot that fell sick this tick does not spread it
// until the next tick. Newborns start healthy and predators are untouched. `World.disease` {infected, recovered} is created at the first
// outbreak (as the last key), so a run with no outbreak hashes the same with the rule on or off. No random draws.
// Resistance (R1, resistance.ts, off): the first outbreak with `tuning.resistance.enabled` activates it; a bot with `resist` needs a bigger dose
// (`catchThreshold`) and is sick for fewer ticks (`sickLength`). A bot without `resist` takes the plain numbers.
// This file imports only types, perception's `distance` and resistance.ts.

import { distance } from './perception.ts'
import { activate, anchor, catchThreshold, resistanceOn, sickDrainFor, sickLength } from './resistance.ts'
import type { Bot, Tuning, World } from './types.ts'

/** What disease.ts reads from the tuning; `resistance` may be left out (callers that never use it). */
type DiseaseTuning = Pick<Tuning, 'disease'> & Partial<Pick<Tuning, 'resistance'>>

const CELL = 4

/** Throws when the disease numbers cannot work: radii finite and above 0, tick counts whole numbers from 1, `sickDrain` finite and from 0. */
export function checkDisease(disease: Tuning['disease']): void {
  const { outbreakRadius, contactRadius, catchAfter, sickTicks, sickDrain, immuneTicks } = disease
  if (typeof disease.enabled !== 'boolean') throw new RangeError(`disease.enabled must be true or false, received ${String(disease.enabled)}`)
  if (!(Number.isFinite(outbreakRadius) && outbreakRadius > 0)) throw new RangeError(`disease.outbreakRadius must be a finite number above 0, received ${outbreakRadius}`)
  if (!(Number.isFinite(contactRadius) && contactRadius > 0)) throw new RangeError(`disease.contactRadius must be a finite number above 0, received ${contactRadius}`)
  if (!(Number.isInteger(catchAfter) && catchAfter >= 1)) throw new RangeError(`disease.catchAfter must be a whole number from 1, received ${catchAfter}`)
  if (!(Number.isInteger(sickTicks) && sickTicks >= 1)) throw new RangeError(`disease.sickTicks must be a whole number from 1, received ${sickTicks}`)
  if (!(Number.isFinite(sickDrain) && sickDrain >= 0)) throw new RangeError(`disease.sickDrain must be a finite number from 0, received ${sickDrain}`)
  if (!(Number.isInteger(immuneTicks) && immuneTicks >= 1)) throw new RangeError(`disease.immuneTicks must be a whole number from 1, received ${immuneTicks}`)
}

/** Health damage per tick for a bot that is sick now (before hardiness divides it), else 0. */
export function sickDamage(bot: Pick<Bot, 'illness' | 'resist'>, tuning: DiseaseTuning, resistance?: World['resistance']): number {
  if (bot.illness === undefined || bot.illness.stage !== 'sick') return 0
  // R3: a resistant bot takes less (only once the world has resistance and the bot has the key).
  if (tuning.resistance === undefined || resistance === undefined || bot.resist === undefined) return tuning.disease.sickDrain
  return sickDrainFor(bot, tuning.resistance, anchor(tuning.resistance, resistance), tuning.disease.sickDrain)
}

function makeSick(world: World, bot: Bot, tuning: DiseaseTuning): void {
  const length = tuning.resistance === undefined ? tuning.disease.sickTicks : sickLength(bot, tuning.resistance, tuning.disease.sickTicks, anchor(tuning.resistance, world.resistance))
  bot.illness = { stage: 'sick', dose: 0, until: world.tick + length }
  const counters = (world.disease ??= { infected: 0, recovered: 0 })
  counters.infected += 1
}

/** The outbreak: every living bot within `outbreakRadius` of (x, y), in id order, falls sick (an already sick bot is left alone). Returns how many fell sick. */
export function startOutbreak(world: World, x: number, y: number, tuning: DiseaseTuning): number {
  if (tuning.resistance !== undefined && resistanceOn({ resistance: tuning.resistance }) && world.resistance === undefined) activate(world, { resistance: tuning.resistance })
  let count = 0
  for (const bot of world.bots) {
    if (distance(x, y, bot.x, bot.y) > tuning.disease.outbreakRadius) continue
    if (bot.illness !== undefined && bot.illness.stage === 'sick') continue
    makeSick(world, bot, tuning)
    count += 1
  }
  return count
}

function key(cx: number, cy: number): number {
  return cx * 4096 + cy
}

/** One tick of spreading, after the bots acted (step.ts). Returns at once when no bot has an illness. */
export function spreadDisease(world: World, tuning: DiseaseTuning): void {
  if (world.disease === undefined) return
  const { contactRadius, catchAfter, immuneTicks } = tuning.disease
  let any = false
  for (const bot of world.bots) {
    if (bot.illness !== undefined) {
      any = true
      break
    }
  }
  if (!any) return

  // A grid of the bots that are sick as the tick starts, so a bot that falls sick below does not spread it until next tick.
  const cells = new Map<number, Bot[]>()
  for (const bot of world.bots) {
    if (bot.illness === undefined || bot.illness.stage !== 'sick') continue
    const k = key(Math.floor(bot.x / CELL), Math.floor(bot.y / CELL))
    const list = cells.get(k)
    if (list === undefined) cells.set(k, [bot])
    else list.push(bot)
  }

  const reach = Math.ceil(contactRadius / CELL)
  for (const bot of world.bots) {
    const illness = bot.illness
    if (illness !== undefined && illness.stage === 'sick') {
      if (illness.until <= world.tick) {
        bot.illness = { stage: 'immune', dose: 0, until: world.tick + immuneTicks }
        world.disease.recovered += 1
      }
      continue
    }
    if (illness !== undefined && illness.stage === 'immune') {
      if (illness.until <= world.tick) delete bot.illness
      continue
    }
    // Healthy or exposed: is a sick bot within contact?
    let touched = false
    if (cells.size > 0) {
      const cx = Math.floor(bot.x / CELL)
      const cy = Math.floor(bot.y / CELL)
      for (let ax = cx - reach; ax <= cx + reach && !touched; ax += 1) {
        for (let ay = cy - reach; ay <= cy + reach && !touched; ay += 1) {
          const list = cells.get(key(ax, ay))
          if (list === undefined) continue
          for (const other of list) {
            if (distance(bot.x, bot.y, other.x, other.y) <= contactRadius) {
              touched = true
              break
            }
          }
        }
      }
    }
    if (touched) {
      const dose = (illness === undefined ? 0 : illness.dose) + 1
      const needed = tuning.resistance === undefined ? catchAfter : catchThreshold(bot, tuning.resistance, catchAfter, anchor(tuning.resistance, world.resistance))
      if (dose >= needed) makeSick(world, bot, tuning)
      else bot.illness = { stage: 'exposed', dose, until: 0 }
    } else if (illness !== undefined) {
      if (illness.dose <= 1) delete bot.illness
      else illness.dose -= 1
    }
  }
}
