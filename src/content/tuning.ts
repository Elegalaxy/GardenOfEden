// Every behaviour number the sim reads. Change numbers here, not in src/sim.
// Energy figures are chosen to be exact in binary (0.25, 0.5), so the starve
// tick of a lone bot is a whole number and a test can state it exactly:
// 70 energy / (0.25 base + 0.25 move) per tick = 140 ticks. Thirst is the same
// kind of exact: 100 thirst / 0.25 per tick = 400 ticks from full to dead.

import type { Tuning } from '../sim/types.ts'

export const tuning: Tuning = {
  bot: {
    maxEnergy: 100,
    startEnergy: 70,
    maxHealth: 100,
    maxThirst: 100,
    speed: 0.6,
    turnRate: 0.5,
    baseDrain: 0.25,
    moveDrain: 0.25,
    senseDrain: 0.02,
    metabolismSpeed: 2,
    thirstDrain: 0.25,
    // Why a steep power, and why only above 1: speed is `1 + 2 x (metabolism - 1)` times the base, so a
    // hot bot covers ground (and finds the few springs) faster than it burns energy, which is cheaper
    // per cell walked. With thirst scaled by metabolism x 1, or not at all, metabolism 1.6 out-bred 0.9
    // in the selection test (tests/traits.test.ts) once water existed. At 3 a hot bot's thirst (x4.1 at
    // 1.6) cancels that. Scaling a cool bot's thirst down too (so below 1 it thirsts less) pinned the
    // population mean at the 0.7 lower bound over 60,000 ticks, so below 1 the drain stays the plain one.
    thirstMetabolismPower: 3,
    thirstyBelow: 0.5,
    quenchedAbove: 0.95,
    drinkRate: 5,
    hungryBelow: 0.6,
    satedAbove: 0.9,
    eatRate: 5,
    energyPerUnit: 2,
    healthRegen: 0.02,
    maxAge: 3000,
    adultAge: 200,
    reproCooldown: 300,
    childEnergyShare: 0.4,
    birthCost: 20,
    spawnSpread: 1.5,
  },
  brain: {
    seekWeight: 1.25,
    thirstWeight: 1.25,
    restWeight: 1.4,
    reproduceScore: 0.5,
    wanderScore: 0.15,
    fleeBase: 0.4,
    fleeCaution: 1.2,
    fleeHealth: 0.5,
    fleeMargin: 0.5,
    avoidMargin: 0.75,
    desperateBelow: 0.2,
    restBelow: 0.7,
    restUntil: 0.95,
    steerStep: 0.5,
    settleFraction: 0.6,
  },
  population: {
    cap: 2000,
  },
  traits: {
    senseRadius: 6,
    caution: 0.5,
    reproThreshold: 80,
    metabolism: 1,
  },
  mutation: {
    rate: 0.5,
    strength: 0.1,
    bounds: {
      senseRadius: { min: 3, max: 12 },
      caution: { min: 0.05, max: 1.5 },
      // Above satedAbove (90) a bot stops eating, so it could never reach the threshold; below 55 it
      // would breed while still hungry.
      reproThreshold: { min: 55, max: 90 },
      metabolism: { min: 0.7, max: 1.6 },
    },
  },
  memory: {
    cap: 8,
    waterCap: 2,
    retryTicks: 300,
  },
  // Family knowledge sharing (M10): only a parent and its own child, never siblings or strangers (they
  // hear it second-hand through a parent). A newborn copies its parent's memory at conception; after
  // that a living parent and child within `shareRadius` cells swap memory every `shareEvery` ticks.
  // Ruins stay out: they are gone before the telling is worth it. radius 0 turns the exchange off.
  family: {
    inherit: true,
    shareRadius: 3,
    shareEvery: 10,
    shareKinds: ['resource', 'water', 'shelter', 'danger'],
  },
  stats: {
    sampleEvery: 50,
    maxSamples: 2000,
    minuteTicks: 600,
  },
  player: {
    minNodeGap: 1,
    maxNodes: 400,
  },
  ruin: {
    baseAmount: 24,
    energyShare: 0.5,
    mergeRadius: 2,
    maxCount: 60,
  },
  // World events the player triggers (M8). Drought and bounty scale resource regrowth (0.5 per tick per
  // node) for a while. A plague drains health in a disc (a bot at full health dies in 100 / 0.8 = 125
  // ticks if it stays; bots do not see it, they only wander out by chance). A meteor is lethal near its
  // centre (100 health is gone within 6 x (1 - 100/200) = 3 cells) and leaves a 3-cell danger crater
  // (2 damage per tick, like a danger node) that fades after 600 ticks. Sized with
  // `npm run sim -- --event ...` so that each one clearly moves the population (aimed at the
  // busiest spot at tick 3000, mean population over the next 1500 ticks: drought about -45%,
  // plague about -23%, bounty about +85%) without wiping it out; see doc/GAME_DESIGN.md section 7.
  events: {
    maxActive: 3,
    maxCraters: 6,
    drought: { duration: 1500, regrowMult: 0.35 },
    bounty: { duration: 1000, regrowMult: 3 },
    plague: { duration: 800, radius: 14, damage: 0.8 },
    meteor: { radius: 6, damage: 200, craterRadius: 3, craterDamage: 2, craterTicks: 600 },
  },
  logCap: 500,
}
