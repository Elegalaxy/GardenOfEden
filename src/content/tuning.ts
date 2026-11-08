// Every behaviour number the sim reads. Change numbers here, not in src/sim.
// Energy figures are chosen to be exact in binary (0.25, 0.5), so the starve
// tick of a lone bot is a whole number and a test can state it exactly:
// 70 energy / (0.25 base + 0.25 move) per tick = 140 ticks.

import type { Tuning } from '../sim/types.ts'

export const tuning: Tuning = {
  bot: {
    maxEnergy: 100,
    startEnergy: 70,
    maxHealth: 100,
    speed: 0.6,
    turnRate: 0.5,
    baseDrain: 0.25,
    moveDrain: 0.25,
    senseDrain: 0.02,
    metabolismSpeed: 2,
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
    retryTicks: 300,
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
  logCap: 500,
}
