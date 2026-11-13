// Reproduction. A bot is ready to breed when all of these hold: energy at or above its
// `reproThreshold` trait, fertility above 0 (see `fertilityAt`: 0 below `adultAge` and past
// `fertileUntil`), cooldown over, and standing in a shelter (a male in sexual mode only needs to be near a mother). There must also be room under the
// population cap. After a birth the parent's cooldown is `reproCooldown` divided by its
// fertility at that moment, rounded up, so a young or old parent waits longer. No random
// numbers are drawn for any of this.
//
// Two sexes (M17, `tuning.sex.enabled`): a birth needs a ready female standing in a shelter and a
// ready male within `sex.mateRange` cells of her (males find females by sensing, see mating.ts). `pairMates` runs once after the bot loop (step.ts
// collects the ready bots): the closest female-male pairs within range are matched first (ties: lowest
// female id, then lowest male id), each bot at most once, so a female takes the nearest free male and when
// two females want one male the nearer one wins; one pairing per bot per tick. The mother pays like a lone parent did
// (`payMother`: childEnergyShare of her energy goes to the child, plus birthCost, cooldown
// reproCooldown / fertility); the father pays `sex.maleCost` energy and waits
// `sex.maleCooldown` / fertility (`payFather`). No random draws in pairing. With sex off a bot breeds alone
// in the bot loop through `conceive`, as before M17.
//
// A newborn starts with full health and full thirst (water, unlike energy, is not
// handed down: a child costs the parent no thirst).
//
// A birth happens in two parts. `conceive` (asexual) or `pairMates` (sexual) moves
// `childEnergyShare` of the mother's energy into a `Conception`, so the energy is already
// lower when the next step runs. `spawnChildren` runs after the loop and creates the bots, using
// the `birth` random stream. Draws per child, in order: angle, distance, heading; sexual mode
// only: the child's sex (female when below `sex.femaleChance`) and four crossover draws (one per
// trait: mother's or father's value, see traits.ts); then eight mutation draws (two per trait).
// That is 16 draws per sexual child and 11 per asexual child (whose sex is autoSex, no draw).
// A child inherits traits (crossed, then mutated), clamped into the bounds in `tuning.mutation`.
// Its generation is one more than the older parent's. It starts with the shareable part of its
// mother's memory as it was at conception, then its father's merged in (`family.inheritFromParents`,
// see family.ts); that draws no random numbers. Each child also gets a lineage record, and both
// parents' records count one more child (lineage.ts).

import { cos, sin } from './exactMath.ts'
import { inheritFromParents, inheritMemory } from './family.ts'
import { addRecord, findRecord } from './lineage.ts'
import { nextFloat } from './rng.ts'
import { distance } from './perception.ts'
import { crossTraits, mutateTraits } from './traits.ts'
import type { Bot, MemoryEntry, Sex, Tuning, Traits, World } from './types.ts'
import { autoSex, pushEvent } from './world.ts'

const TWO_PI = Math.PI * 2

/** A birth that has been paid for but not yet placed in the world. */
export type Conception = {
  /** The mother (or the only parent when sex is off). */
  parentId: number
  /** The father; null when sex is off. */
  fatherId: number | null
  /** The older parent's generation; the child is one more. */
  generation: number
  traits: Traits
  fatherTraits: Traits | null
  /** Copy of the mother's memory at conception (family.ts picks what the child keeps). */
  memory: MemoryEntry[]
  /** Copy of the father's memory (empty when sex is off). */
  fatherMemory: MemoryEntry[]
  x: number
  y: number
  energy: number
}

/**
 * Fertility (0 to 1) at an age: 0 below adultAge, startFraction at adultAge rising to 1 at primeAge,
 * 1 until declineAge, falling to 0 at fertileUntil, 0 from there. Only + - * / are used. A zero-length
 * segment is skipped: primeAge <= adultAge means 1 from adultAge; fertileUntil <= declineAge means 1
 * until fertileUntil, then 0.
 */
export function fertilityAt(age: number, tuning: Pick<Tuning, 'bot' | 'fertility'>): number {
  const { adultAge } = tuning.bot
  const { startFraction, primeAge, declineAge, fertileUntil } = tuning.fertility
  if (age < adultAge || age >= fertileUntil) return 0
  if (age < primeAge) {
    return startFraction + ((1 - startFraction) * (age - adultAge)) / (primeAge - adultAge)
  }
  if (age < declineAge) return 1
  return (fertileUntil - age) / (fertileUntil - declineAge)
}

/** The bot-only conditions: energy, fertility and cooldown. Shelter and cap are checked by the caller. */
export function meetsReproductionNeeds(bot: Bot, tuning: Tuning): boolean {
  return bot.energy >= bot.traits.reproThreshold && fertilityAt(bot.age, tuning) > 0 && bot.cooldown <= 0
}

/** The mother's side of a birth: takes the child's energy (returned) plus the birth cost, and starts her cooldown. */
export function payMother(bot: Bot, tuning: Tuning): number {
  const energy = bot.energy * tuning.bot.childEnergyShare
  bot.energy -= energy + tuning.bot.birthCost
  bot.cooldown = Math.ceil(tuning.bot.reproCooldown / fertilityAt(bot.age, tuning))
  return energy
}

