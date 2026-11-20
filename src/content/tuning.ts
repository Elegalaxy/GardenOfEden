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
    // M22 trait prices (see the retune log in doc/GAME_DESIGN.md). Each multiplies or adds to the energy drain, which
    // is very sensitive: in a lineage race (mutation off) a hardiness of 1.4 at a drain of 0.1 (4% more energy
    // burned, no benefit in a predator-free world) left about half the descendants of a plain bot, so the numbers
    // stay small. Sprint: `sprintUpkeep` x (sprint - 1) energy per tick (times metabolism) and a flee step costs
    // moveDrain x sprint; 0.03 and above pushed the mean to the lower bound, 0.01 keeps it near 1. Hardiness: the
    // whole drain x (1 + hardinessDrain x (hardiness - 1)); 0.25 and 0.1 sank the mean to 0.8 to 0.85 because
    // predator bites are only about 5% of deaths, 0.01 leaves it near 0.9 to 1. Longevity: the same shape; at 0 the
    // mean climbed to 1.15 (a long life costs only a later start), at 0.1 it sank to 0.8 (the lower bound is 0.7), 0.03 holds
    // it near 1.05.
    sprintUpkeep: 0.01,
    hardinessDrain: 0.01,
    longevityDrain: 0.03,
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
  // Mate choice (G1 mechanics, switched on in Eden by G2): with it on, a ready male seeks the nearest ready female who is not close kin, and
  // pairing ranks unrelated pairs first. Kin means a kinship (kin.ts: parent and child or full siblings 1,
  // half siblings 0.5, parents and siblings only) of at least avoidAt, so 0.5 avoids half siblings too. With
  // lastResort a kin pair still forms when nobody else is free (a preference with fallback); without it a
  // kin pair never forms. No random draws.
  // G2 chose avoidAt 0.5 with lastResort false: kin never pair (inbred births 0, the bar was a third of the
  // baseline 18%); the fallback settings only reached 10 to 14%.
  mateChoice: {
    enabled: true,
    avoidAt: 0.5,
    lastResort: false,
  },
  // Bloodline colour (M20): a child takes its mother's or father's hue and drifts it by up to this many
  // degrees either way (genes.ts, `gene` stream). Cosmetic: no rule reads it.
  gene: {
    drift: 6,
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
    // M22: founders sit at 1, not at a bound (mutation is multiplicative). Bounds: sprint 0.8 to 1.8 (speed while
    // fleeing, a predator moves at 0.9 and a bot at 0.6, so 1.5 matches it), longevity 0.7 to 1.4 (lifespan and the
    // fertility curve), hardiness 0.7 to 1.6 (damage divisor), wariness 0.5 to 2 (threat radius and memory window).
    sprint: 1,
    longevity: 1,
    hardiness: 1,
    wariness: 1,
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
      sprint: { min: 0.8, max: 1.8 },
      longevity: { min: 0.7, max: 1.4 },
      hardiness: { min: 0.7, max: 1.6 },
      wariness: { min: 0.5, max: 2 },
    },
  },
  memory: {
    cap: 8,
    waterCap: 2,
    // Predator sightings get their own slots (M21a), so a crowd of them never pushes food out.
    predatorCap: 2,
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
    shareKinds: ['resource', 'water', 'shelter', 'danger', 'predator'],
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
    // A ruin whose centre is inside any danger radius (a meteor crater since M21b) decays this many times as
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
    // Blight (B1): resource nodes inside the disc stop regrowing and lose `drain` a tick (a full node of 100 empties in 400 ticks).
    blight: { duration: 1200, radius: 12, drain: 0.25 },
    meteor: { radius: 6, damage: 200, craterRadius: 3, craterDamage: 2, craterTicks: 600 },
    // Events hurt predators (EP2, on). With predator ecology on, a meteor kills the predators within half its radius and a plague
    // drains 0.4 energy a tick from those inside it (a predator that stays in the disc dies, one that leaves it feeds and lives).
    // Event-free runs never touch it. Retuned in doc/GAME_DESIGN.md (EP2).
    predatorHarm: { enabled: true, meteorKillFraction: 0.5, plagueDrain: 0.4 },
  },
  // Predators (M21a, retuned in M21b for the eden preset's three). A predator spends most of its time resting after a kill:
  // `digestTicks` 1300 (was a first guess of 300) puts predator deaths at about 5% of all deaths and keeps a small colony alive
  // after a drought or plague; at 300 they were 15 to 30% and killed the survivors of a crash (see the changelog in
  // doc/GAME_DESIGN.md for every setting tried). `speed` 0.9 is unchanged from M21a. `homeRange` 11 (was 10) is the one M22 change: the
  // new traits added draws and so moved every run, and with 10 the metabolism lineage race in tests/traits.test.ts lost on two of its six
  // seeds; the retune log in doc/GAME_DESIGN.md lists every non-trait number tried (digestTicks, chaseTicks, giveUpRest, memoryTicks).
  predator: {
    maxCount: 8,
    senseRadius: 8,
    speed: 0.9,
    biteRange: 1,
    chaseTicks: 40,
    giveUpRest: 60,
    digestTicks: 1300,
    memoryTicks: 400,
    homeRange: 11,
    steerStep: 0.5,
    // Predator ecology (E1 mechanics, switched on and retuned in E2; the sweep is in the doc/GAME_DESIGN.md changelog): see
    // `Tuning.predator.ecology`. A predator loses `drain` energy a tick and a kill gives `killEnergy` (to `maxEnergy`); below `huntBelow` it
    // hunts, at or above it it wanders home. It dies of age at `maxAge`. After `killsPerCub` kills (and `adultAge`) a predator with at least
    // `cubCost` + `huntBelow` energy breeds a cub into free territory (`homeSpacing` from any other home). A kill tops energy up to at most
    // `maxEnergy` and the drain comes off before the cub check, so a cub needs cubCost + huntBelow <= maxEnergy - drain (checkEcology refuses
    // anything else). `cubEnergy` must stay below `huntBelow`, or newborns start sated. E2 found that predators are limited by their
    // digest time, not by prey, so breeding is made rare (6 kills a cub, a 12,000-tick life): a predator breeds about once and the
    // count peaks near 6 instead of sitting at the cap of 8, which cost the colony 60,000-tick extinctions. (P2: the prey rule below now holds the count down, so killsPerCub is 3.)
    ecology: {
      enabled: true,
      drain: 0.02,
      killEnergy: 60,
      maxEnergy: 100,
      huntBelow: 60,
      maxAge: 12000,
      adultAge: 1500,
      killsPerCub: 3,
      cubEnergy: 50,
      cubCost: 30,
      homeTries: 8,
      homeSpacing: 24,
      homeMargin: 4,
      denRadius: 4,
      recolonizeTicks: 3000,
    },
    // Predator-prey rule (P1 mechanics, P2 retune and switch-on; works only with ecology on): see `Tuning.predator.prey`. The predator limit is
    // floor(bots / perPredator), never below `minCount` (1: they cannot die out this way) nor above `maxCount`. Over the limit cubs and
    // newcomers wait, and after `leaveAfter` ticks over it the lowest-energy predator that was not placed by the player leaves.
    // P2: one predator per 16 bots, and with the limit now doing the capping, a cub only needs 3 kills (E2 had 6 to keep the count down). The sweep is in the doc/GAME_DESIGN.md changelog.
    prey: { enabled: true, perPredator: 16, minCount: 1, leaveAfter: 500 },
    // Heritable predator traits (H1 mechanics, H2 retune and switch-on; works only with ecology on): a cub inherits its parent's sense, speed and stamina multipliers
    // with a seeded mutation (rate and strength as for bots); founders, placed and arriving predators start at 1. Speed max 1.2 gives 0.9 x 1.2 = 1.08,
    // the fastest a bot can flee (0.6 x sprint 1.8). price: extra drain per unit away from 1 (signed: drain x (1 + sum of price x (trait - 1)), so a slower or shorter-sighted predator
    // is a little cheaper than the base). Caveat: more drain shortens the fed period, so a costly predator becomes hungry (and hunts) sooner.
    // H2: prices three times the H1 guesses (0.15, 0.3, 0.06) and mutation strength 0.2 (rate stays 0.5): strength 0.1 left the means within a few percent of 1,
    // while 0.3 (or strength 0.15 with the same prices) cost bots caution or a colony over 60,000 ticks. The sweep is in the doc/GAME_DESIGN.md changelog.
    traits: {
      enabled: true,
      mutation: { rate: 0.5, strength: 0.2 },
      bounds: { sense: { min: 0.75, max: 1.5 }, speed: { min: 0.8, max: 1.2 }, stamina: { min: 0.5, max: 2 } },
      price: { sense: 0.15, speed: 0.3, stamina: 0.06 },
    },
  },
  // Seasons (S1 mechanics, S2 retune and switch-on). Food regrowth is multiplied by
  // base + amplitude * sin(2 * pi * tick / period). `base` exists because nodes that are already full waste the
  // summer surplus, so a base of 1 gives less food over a year than the old fixed rate; S2 found 1.02 enough to
  // bring intake back within a few percent. amplitude may not exceed 0.5. Retuned in S2 (doc/GAME_DESIGN.md
  // changelog has the sweep): a 3,000-tick year with a 0.4 swing gives clear waves and no more lost runs than before.
  seasons: { enabled: true, period: 3000, amplitude: 0.4, base: 1.02 },
  // Directional sensing (V1 mechanics, V2 retune and switch-on). Reach = senseRadius * (rear + (front - rear) * (1 + cos) / 2), where cos is the
  // angle off the heading. botFront 1 keeps the forward reach of the old disc; botRear 0.7 means a bot notices what is within
  // 70% of its radius behind it (a back-turned bot can still be ambushed, a close one is never missed). predatorFront 1 and
  // predatorRear 0.35: a hunter sees less behind it than a bot does, so prey that slips round it can escape. trackTicks 10: a
  // hunter the bot saw itself stays tracked for 10 ticks after it leaves the cone. V2 sweep (doc/GAME_DESIGN.md changelog): a
  // narrower bot rear (0.55 or less) or a wider predator rear (0.7 or more) lowered caution or lost colonies over 60,000 ticks.
  // Cost: about 17% more time per 20,000-tick run than the all-round disc (an accepted deviation).
  perception: {
    cone: { enabled: true, botFront: 1, botRear: 0.7, predatorFront: 1, predatorRear: 0.35, trackTicks: 10 },
  },
  // Toxic food (T1, mechanics only, OFF): with it on, the last `toxicCount` scattered food nodes of a new world are toxic. A bite
  // still gives full energy but costs `damagePerUnit` health per unit eaten (divided by hardiness), so a bot that learns which nodes
  // are toxic can avoid them (and tell its family) unless it is desperate. See src/sim/poison.ts.
  poison: { enabled: false, toxicCount: 6, damagePerUnit: 5 },
  // Rough ground (R1, mechanics only, OFF): with it on, a world made from a preset that lists `terrain` gets permanent rough discs, and a mover
  // that starts its step inside one walks only this fraction of its normal step (bots and predators have their own number, equal for now).
  // No energy cost and bots do not see it. maxCount caps the rough nodes in a world (the player tool comes later). See src/sim/terrain.ts.
  terrain: { enabled: false, botSpeedMult: 0.5, predatorSpeedMult: 0.5, maxCount: 24 },
  // Disease with immunity (D1, mechanics only, OFF): with it on, the player's `outbreak` event makes every bot within `outbreakRadius` sick at
  // once. A bot that stays within `contactRadius` of a sick bot for `catchAfter` ticks falls sick too (the count falls by 1 a tick without
  // contact). A sick bot takes `sickDrain` health damage a tick (divided by hardiness) for `sickTicks` ticks, then is immune for `immuneTicks`
  // (and can be infected again after). A user-approved exception to the "no direct contact" rule. No draws. See src/sim/disease.ts.
  disease: { enabled: false, outbreakRadius: 6, contactRadius: 2, catchAfter: 20, sickTicks: 300, sickDrain: 0.15, immuneTicks: 1500 },
  logCap: 500,
}
