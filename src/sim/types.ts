// Plain-JSON data model for the world. No classes, no functions, no Maps: a
// World survives JSON.parse(JSON.stringify(world)) and is hashed as JSON.
// Numbers that tune behaviour live in src/content/tuning.ts and reach the sim
// as a `Rules` value, never as imports.

// RNG stream names, in splitmix32 expansion order. Do not reorder: the sequence
// for a seed depends on this order.
export const RNG_STREAM_NAMES = ['world', 'ai', 'birth', 'gene', 'predator'] as const

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number]

/**
 * A rule that is built but off, which a new world may opt into. The order here is the canonical order (feature lists are kept
 * in it). The sim never reads this type: content turns a list into rules and a preset (src/content/features.ts).
 */
export type WorldFeature = 'poison' | 'terrain' | 'culture' | 'predatorSexes' | 'resistance'

/**
 * One named random stream.
 *
 * `a`, `b`, `c`, and `d` are the sfc32 state: four unsigned 32-bit integers.
 * They are always present so the generator state stays explicit in JSON.
 *
 * `spare` is the unused second sample from a Box-Muller pair. It is absent
 * until `nextNormal` generates a pair and returns only the first. It is removed
 * when that cached sample is returned. A finite number survives
 * `JSON.parse(JSON.stringify(stream))`; a missing spare is omitted, which
 * restores "no cached sample".
 */
export type RngStream = {
  a: number
  b: number
  c: number
  d: number
  spare?: number
}

/** The five named streams for one run. Plain JSON, no hidden generator. */
export type RngState = {
  world: RngStream
  ai: RngStream
  birth: RngStream
  gene: RngStream
  predator: RngStream
}

/** One choice for `pickWeighted`. `weight` must be finite and >= 0. */
export type Weighted<T> = {
  value: T
  weight: number
}

/** `rough` (R1) is permanent rough ground: a disc where movers walk slower (terrain.ts). */
export type NodeKind = 'resource' | 'danger' | 'shelter' | 'ruin' | 'water' | 'predator' | 'rough'

/**
 * One purposeful spot on the map. Only the fields a kind uses matter; the
 * rest stay 0 so every node has the same shape.
 * - resource: `amount` (0..capacity) refills by `regen` per tick.
 * - danger: `damage` health per tick to a bot inside `radius`. Since M21b only a meteor crater is one (the player can no
 *   longer place it; the internal kind name stays).
 * - shelter: `heal` health per tick, and `drainMult` scales energy loss.
 * - ruin: food left by a dead bot. `amount` (0..capacity) falls by `decay` per tick and by being
 *   eaten; the node is removed at 0. Made by the sim only (ruins.ts), never by a preset.
 * - water: a permanent spring. A bot within `radius` drinks `Tuning.bot.drinkRate` thirst per tick.
 *   It is never used up, so it has no amount: `amount` and `capacity` stay 0.
 * - predator (M21a): a moving hunter. `radius` is its threat radius (what bots remember and avoid), `damage` the
 *   bite per tick to a bot within `Tuning.predator.biteRange` of its centre. Its state is in `hunt` (predators.ts).
 *   `amount`, `capacity`, `regen`, `heal`, `decay` stay 0 and `drainMult` 1. Its x and y move every tick.
 * Any node may be temporary: `expires` is the tick at the end of which it is removed (0 = permanent).
 * Only the meteor event makes one (a danger crater, see worldEvents.ts).
 */
export type WorldNode = {
  id: number
  kind: NodeKind
  x: number
  y: number
  radius: number
  amount: number
  capacity: number
  regen: number
  damage: number
  heal: number
  drainMult: number
  /** Ruins only: amount lost per tick. */
  decay: number
  /** Last tick the node exists (it is removed at the end of that tick); 0 for a permanent node. */
  expires: number
  /** Predators only (null for every other kind): what the hunter is doing. */
  hunt: PredatorState | null
  /** Toxic food (T1): health damage per unit eaten from this node. Present only on a toxic resource, absent otherwise (and always, with poison off); last key. */
  toxin?: number
}

/**
 * A predator's state (M21a, see predators.ts). `px`, `py` are where it stood at the start of its last turn
 * (for smooth drawing). `targetId` is the bot it is chasing, `chase` the ticks spent chasing it, `restUntil`
 * the last tick it rests (it moves again after; 0 = not resting) and `kills` the bots it has killed.
 */
export type PredatorState = {
  px: number
  py: number
  heading: number
  homeX: number
  homeY: number
  targetId: number | null
  chase: number
  restUntil: number
  kills: number
  /** Predator ecology (E1): energy, age and breeding bookkeeping. The key is absent unless `predator.ecology.enabled` was on at creation or placement. */
  life?: PredatorLife
  /** Heritable predator traits (H1): absent unless `predator.traits.enabled` and ecology were on when the predator appeared. After `life`. */
  traits?: PredatorTraits
  /** Generations from a founder, placed or arrived predator (0); present exactly when `traits` is. After `traits`. */
  generation?: number
  /** Predator sex (PS1): absent unless `predator.sexes.enabled` and ecology were on when the predator appeared. The last key, after `generation`. */
  sex?: Sex
}