/** The father's side of a birth: burns `sex.maleCost` energy and starts his (shorter) cooldown. */
export function payFather(bot: Bot, tuning: Tuning): void {
  bot.energy -= tuning.sex.maleCost
  bot.cooldown = Math.ceil(tuning.sex.maleCooldown / fertilityAt(bot.age, tuning))
}

/** Asexual mode: takes the child's energy from the parent and starts its cooldown; null when the bot is not eligible. */
export function conceive(bot: Bot, inShelter: boolean, hasRoom: boolean, tuning: Tuning): Conception | null {
  if (!inShelter || !hasRoom || !meetsReproductionNeeds(bot, tuning)) return null
  const energy = payMother(bot, tuning)
  return {
    parentId: bot.id,
    fatherId: null,
    generation: bot.generation,
    traits: { ...bot.traits },
    fatherTraits: null,
    memory: bot.memory.map((entry) => ({ ...entry })),
    fatherMemory: [],
    x: bot.x,
    y: bot.y,
    energy,
  }
}

/**
 * Sexual mode: pairs the ready bots (in a shelter, energy, fertility and cooldown already checked by
 * the caller, given in ascending id order) and pays for each pairing. Every female-male pair within
 * `sex.mateRange` is ranked by distance (ties: lowest female id, then lowest male id) and matched greedily,
 * each bot at most once. Stops once `roomLeft` children are conceived. Draws nothing.
 */
export function pairMates(candidates: readonly Bot[], roomLeft: number, tuning: Tuning): Conception[] {
  const conceptions: Conception[] = []
  const females = candidates.filter((bot) => bot.sex === 'female')
  const males = candidates.filter((bot) => bot.sex === 'male')
  if (roomLeft <= 0 || females.length === 0 || males.length === 0) return conceptions
  const options: { female: Bot; male: Bot; d: number }[] = []
  for (const female of females) {
    for (const male of males) {
      const d = distance(female.x, female.y, male.x, male.y)
      if (d <= tuning.sex.mateRange) options.push({ female, male, d })
    }
  }
  options.sort((a, b) => a.d - b.d || a.female.id - b.female.id || a.male.id - b.male.id)
  const paired = new Set<number>()
  for (const { female, male } of options) {
    if (conceptions.length >= roomLeft) break
    if (paired.has(female.id) || paired.has(male.id)) continue
    paired.add(female.id)
    paired.add(male.id)
    const conception: Conception = {
      parentId: female.id,
      fatherId: male.id,
      generation: Math.max(female.generation, male.generation),
      traits: { ...female.traits },
      fatherTraits: { ...male.traits },
      memory: female.memory.map((entry) => ({ ...entry })),
      fatherMemory: male.memory.map((entry) => ({ ...entry })),
      x: female.x,
      y: female.y,
      energy: 0,
    }
    conception.energy = payMother(female, tuning)
    payFather(male, tuning)
    conceptions.push(conception)
  }
  return conceptions
}

/** Adds the children after the bot loop, in the order they were conceived. */
export function spawnChildren(world: World, conceptions: Conception[], tuning: Tuning): void {
  const stream = world.rng.birth
  let live: Set<number> | null = null
  for (const c of conceptions) {
    const angle = nextFloat(stream) * TWO_PI
    const reach = nextFloat(stream) * tuning.bot.spawnSpread
    const heading = nextFloat(stream) * TWO_PI
    let sex: Sex
    let crossed = c.traits
    if (c.fatherTraits !== null) {
      sex = nextFloat(stream) < tuning.sex.femaleChance ? 'female' : 'male'
      crossed = crossTraits(c.traits, c.fatherTraits, stream)
    } else {
      sex = autoSex(world.bots)
    }
    const traits = mutateTraits(crossed, tuning.mutation, stream)
    const x = Math.min(world.width, Math.max(0, c.x + cos(angle) * reach))
    const y = Math.min(world.height, Math.max(0, c.y + sin(angle) * reach))
    const child: Bot = {
      id: world.nextId,
      x,
      y,
      px: x,
      py: y,
      energy: c.energy,
      health: tuning.bot.maxHealth,
      thirst: tuning.bot.maxThirst,
      age: 0,
      cooldown: tuning.bot.reproCooldown,
      generation: c.generation + 1,
      parentId: c.parentId,
      fatherId: c.fatherId,
      sex,
      traits,
      memory: [],
      intent: { kind: 'wander', targetId: null },
      heading,
    }
    if (tuning.family.inherit) {
      if (c.fatherId === null) {
        child.memory = inheritMemory(c.memory, c.parentId, tuning)
      } else {
        if (live === null) live = new Set(world.nodes.map((node) => node.id))
        child.memory = inheritFromParents(c.memory, c.parentId, c.fatherMemory, c.fatherId, tuning, live)
      }
    }
    world.familyLearned += child.memory.length
    world.nextId += 1
    world.bots.push(child)
    addRecord(world, child.id, child.parentId, child.fatherId, child.sex, child.generation, child.traits)
    const parentRecord = c.parentId === null ? undefined : findRecord(world, c.parentId)
    if (parentRecord !== undefined) parentRecord.children += 1
    const fatherRecord = c.fatherId === null ? undefined : findRecord(world, c.fatherId)
    if (fatherRecord !== undefined) fatherRecord.children += 1
    world.totalBirths += 1
    pushEvent(world, tuning, { tick: world.tick, type: 'birth', botId: child.id, x, y })
  }
}
