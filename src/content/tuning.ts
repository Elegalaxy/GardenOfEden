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
    // 10 since M17 (was 5): with two sexes only half the bots bear children and a male has to find a
    // female, so a bot needs more spare time and energy; at 5 or 8 the weakest seeds died out (alone,
    // or after a drought or plague) because births could not keep up with starvation.
    eatRate: 10,
    energyPerUnit: 2,
    healthRegen: 0.02,
    maxAge: 3000,
    adultAge: 200,
    // 100 since M17 (was 300): only females bear, so each needs to be ready twice as often.
    reproCooldown: 100,
    childEnergyShare: 0.4,
    birthCost: 10,
    spawnSpread: 1.5,
  },
  // Fertility by age (M16): 0 below bot.adultAge, `startFraction` at adultAge rising linearly to 1 at
  // `primeAge`, 1 until `declineAge`, falling linearly to 0 at `fertileUntil`, 0 after (maxAge still
  // ends the life). After a birth the cooldown is bot.reproCooldown / fertility, rounded up. The
  // neutral setting (startFraction 1, primeAge = adultAge, declineAge = fertileUntil = maxAge) gives
  // the pre-M16 rules exactly; tests/fertility.test.ts checks that against the old hash.
  fertility: {
    startFraction: 0.5,
    primeAge: 600,
    declineAge: 1800,
    fertileUntil: 2600,
  },
  // Two sexes (M17): a birth needs a ready female standing in a shelter and a ready male within mateRange
  // cells of her (a male finds her by sensing, see brain.seekMateScore and mating.ts). The mother pays
  // childEnergyShare + birthCost and waits reproCooldown / fertility; the father pays maleCost and waits
  // maleCooldown / fertility. Each child is female with chance femaleChance (a plain coin flip).
  sex: {
    enabled: true,
    femaleChance: 0.5,
    mateRange: 4,
    maleCost: 0,
    maleCooldown: 50,
  },
  // Inbreeding (M18): a child's score is 1 when its parents are parent and child or full siblings, 0.5
  // for half siblings, else 0 (lineage.relatedness). At score s the child lives lifespanLoss * s shorter
  // (of bot.maxAge) and starts with energyLoss * s less energy and healthLoss * s less health. All 0 =
  // no penalty. There is no bar on pairing, so mate seeking from a small pool pays this price.
  // energyLoss is 0 on purpose: with the plan's 0.3 (or any value from 0.05 up) the scripted-event
  // survival tests in tests/events.test.ts lost a run to extinction on some seed, and the plan's
  // 0.3/0.3/0.3 failed there too; 0.2 / 0 / 0.2 passes events, traits and tuning tests.
  inbreeding: {
    lifespanLoss: 0.2,
    energyLoss: 0,
    healthLoss: 0.2,
  },
  brain: {
    seekWeight: 1.25,
    thirstWeight: 1.25,
    restWeight: 1.4,
    reproduceScore: 0.5,
    seekMateScore: 0.6,
    wanderScore: 0.15,
    fleeBase: 0.4,
    fleeCaution: 1.2,
    fleeHealth: 0.5,
    fleeMargin: 0.5,
    avoidMargin: 0.75,
    desperateBelow: 0.2,
    // How early a bot gets desperate depends on its caution (M12): the threshold is
    // `desperateBelow x (1 + cautionDesperate x (0.5 - caution))`, clamped to [minDesperate, maxDesperate].
    // At 4, caution 0.3 gives 36% (hungry bots dive into danger early), 0.5 gives 20%, 0.7 gives 4%
    // (clamped to 5%: a cautious bot starves before it walks into danger). Without it caution cost
    // nothing and mean caution drifted from 0.5 to about 0.3 over 60,000 ticks. 1 and 2 left the
    // drift mostly in place (seeds above 0.4: 5 and 7 of 10); 4 held 10 of 10; 6 and 10 cut danger
    // deaths a little more but pushed the lowest population down to 18 and 11.
    cautionDesperate: 4,
    minDesperate: 0.05,
    maxDesperate: 0.4,
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
    // 65 since M17 (was 80); the population mean settles near 60 either way.
    reproThreshold: 65,
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
  // Lineage records (M11): a small record per bot that ever lived, for the family tree. At about
  // 130 bytes of JSON each, 3000 records add roughly 0.4 MB to a save hash. A 60,000-tick eden run has
  // about 3,700 births, so a long run prunes: extinct branches go first, then the oldest dead
  // ancestors; a living bot's record is never dropped. Pruning down to 2400 means it runs in batches.
  lineage: {
    maxRecords: 3000,
    pruneTo: 2400,
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
    // A ruin whose centre is inside any danger radius (zone, grove, crater) decays this many times as
    // fast (M12), so it is gone in about 100 ticks instead of 500 and lures fewer starving bots into
    // danger. 3, 5 and 10 gave similar 60,000-tick results (seeds above 0.4 caution: 3, 3, 5 of 10);
    // 20 was worse (3 of 10, lowest population 15).
    dangerDecayMult: 5,
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