/** The three heritable predator traits (H1), each a multiplier of the shipped number (1 = as before). */
export type PredatorTraitName = 'sense' | 'speed' | 'stamina'
export type PredatorTraits = Record<PredatorTraitName, number>

/** Where a predator came from (E1): the preset, the player, a parent's litter, or a re-colonising newcomer from the map edge. */
export type PredatorOrigin = 'founder' | 'placed' | 'cub' | 'arrived'

/** One predator's life (E1, see predators.ts): energy falls by `drain` a tick and rises by `killEnergy` a kill; `kidsKills` counts kills since its last cub. */
export type PredatorLife = {
  energy: number
  age: number
  /** Tick it appeared (0 for a preset predator). */
  born: number
  origin: PredatorOrigin
  /** The parent predator's node id for a cub, else null. */
  parentId: number | null
  kidsKills: number
  /** The father's node id for a cub made by a pair (PS1), else absent (founders, arrivals, placed predators and lone cubs). The last key. */
  fatherId?: number
}

/** A predator territory marker (E1): an empty den (no predator homed within `denRadius`) is re-colonised after `recolonizeTicks`. */
export type Den = { x: number; y: number; vacantSince: number | null }

/** Predator ecology state (E1). Present on the world only when `predator.ecology.enabled` was on at creation. */
export type PredatorEcology = {
  dens: Den[]
  stats: { births: number; arrivals: number; starved: number; aged: number; removed: number; eventDeaths?: number }
  /**
   * Prey rule (P1) bookkeeping: `overSince` is the tick the predator count first exceeded the prey limit (null while it does not),
   * `left` the predators that have left the map. The key is last and absent unless both `ecology` and `prey` were on at creation.
   */
  prey?: { overSince: number | null; left: number }
  /**
   * Predator sexes (PS1) bookkeeping: `oneSexSince` is the tick from which only one sex was alive (null while both are, or no predator is),
   * `mated` and `alone` count cubs made by a pair and by a lone parent. The key is last and absent unless both `ecology` and `sexes` were on at creation.
   */
  sexes?: { oneSexSince: number | null; mated: number; alone: number }
}

/** Per-bot numbers that children inherit with a small mutation (M6). */
export type Traits = {
  senseRadius: number
  caution: number
  reproThreshold: number
  metabolism: number
  /** M22: speed multiplier while fleeing (costs upkeep every tick, see `Tuning.bot.sprintUpkeep`). */
  sprint: number
  /** M22: scales lifespan and the whole fertility curve (a long life starts breeding later). */
  longevity: number
  /** M22: health damage from every source is divided by this (costs energy, see `Tuning.bot.hardinessDrain`). */
  hardiness: number
  /** M22: scales how far a predator's threat reaches and how long a sighting is remembered. */
  wariness: number
}

export type IntentKind = 'wander' | 'seekFood' | 'seekWater' | 'flee' | 'rest' | 'reproduce' | 'seekMate'

export type Intent = {
  kind: IntentKind
  targetId: number | null
}

/**
 * What a bot remembers about a node it once sensed. `learnedFrom` is the id of the parent or child
 * the entry was copied from (M10, family.ts), or null when the bot saw the node itself.
 */
export type MemoryEntry = {
  nodeId: number
  kind: NodeKind
  x: number
  y: number
  radius: number
  seenTick: number
  amount: number
  learnedFrom: number | null
  /** Toxic food (T1): the bot knows (from eating it, or from family) that this node poisons. Only ever set to true; absent otherwise; last key. */
  toxic?: true
  /** Culture (C1): an elder taught the bot this place (culture.ts). Cleared when the bot sees the node itself and absent from family copies; last key. */
  taught?: true
}

export type Bot = {
  id: number
  x: number
  y: number
  /** Position at the start of the bot's last turn, for smooth drawing. */
  px: number
  py: number
  energy: number
  health: number
  /** Water level, 0..`Tuning.bot.maxThirst`. Falls every tick, refills at a water node, 0 is death by thirst. */
  thirst: number
  age: number
  /** Ticks left before the bot may reproduce again. */
  cooldown: number
  generation: number
  /** The bearing parent: the mother, or the only parent when sex is off. Null for founders and placed bots. */
  parentId: number | null
  /** The father (sexual mode); null for founders, placed bots and asexual births. */
  fatherId: number | null
  sex: Sex
  /** How closely related its parents were, 0 (not) to 1 (parent and child, or full siblings), fixed at birth (M18). */
  inbreeding: number
  /** Age in ticks at which it dies of old age: `Tuning.bot.maxAge`, shortened by `inbreeding`. */
  lifespan: number
  /** Bloodline colour gene (M20): degrees, 0 up to 360. Handed down with a small drift; changes no rule (genes.ts). */
  hue: number
  traits: Traits
  memory: MemoryEntry[]
  intent: Intent
  /** Radians. */
  heading: number
  /** Disease resistance (R1): 1 or more; present only once the world has `World.resistance` (resistance.ts). Higher needs a bigger dose to fall sick and shortens sickness. */
  resist?: number
  /** Disease (D1): present only while the bot is exposed, sick or immune (deleted when it clears). Last key. */
  illness?: Illness
}

/**
 * Disease state of one bot (D1, disease.ts). `exposed`: `dose` counts ticks in contact with a sick bot (`until` unused, 0);
 * `sick`: takes `sickDrain` health damage a tick until tick `until`; `immune`: cannot be infected until tick `until`.
 */
