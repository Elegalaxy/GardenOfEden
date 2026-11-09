// Plain-JSON data model for the world. No classes, no functions, no Maps: a
// World survives JSON.parse(JSON.stringify(world)) and is hashed as JSON.
// Numbers that tune behaviour live in src/content/tuning.ts and reach the sim
// as a `Rules` value, never as imports.

// RNG stream names, in splitmix32 expansion order. Do not reorder: the sequence
// for a seed depends on this order.
export const RNG_STREAM_NAMES = ['world', 'ai', 'birth'] as const

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number]

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

/** The three named streams for one run. Plain JSON, no hidden generator. */
export type RngState = {
  world: RngStream
  ai: RngStream
  birth: RngStream
}

/** One choice for `pickWeighted`. `weight` must be finite and >= 0. */
export type Weighted<T> = {
  value: T
  weight: number
}

export type NodeKind = 'resource' | 'danger' | 'shelter' | 'ruin' | 'water'

/**
 * One purposeful spot on the map. Only the fields a kind uses matter; the
 * rest stay 0 so every node has the same shape.
 * - resource: `amount` (0..capacity) refills by `regen` per tick.
 * - danger: `damage` health per tick to a bot inside `radius`.
 * - shelter: `heal` health per tick, and `drainMult` scales energy loss.
 * - ruin: food left by a dead bot. `amount` (0..capacity) falls by `decay` per tick and by being
 *   eaten; the node is removed at 0. Made by the sim only (ruins.ts), never by a preset.
 * - water: a permanent spring. A bot within `radius` drinks `Tuning.bot.drinkRate` thirst per tick.
 *   It is never used up, so it has no amount: `amount` and `capacity` stay 0.
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
}

/** Per-bot numbers that children inherit with a small mutation (M6). */
export type Traits = {
  senseRadius: number
  caution: number
  reproThreshold: number
  metabolism: number
}

export type IntentKind = 'wander' | 'seekFood' | 'seekWater' | 'flee' | 'rest' | 'reproduce'

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
  parentId: number | null
  traits: Traits
  memory: MemoryEntry[]
  intent: Intent
  /** Radians. */
  heading: number
}

export type DeathCause = 'starve' | 'thirst' | 'danger' | 'plague' | 'meteor' | 'age'

/** `event` is the sim announcing that a world event ended (its start is the player's `command`). */
export type SimEventType = 'birth' | 'death' | 'command' | 'event'

export type CommandType = 'placeNode' | 'removeNode' | 'placeBot' | 'triggerEvent'

/** World events the player can trigger (M8). Drought, bounty and plague last a while; a meteor is instant. */
export type EventKind = 'drought' | 'bounty' | 'plague' | 'meteor'

/** The ones that last a while and sit in `World.events`. */
export type TimedEventKind = 'drought' | 'bounty' | 'plague'

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
  x: number
  y: number
}

/** Player actions (M4). Recorded in `World.commands` so a run can be replayed. */
export type Command =
  | { type: 'placeNode'; kind: NodeKind; x: number; y: number }
  | { type: 'removeNode'; id: number }
  | { type: 'placeBot'; x: number; y: number }
  /** `x` and `y` are needed for plague and meteor (the centre) and ignored for drought and bounty. */
  | { type: 'triggerEvent'; event: EventKind; x?: number; y?: number }

export type TraitName = keyof Traits

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
}

export type DeathsByCause = Record<DeathCause, number>

export type Eaten = { resource: number; ruin: number }

/**
 * A timed world event in progress (drought, bounty or plague). It is in effect for the ticks
 * `startTick + 1` to `endTick` inclusive, then removed at the end of tick `endTick`.
 * `magnitude` is what it does, copied from tuning when it starts so a running event never changes:
 * the regrowth multiplier for drought and bounty, health damage per tick for plague.
 * Drought and bounty are global (`x`, `y` and `radius` are 0); plague covers `radius` cells around (x, y).
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
    /** Age (ticks) before a bot may reproduce. */
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
  brain: {
    /** Utility of seeking food is this times the missing energy fraction. */
    seekWeight: number
    /** Utility of seeking water is this times the missing thirst fraction. */
    thirstWeight: number
    /** Utility of resting is this times the missing health fraction. */
    restWeight: number
    /** Utility of walking to a shelter to reproduce. */
    reproduceScore: number
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
    /** Below this energy (or thirst) fraction a bot seeking food (or water) ignores danger avoidance. */
    desperateBelow: number
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
  }
  /** Events kept in `World.log` (births, deaths and player commands). */
  logCap: number
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
}
