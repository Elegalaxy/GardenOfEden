// Reproduction. A bot reproduces alone, and only when all of these hold:
// energy at or above its `reproThreshold` trait, age of at least `adultAge`,
// cooldown over, standing in a shelter, and room under the population cap.
//
// A newborn starts with full health and full thirst (water, unlike energy, is not
// handed down: a child costs the parent no thirst).
//
// A birth happens in two parts. `conceive` runs in the bot loop and moves
// `childEnergyShare` of the parent's energy into a `Conception`, so the
// parent's energy is already lower when the loop moves on. `spawnChildren`
// runs after the loop and creates the bots, using the `birth` random stream
// (three draws per child: angle, distance, heading; then eight more for the
// traits, two per trait, see traits.ts). A child inherits the parent's traits
// with a small seeded mutation, clamped into the bounds in `tuning.mutation`.

import { nextFloat } from './rng.ts'
import { mutateTraits } from './traits.ts'
import type { Bot, Tuning, Traits, World } from './types.ts'
import { pushEvent } from './world.ts'

const TWO_PI = Math.PI * 2

/** A birth that has been paid for but not yet placed in the world. */
export type Conception = {
  parentId: number
  generation: number
  traits: Traits
  x: number
  y: number
  energy: number
}

/** The bot-only conditions: energy, age and cooldown. Shelter and cap are checked by the caller. */
export function meetsReproductionNeeds(bot: Bot, tuning: Tuning): boolean {
  return bot.energy >= bot.traits.reproThreshold && bot.age >= tuning.bot.adultAge && bot.cooldown <= 0
}

/** Takes the child's energy from the parent and starts its cooldown; null when the bot is not eligible. */
export function conceive(bot: Bot, inShelter: boolean, hasRoom: boolean, tuning: Tuning): Conception | null {
  if (!inShelter || !hasRoom || !meetsReproductionNeeds(bot, tuning)) return null
  const energy = bot.energy * tuning.bot.childEnergyShare
  bot.energy -= energy + tuning.bot.birthCost
  bot.cooldown = tuning.bot.reproCooldown
  return { parentId: bot.id, generation: bot.generation, traits: { ...bot.traits }, x: bot.x, y: bot.y, energy }
}

/** Adds the children after the bot loop, in the order they were conceived. */
export function spawnChildren(world: World, conceptions: Conception[], tuning: Tuning): void {
  const stream = world.rng.birth
  for (const c of conceptions) {
    const angle = nextFloat(stream) * TWO_PI
    const reach = nextFloat(stream) * tuning.bot.spawnSpread
    const heading = nextFloat(stream) * TWO_PI
    const traits = mutateTraits(c.traits, tuning.mutation, stream)
    const x = Math.min(world.width, Math.max(0, c.x + Math.cos(angle) * reach))
    const y = Math.min(world.height, Math.max(0, c.y + Math.sin(angle) * reach))
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
      traits,
      memory: [],
      intent: { kind: 'wander', targetId: null },
      heading,
    }
    world.nextId += 1
    world.bots.push(child)
    world.totalBirths += 1
    pushEvent(world, tuning, { tick: world.tick, type: 'birth', botId: child.id, x, y })
  }
}