export type Illness = { stage: 'exposed' | 'sick' | 'immune'; dose: number; until: number }

export type Sex = 'female' | 'male'

export type DeathCause = 'starve' | 'thirst' | 'danger' | 'plague' | 'meteor' | 'predator' | 'age' | 'poison' | 'disease'

/** `event` is the sim announcing that a world event ended (its start is the player's `command`). */
export type SimEventType = 'birth' | 'death' | 'command' | 'event' | 'predator'

/** What happened to a predator (E1), carried by a `predator` log event. */
export type PredatorEventKind = 'born' | 'arrived' | 'starved' | 'aged' | 'left' | 'struck' | 'plagued'

export type CommandType = 'placeNode' | 'removeNode' | 'placeBot' | 'triggerEvent'

/** World events the player can trigger (M8). Drought, bounty, plague and blight last a while; a meteor and an outbreak (D1) are instant. */
export type EventKind = 'drought' | 'bounty' | 'plague' | 'meteor' | 'blight' | 'outbreak'

/** The ones that last a while and sit in `World.events`. */
export type TimedEventKind = 'drought' | 'bounty' | 'plague' | 'blight'

export type SimEvent = {
  tick: number
  type: SimEventType
  botId?: number
  nodeId?: number
  cause?: DeathCause
  /** Command events only: which command, and for placeNode/removeNode the node's kind. */
  command?: CommandType
  nodeKind?: NodeKind
  /** triggerEvent commands, and `event` entries: which world event. */
  eventKind?: EventKind
  /** `predator` events (E1): what happened to the predator in `nodeId`. */
  predatorEvent?: PredatorEventKind
  x: number
  y: number
}

/** Player actions (M4). Recorded in `World.commands` so a run can be replayed. */
export type Command =
  | { type: 'placeNode'; kind: NodeKind; x: number; y: number; sex?: Sex }
  | { type: 'removeNode'; id: number }
  /** `sex` is the player's choice; absent means Auto (`autoSex`). It is the last key, and only present when given. */
  | { type: 'placeBot'; x: number; y: number; sex?: Sex }
  /** `x` and `y` are needed for plague and meteor (the centre) and ignored for drought and bounty. */
  | { type: 'triggerEvent'; event: EventKind; x?: number; y?: number }

export type TraitName = keyof Traits

/** One scripted world event of a scenario preset: applied by the sim itself when the world reaches `tick`, and not recorded in `World.commands`. */
export type ScriptEntry = { tick: number; cmd: Extract<Command, { type: 'triggerEvent' }> }

/**
 * One stats row. `births` and `deaths` are running totals; `food` is the sum of resource amounts;
 * `traits` is the population mean of each trait, or null when nobody is alive.
 */
export type Sample = {
  tick: number
  pop: number
  births: number
  deaths: number
  food: number
  traits: Traits | null
  /** Predators alive (E1). Present only in a world with predator ecology on. */
  predators?: number
}

/** Deaths by cause. `poison` (T1) exists only in a world made with poison on (last key); `disease` (D1) appears at the first disease death. Read both as `?? 0`. */
export type DeathsByCause = Record<Exclude<DeathCause, 'poison' | 'disease'>, number> & { poison?: number; disease?: number }

/** Food units eaten per source. `toxic` (T1) is the part of `resource` that came from toxic nodes; present only in a world made with poison on (last key). */
export type Eaten = { resource: number; ruin: number; toxic?: number }

/**
 * A timed world event in progress (drought, bounty, plague or blight). It is in effect for the ticks
 * `startTick + 1` to `endTick` inclusive, then removed at the end of tick `endTick`.
 * `magnitude` is what it does, copied from tuning when it starts so a running event never changes:
 * the regrowth multiplier for drought and bounty, health damage per tick for plague, food lost per tick for blight.
 * Drought and bounty are global (`x`, `y` and `radius` are 0); plague and blight cover `radius` cells around (x, y).
 */
export type ActiveEvent = {
  kind: TimedEventKind
  startTick: number
  endTick: number
  x: number
  y: number
  radius: number
  magnitude: number
}

/**
 * One bot's place in the family tree, kept after it dies (M11, see lineage.ts). `died` and `cause` are
 * null while it lives. `children` counts the children it ever had, even if their records were pruned.
 * `traits` are the ones it was born with.
 */
export type LineageRecord = {
  id: number
  parentId: number | null
  fatherId: number | null
  sex: Sex
  /** The bot's inbreeding score at birth (see `Bot.inbreeding`). */
  inbreeding: number
  /** The bot's bloodline hue at birth (see `Bot.hue`). */
  hue: number
  generation: number
  /** Tick it appeared (0 for a preset founder). */
  born: number
  died: number | null
  cause: DeathCause | null
  children: number
  traits: Traits
}

