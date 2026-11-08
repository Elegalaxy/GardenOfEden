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

export type NodeKind = 'resource' | 'danger' | 'shelter'

/**
 * One purposeful spot on the map. Only the fields a kind uses matter; the
 * rest stay 0 so every node has the same shape.
 * - resource: `amount` (0..capacity) refills by `regen` per tick.
 * - danger: `damage` health per tick to a bot inside `radius`.
 * - shelter: `heal` health per tick, and `drainMult` scales energy loss.
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
}

/** Per-bot numbers that later generations can inherit (M6). */
export type Traits = {
  senseRadius: number
  caution: number
  reproThreshold: number
  metabolism: number
}

export type IntentKind = 'wander' | 'seekFood' | 'flee' | 'rest' | 'reproduce'

export type Intent = {
  kind: IntentKind
  targetId: number | null
}

/** What a bot remembers about a node it once sensed. */
export type MemoryEntry = {
  nodeId: number
  kind: NodeKind
  x: number
  y: number
  radius: number
  seenTick: number
  amount: number
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

export type DeathCause = 'starve' | 'danger' | 'age'

export type SimEventType = 'birth' | 'death' | 'depleted' | 'command'

export type SimEvent = {
  tick: number
  type: SimEventType
  botId?: number
  nodeId?: number
  cause?: DeathCause
  x: number
  y: number
}

/** Player actions (M2). Recorded in `World.commands` so a run can be replayed. */
export type Command =
  | { type: 'placeNode'; kind: NodeKind; x: number; y: number }
  | { type: 'removeNode'; id: number }
  | { type: 'placeBot'; x: number; y: number }

/** One stats row. `births` and `deaths` are running totals; `food` is the sum of resource amounts. */
export type Sample = {
  tick: number
  pop: number
  births: number
  deaths: number
  food: number
}

export type DeathsByCause = Record<DeathCause, number>

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
  /** Running count of births, for the stats samples. */
  totalBirths: number
}

/** Numbers for one kind of node, applied by createWorld (and by placeNode in M2). */
export type NodeDef = {
  radius: number
  capacity: number
  regen: number
  damage: number
  heal: number
  drainMult: number
}

export type NodeDefs = Record<NodeKind, NodeDef>

/** Every behaviour number the sim reads. Defined in src/content/tuning.ts. */
export type Tuning = {
  bot: {
    maxEnergy: number
    startEnergy: number
    maxHealth: number
    /** Cells per tick. */
    speed: number
    /** Largest random turn per tick while wandering, in radians. */
    turnRate: number
    /** Energy lost per tick just by being alive, times `traits.metabolism`. */
    baseDrain: number
    /** Extra energy lost on a tick the bot moved, times `traits.metabolism`. */
    moveDrain: number
    /** A bot starts looking for food below this fraction of `maxEnergy`. */
    hungryBelow: number
    /** ...and keeps eating until it reaches this fraction. */
    satedAbove: number
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
    /** A child appears at most this far from its parent, in cells. */
    spawnSpread: number
  }
  brain: {
    /** Utility of seeking food is this times the missing energy fraction. */
    seekWeight: number
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
    /** Below this energy fraction a seeking bot ignores danger avoidance. */
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
  /** Traits given to bots placed by a preset. */
  traits: Traits
  memory: {
    /** Most entries a bot keeps. */
    cap: number
    /** A remembered-empty resource is worth another look after this many ticks. */
    retryTicks: number
  }
  stats: {
    /** A Sample is recorded every this many ticks. */
    sampleEvery: number
    /** Oldest samples are dropped past this many. */
    maxSamples: number
  }
  /** Events kept in `World.log`. */
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