export type World = {
  seed: string
  /** Ticks completed. The first step turns 0 into 1. */
  tick: number
  width: number
  height: number
  /** Next id for any node or bot. One counter, so ids never collide. */
  nextId: number
  nodes: WorldNode[]
  /** Always in ascending id order; every loop over bots relies on it. */
  bots: Bot[]
  rng: RngState
  samples: Sample[]
  /** Ring buffer: the newest `Tuning.logCap` events. */
  log: SimEvent[]
  commands: { tick: number; cmd: Command }[]
  deathsByCause: DeathsByCause
  /** Running totals of food units bots have eaten, by where it came from. */
  eaten: Eaten
  /** Running count of births, for the stats samples. */
  totalBirths: number
  /** Timed world events in progress, oldest first. Empty unless the player triggered one. */
  events: ActiveEvent[]
  /** Running count of memory entries bots learned from a parent or child (at birth and by exchange), for the survey. */
  familyLearned: number
  /** Running count of births with an inbreeding score above 0 (M18), for the survey. */
  inbredBirths: number
  /** One record per bot, living or dead, in ascending id order. Old extinct branches are pruned (lineage.ts). */
  lineage: LineageRecord[]
  /** Records dropped from `lineage` so far. */
  lineagePruned: number
  /** Predator ecology (E1): dens and counters. Absent unless `predator.ecology.enabled` was on at creation. */
  ecology?: PredatorEcology
  /** Disease (D1): counters, created at the first outbreak (never before, so a run with no outbreak hashes as before). Last key. */
  disease?: { infected: number; recovered: number }
  /** Culture (C1): counters, created in createWorld only when `tuning.culture.enabled` (absent with culture off). */
  culture?: { taught: number }
  /** Scenario script: entries not yet applied, sorted by tick (scenario.ts). Present only in a world made from a preset with a script, until the last entry is applied. Last key. */
  script?: ScriptEntry[]
  /** Disease resistance (R1): created lazily at the first outbreak with `tuning.resistance.enabled` (resistance.ts), never before, so a run with no outbreak hashes as before. Last key. */
  resistance?: { stream: RngStream; founderMean: number; activatedTick: number }
}

/** Numbers for one kind of node, applied by createWorld and by the placeNode command. */
export type NodeDef = {
  radius: number
  capacity: number
  regen: number
  damage: number
  heal: number
  drainMult: number
  decay: number
}

export type NodeDefs = Record<NodeKind, NodeDef>

/** Every behaviour number the sim reads. Defined in src/content/tuning.ts. */
export type Tuning = {
  bot: {
    maxEnergy: number
    startEnergy: number
    maxHealth: number
    /** Full water level. Every founder, placed bot and newborn starts here. */
    maxThirst: number
    /** Cells per tick. */
    speed: number
    /** Largest random turn per tick while wandering, in radians. */
    turnRate: number
    /** Energy lost per tick just by being alive, times `traits.metabolism`. */
    baseDrain: number
    /** Extra energy lost on a tick the bot moved, times `traits.metabolism`. */
    moveDrain: number
    /**
     * Extra energy lost per tick for each cell of `senseRadius` above the default
     * (`Tuning.traits.senseRadius`); a smaller radius saves the same amount per cell.
     * Times `traits.metabolism`. This is what stops evolution from maximising sight.
     */
    senseDrain: number
    /**
     * M22: energy lost per tick for each point of `sprint` above 1 (a sprint below 1 saves the same), times
     * `traits.metabolism`. A step taken while fleeing also costs `moveDrain` times `sprint`.
     */
    sprintUpkeep: number
    /** M22: the whole energy drain is multiplied by `1 + hardinessDrain * (hardiness - 1)`. */
    hardinessDrain: number
    /** M22: the whole energy drain is multiplied by `1 + longevityDrain * (longevity - 1)`. */
    longevityDrain: number
    /**
     * How much `traits.metabolism` changes walking speed: speed is `speed` times
     * `1 + metabolismSpeed * (metabolism - 1)`. A hotter bot burns more but moves faster.
     */
    metabolismSpeed: number
    /** A bot starts looking for food below this fraction of `maxEnergy`. */
    hungryBelow: number
    /** ...and keeps eating until it reaches this fraction. */
    satedAbove: number
    /** Thirst lost per tick by a bot with metabolism 1 (shelter does not slow it). At 0 the bot dies of thirst. */
    thirstDrain: number
    /** The drain is multiplied by `max(1, traits.metabolism)` to this power: a hot bot dries out much faster, a cool one no slower. */
    thirstMetabolismPower: number
    /** A bot starts looking for water below this fraction of `maxThirst`... */
    thirstyBelow: number
    /** ...and keeps drinking until it reaches this fraction. */
    quenchedAbove: number
    /** Thirst regained per tick while standing at a water node. */
    drinkRate: number
    /** Resource units taken per tick while eating. */
    eatRate: number
    /** Energy gained per resource unit eaten. */
    energyPerUnit: number
    /** Health regained per tick anywhere, on top of a shelter's heal. */
    healthRegen: number
    /** Age (ticks) at which a bot dies of old age. */
    maxAge: number
    /** Age (ticks) at which a bot becomes an adult: fertility starts here (see `Tuning.fertility`), and the map draws it full size. */
    adultAge: number
    /** Ticks a parent (and its child) must wait before reproducing. */
    reproCooldown: number
    /** Fraction of the parent's energy handed to the child at birth. */
    childEnergyShare: number
    /**
     * Energy the parent burns at a birth, on top of what it hands over (that part is lost, not
     * given to the child). It makes breeding on a thin energy reserve risky, which is what keeps
     * `reproThreshold` from evolving down to its floor.
     */
    birthCost: number
    /** A child appears at most this far from its parent, in cells. */
    spawnSpread: number
  }
  /**
   * Fertility by age (M16), a piecewise linear curve between 0 and 1: 0 below `bot.adultAge`,
   * `startFraction` at adultAge rising to 1 at `primeAge`, 1 until `declineAge`, then falling to 0
   * at `fertileUntil` and 0 after. A bot may breed only while fertility is above 0, and after a
   * birth its cooldown is `bot.reproCooldown` divided by its fertility (rounded up), so the young
   * and the old breed less often.
   */
  fertility: {
    startFraction: number
    primeAge: number
    declineAge: number
    fertileUntil: number
  }
  /**
   * Two sexes (M17). With `enabled` a birth needs a female and a male standing in shelters within
   * `mateRange` cells; the female bears the child and the male pays `maleCost` energy. Each child is
   * female with chance `femaleChance`. Off: a bot breeds alone, as before M17.
   */
  sex: {
    enabled: boolean
    femaleChance: number
    mateRange: number
    /** Energy a father loses at a birth (burned, not handed on). */
    maleCost: number
    /** A father's cooldown after a birth, divided by his fertility and rounded up. */
    maleCooldown: number
  }
  /**
   * Inbreeding penalty (M18). A child's score is 1 for parent and child or full siblings, 0.5 for half
   * siblings, else 0. At score s its lifespan is cut by lifespanLoss * s, and it starts with energy and
   * health cut by energyLoss * s and healthLoss * s (fractions, 0 to 1).
   */
  inbreeding: {
    lifespanLoss: number
    energyLoss: number
    healthLoss: number
  }
  /**
   * Mate choice (G1, off in Eden). With `enabled`, males seek and `pairMates` pairs unrelated bots first;
   * a pair with kinship (kin.ts) of at least `avoidAt` (0 to 1) is kin and forms only when `lastResort`.
   */
  mateChoice: {
    enabled: boolean
    avoidAt: number
    lastResort: boolean
  }
  /** Bloodline colour gene (M20): a child's hue drifts up to this many degrees from the parent hue it takes. */
  gene: {
    drift: number
  }
  brain: {
    /** Utility of seeking food is this times the missing energy fraction. */
    seekWeight: number
    /** Utility of seeking water is this times the missing thirst fraction. */
    thirstWeight: number
    /** Utility of resting is this times the missing health fraction. */
    restWeight: number
    /** Utility of walking to a shelter to reproduce. */
    reproduceScore: number
    /** Utility of walking toward a sensed ready female (males only, sexes on). Above `reproduceScore`, so sight beats the shelter. */
    seekMateScore: number
    /** Utility of wandering, the fallback. */
    wanderScore: number
    /** Flee utility when inside danger, before caution and health terms. */
    fleeBase: number
    /** Added flee utility per point of the caution trait. */
    fleeCaution: number
    /** Added flee utility per missing health fraction. */
    fleeHealth: number
    /** Flee starts this far (cells) outside a danger's edge. */
    fleeMargin: number
    /** Walking and wandering keep this far (cells) outside a remembered danger's edge. */
    avoidMargin: number
    /** Below this energy (or thirst) fraction a bot of founder caution seeking food (or water) ignores danger avoidance. */
    desperateBelow: number
    /** The threshold is `desperateBelow x (1 + this x (founder caution - bot caution))`: more for a reckless bot, less for a cautious one. 0 turns it off. */
    cautionDesperate: number
    /** ...clamped to at least this fraction... */
    minDesperate: number
    /** ...and at most this fraction. */
    maxDesperate: number
    /** A bot looks for a shelter to heal in below this health fraction... */
    restBelow: number
    /** ...and stays until it reaches this fraction. */
    restUntil: number
    /** Radians between the headings tried when steering around a danger. */
    steerStep: number
    /** A resting bot stops once it is within this fraction of a shelter's radius from its centre. */
    settleFraction: number
  }
  population: {
    /** Hard cap on living bots; births stop at the cap. */
    cap: number
  }
  /** Traits given to bots placed by a preset or by the player (the founders). */
  traits: Traits
  mutation: {
    /** Chance (0 to 1) that a given trait of a newborn is changed. */
    rate: number
    /** A changed trait is multiplied by a factor between 1 - strength and 1 + strength. 0 turns mutation off. */
    strength: number
    /** Every trait of every newborn is clamped into these bounds. */
    bounds: Record<TraitName, { min: number; max: number }>
  }
  memory: {
    /** Most entries a bot keeps, water not counted. */
    cap: number
    /** Extra entries kept for water only, so a crowd of food and ruins cannot push the springs out. */
    waterCap: number
    /** Extra entries kept for predator sightings only (a third class), so they never push food out. */
    predatorCap: number
    /** A remembered-empty resource is worth another look after this many ticks. */
    retryTicks: number
  }
  /** Knowledge sharing between a parent and its own child (M10, see family.ts). Nobody else shares. */
  family: {
    /** A newborn starts with a copy of its parent's shareable memory as it was at conception. */
    inherit: boolean
    /** A living parent and child this close (cells) swap memory on share ticks. 0 turns exchange off. */
    shareRadius: number
    /** ...on ticks that are a multiple of this. */
    shareEvery: number
    /** Only entries of these kinds pass. */
    shareKinds: NodeKind[]
  }
  /** The family-tree store (M11, see lineage.ts). Bookkeeping only: it never changes how the bots behave. */
  lineage: {
    /** When there are more records than this, pruning starts. */
    maxRecords: number
    /** ...and drops records until this many are left (extinct branches first), so pruning runs in batches. */
    pruneTo: number
  }
  stats: {
    /** A Sample is recorded every this many ticks. */
    sampleEvery: number
    /** Oldest samples are dropped past this many. */
    maxSamples: number
    /** Ticks that count as one "minute" for per-minute rates (10 ticks/s at 1x speed, so 600 = one minute). */
    minuteTicks: number
  }
  player: {
    /** A node may not be placed with its centre closer than this (cells) to a node of the same kind. */
    minNodeGap: number
    /** Most nodes the player may place; placing stops at the cap. Ruins do not count (see `ruin.maxCount`). */
    maxNodes: number
  }
  /** What a dead bot leaves behind (a ruin node; its radius, capacity and decay are in `nodeDefs.ruin`). */
  ruin: {
    /** Food units every ruin starts with, whatever the bot's energy. */
    baseAmount: number
    /** Plus this fraction of the bot's remaining energy, counted in food units (energy / `energyPerUnit`). */
    energyShare: number
    /** A death within this distance (cells) of an existing ruin adds to it instead of making a new one. */
    mergeRadius: number
    /** Most ruins the world may hold; past it a death adds to the nearest ruin, however far. */
    maxCount: number
    /** A ruin whose centre is inside any danger node's radius (a meteor crater since M21b) decays this many times as fast. 1 turns it off. */
    dangerDecayMult: number
  }
  /** World events the player can trigger (M8). Applied by the `triggerEvent` command (worldEvents.ts). */
  events: {
    /** Most timed events (drought, bounty, plague) in progress at once. */
    maxActive: number
    /** Most meteor craters standing at once. */
    maxCraters: number
    drought: {
      /** Ticks it lasts. */
      duration: number
      /** Resource regrowth is multiplied by this (under 1 slows it). Springs and ruins are not affected. */
      regrowMult: number
    }
    bounty: {
      duration: number
      /** Resource regrowth is multiplied by this (over 1 speeds it up). */
      regrowMult: number
    }
    plague: {
      duration: number
      /** Cells around the clicked point. */
      radius: number
      /** Health lost per tick by every bot inside, on top of any danger. Shelter healing still applies. */
      damage: number
    }
    blight: {
      duration: number
      /** Cells around the clicked point; a resource node whose centre is inside neither regrows nor holds its food. */
      radius: number
      /** Food units a resource node inside loses per tick (floored at 0). */
      drain: number
    }
    meteor: {
      /** Cells around the impact that take damage at once. */
      radius: number
      /** Health damage at the centre of the impact; it falls off in a straight line to 0 at `radius`. */
      damage: number
      /** The crater it leaves is a danger node of this radius... */
      craterRadius: number
      /** ...that does this much health damage per tick... */
      craterDamage: number
      /** ...and stays this many ticks. */
      craterTicks: number
    }
    /**
     * Events hurt predators (EP1, off). Acts only with `predator.ecology.enabled` and only on a predator that has a life (a static
     * predator is untouched). A meteor removes every predator within `meteor.radius * meteorKillFraction` of the impact (placed ones too);
     * a plague takes `plagueDrain` energy per tick per plague disc a predator stands in (stacking, like the bots' plague damage), so a
     * predator that starves on a tick the plague drained it is logged `plagued`, not `starved`.
     */
    predatorHarm: {
      enabled: boolean
      /** Share of the meteor radius that kills a predator, above 0 up to 1. */
      meteorKillFraction: number
      /** Energy a predator loses per tick inside each plague disc, 0 or more. */
      plagueDrain: number
    }
  }
  /**
   * Predators (M21a, see predators.ts). Each takes one `predator`-stream draw per tick (a wander turn). A predator
   * hunts the nearest living bot outside every shelter within `senseRadius`, bites a bot within `biteRange` for the
   * node's `damage` per tick, and rests `digestTicks` after a kill or `giveUpRest` after `chaseTicks` of chasing.
   * It never enters a shelter's radius. Predators do not count toward `player.maxNodes`.
   */
  predator: {
    /** Most predators the world may hold (placeNode refuses beyond it). */
    maxCount: number
    /** A predator hunts a bot whose centre is this close to it (cells); a bot senses one by its centre within its own sense radius. */
    senseRadius: number
    /** Cells per tick. */
    speed: number
    /** A bot this close (cells) to a resting-free predator's centre is bitten. */
    biteRange: number
    /** Ticks of chasing one target before giving up. */
    chaseTicks: number
    /** Ticks of rest after giving up. */
    giveUpRest: number
    /** Ticks of rest after a kill. */
    digestTicks: number
    /** A bot forgets a predator sighting after this many ticks (it expects the hunter to have moved). */
    memoryTicks: number
    /** A wandering predator is steered back when farther than this (cells) from where it was placed. */
    homeRange: number
    /** Radians between the headings tried when steering around a shelter. */
    steerStep: number
    /**
     * Predator ecology (E1; switched on in Eden by E2). With it on a predator has energy (`life`): it loses `drain` a tick, gains
     * `killEnergy` a kill (up to `maxEnergy`), hunts only below `huntBelow`, starves at 0 and dies of age at `maxAge`. After
     * `killsPerCub` kills, once adult and fed, it breeds alone into free territory. Empty dens are re-colonised from the map edge.
     */
    ecology: {
      /** Off: no `life`, no dens, no extra draws; the world is as it was before E1. */
      enabled: boolean
      /** Energy lost per predator per tick (may be 0). */
      drain: number
      /** Energy a kill gives. */
      killEnergy: number
      /** Energy ceiling. */
      maxEnergy: number
      /** A predator hunts and bites only while its energy is below this (at most `maxEnergy`); a sated one wanders home. */
      huntBelow: number
      /** Age (ticks) at which a predator dies of age. */
      maxAge: number
      /** Age below which a predator cannot breed. */
      adultAge: number
      /** Kills needed since its last cub before it breeds again. */
      killsPerCub: number
      /** Energy a cub starts with. */
      cubEnergy: number
      /** Energy the parent pays for a cub (it must also stay above `huntBelow` afterwards). */
      cubCost: number
      /** Territory spots tried for a cub (two `predator` draws each). */
      homeTries: number
      /** Cells: a new home is between this and twice this from the parent's home, and at least this far from every other home. */
      homeSpacing: number
      /** Cells: a new home stays this far inside the map edge. */
      homeMargin: number
      /** Cells: a predator homed within this of a den occupies it. */
      denRadius: number
      /** Ticks a den stays empty before a newcomer arrives from the map edge. */
      recolonizeTicks: number
    }
    /**
     * Predator-prey rule (P1; off). Acts only when `ecology.enabled` is also true. The predator count is limited to
     * `floor(bots / perPredator)` (at least `minCount`, at most `maxCount`): over the limit no cub is born and no newcomer arrives,
     * and after `leaveAfter` ticks over it the hungriest non-placed predator leaves the map. Player-placed predators never leave.
     */
    prey: {
      enabled: boolean
      /** Living bots needed to support one predator. */
      perPredator: number
      /** Predators the limit never goes below (0 up to `maxCount`). */
      minCount: number
      /** Ticks the count must stay over the limit before one predator leaves (at least 1). */
      leaveAfter: number
    }
    /**
     * Heritable predator traits (H1; off). Acts only when `ecology.enabled` is also true. A cub inherits its parent's sense (range),
     * speed and stamina (chase length) multipliers with a seeded mutation; founders, placed and arriving predators start at 1.
     * `price` is the extra share of `ecology.drain` per unit a trait is above 1 (a trait below 1 lowers it): drain x (1 + sum of price x (trait - 1)).
     */
    traits: {
      enabled: boolean
      mutation: { rate: number; strength: number }
      bounds: Record<PredatorTraitName, { min: number; max: number }>
      price: Record<PredatorTraitName, number>
    }
    /**
     * Predator sexes (PS1; off). Acts only when `ecology.enabled` is also true. Predators are female or male; only a female bears a cub, and only with an adult
     * male within `mateRange` of her (the male pays nothing). When only one sex has been alive for `loneAfter` ticks any predator breeds alone (E1 rule).
     * `killsPerCub` replaces `ecology.killsPerCub` while sexes are on. With `crossover` a cub takes each trait from its mother or its father.
     */
    sexes: {
      enabled: boolean
      /** Cells: how far from the female an adult male may be to mate (the whole map is 120 wide in Eden). */
      mateRange: number
      /** Ticks one sex may be missing before any predator may breed alone (whole number from 1). */
      loneAfter: number
      /** Kills a female needs for a cub (whole number from 1). */
      killsPerCub: number
      /** A cub's traits come from either parent (else the mother's). */
      crossover: boolean
    }
  }
  /**
   * Seasons (S1): food regrowth swings with the tick, multiplier = base + amplitude * sin(2 * pi * tick / period), so tick 0
   * is the start of spring, summer peaks at a quarter period and winter bottoms out at three quarters. Only resource
   * regrowth is seasonal. No random draws; see seasons.ts.
   */
  seasons: {
    /** Off: the multiplier is exactly 1 and the world is as it was before seasons. */
    enabled: boolean
    /** Ticks in one full year (greater than 0). */
    period: number
    /** Half the swing of the regrowth multiplier (0 to 0.5). */
    amplitude: number
    /** The yearly average multiplier. */
    base: number
  }
  /**
   * Directional sensing (V1): reach depends on the angle off the heading. On in Eden since V2; with it off nothing changes and nothing
   * extra is hashed. No random draws; see perception.ts and predators.ts.
   */
  perception: {
    cone: {
      /** Off: sensing is the same disc as before V1. */
      enabled: boolean
      /** Bot sense radius multiplier straight ahead (above 0, at least botRear). */
      botFront: number
      /** Bot sense radius multiplier straight behind (0 up to botFront); everything inside it is always seen. */
      botRear: number
      /** Predator sense radius multiplier straight ahead. */
      predatorFront: number
      /** Predator sense radius multiplier straight behind. */
      predatorRear: number
      /** Ticks a self-seen predator stays tracked after it leaves the cone (whole number from 0). */
      trackTicks: number
    }
  }
  /**
   * Toxic food (T1). Off: no node is toxic and nothing extra is hashed. On, the last `toxicCount` scattered resource nodes of a new world
   * carry a toxin. Toxic food still gives its full energy; the bite also costs health (see poison.ts). No random draws.
   */
  poison: {
    enabled: boolean
    /** Scattered resource nodes made toxic when a world is created (a whole number from 0; capped by how many there are). */
    toxicCount: number
    /** Health damage per unit of toxic food eaten (finite, 0 or more), before the bot's hardiness divides it. */
    damagePerUnit: number
  }
  /**
   * Rough ground (R1). Off: no rough node is made and nothing is slowed. On, a mover whose step starts inside a rough disc walks its
   * step length times the multiplier below (overlapping discs do not compound). Slow only: no extra energy cost, bots do not perceive
   * it. No random draws. See terrain.ts.
   */
  terrain: {
    enabled: boolean
    /** Step length multiplier for a bot on rough ground (finite, above 0, at most 1). */
    botSpeedMult: number
    /** Step length multiplier for a predator on rough ground (finite, above 0, at most 1). */
    predatorSpeedMult: number
    /** R2b: when true a FLEEING bot is not slowed by rough ground (it keeps speed x sprint); walking and wandering still are. Only read with terrain on. */
    fleeExempt: boolean
    /** Most rough nodes the player may have in the world (a whole number from 0; checked on placing, preset ones count). */
    maxCount: number
    /** R2c: when true rough ground slows a bot only on a wander step (no target: not fleeing, not walking to food, water, shelter or a mate); every walk toward a target and every flee step keeps full speed. Only read with terrain on; predators are unchanged. */
    wanderOnly: boolean
  }
  /**
   * Disease (D1, off). The player starts an `outbreak` event: every bot within `outbreakRadius` falls sick at once. A bot within
   * `contactRadius` of a sick bot for `catchAfter` ticks in a row (the count falls by 1 a tick without contact) falls sick too. A sick
   * bot takes `sickDrain` health damage a tick (divided by hardiness) for `sickTicks` ticks, then is immune for `immuneTicks`.
   * No random draws. See disease.ts.
   */
  disease: {
    enabled: boolean
    outbreakRadius: number
    contactRadius: number
    catchAfter: number
    sickTicks: number
    sickDrain: number
    immuneTicks: number
  }
  /**
   * Culture (C1, off): every `teachEvery` ticks each young bot (age under `youngAge` x longevity) takes one lesson from the nearest elder
   * (age from `elderAge` x longevity) within `teachRadius` that is not its mother or father: up to `perLesson` memory entries of the
   * `teachKinds`, freshest first, only where the pupil lacks the node or knows an older sighting. A user-approved exception to
   * GAME_DESIGN section 5 item 1. No random draws. See culture.ts.
   */
  culture: {
    enabled: boolean
    elderAge: number
    youngAge: number
    teachRadius: number
    teachEvery: number
    perLesson: number
    teachKinds: NodeKind[]
    /** C2b: teach only places farther from the pupil than its own `traits.senseRadius` (plain distance); false is the C1 lesson. */
    beyondSense: boolean
  }
  /** Events kept in `World.log` (births, deaths and player commands). */
  logCap: number
  /**
   * Disease resistance (R1, off): a latent heritable number. At the first outbreak every living bot gets `resist` between `founderMin`
   * and `founderMax` (own RNG stream kept in `World.resistance`, not one of the named streams); newborns inherit it (mother or father,
   * then a mutation, clamped to `min`..`max`). `resist` r multiplies the dose needed to fall sick by 1 + catchWeight * (r - 1) and divides
   * sickness length by 1 + sickWeight * (r - 1); `upkeep` is the energy a tick per point above 1. See resistance.ts.
   * R3: `damageWeight` divides the sickness health damage by 1 + damageWeight * (r - anchor); `centred` makes every effect use
   * the anchor `World.resistance.founderMean` instead of 1 (so a bot at the founders' mean is treated as before the gene existed, and a
   * bot below it is a little worse off), in the dose, the length and the damage alike.
   */
  resistance: {
    enabled: boolean
    founderMin: number
    founderMax: number
    min: number
    max: number
    catchWeight: number
    sickWeight: number
    upkeep: number
    mutation: { rate: number; strength: number }
    damageWeight: number
    centred: boolean
  }
}

/** What the sim needs from content: behaviour numbers and node numbers. */
export type Rules = {
  tuning: Tuning
  nodeDefs: NodeDefs
}

export type PresetNode = { kind: NodeKind; x: number; y: number }

/** A starting scene. Scattered items are placed with the world stream. */
export type Preset = {
  id: string
  label: string
  width: number
  height: number
  /** Nodes at fixed positions. */
  nodes: PresetNode[]
  /** Nodes at random positions. */
  scatter: { kind: NodeKind; count: number }[]
  /** Bots at fixed positions. */
  bots: { x: number; y: number }[]
  /** Bots at random positions. */
  scatterBots: number
  /** Rough ground discs (R1), made only when `terrain.enabled`; they come last in the node list so no other id changes. */
  terrain?: { x: number; y: number; radius: number }[]
  /** Scenario events at fixed ticks (scenario.ts). Absent for a plain world. */
  script?: ScriptEntry[]
  /** One sentence shown under the World select. */
  description?: string
}
