// Bots as typed arrays (the frame's per-tick bot data, protocol.ts `PackedBots`). Pure and DOM-free.
//
// Why: a frame used to carry every bot as a plain object (about 580 bytes each as JSON-like data), and
// structuredClone of that cost about 12 ms at 2,000 bots. Packed, a bot is one row of two typed
// arrays (96 + 36 bytes) and the arrays are transferred, not copied. The page then builds the same
// `ViewBot` objects from the rows (`unpackBots`), so no panel, picker or drawing routine changes.
//
// Layout (row-major, one row per bot, in the world's order, ascending id):
//   f64, F64_STRIDE = 12 per bot: x, y, px, py, energy, health, thirst, heading, then the four traits
//        in `TRAIT_NAMES` order (senseRadius, caution, reproThreshold, metabolism). Float64 everywhere: positions feed picking and interpolation, and
//        keeping every float exact means the page computes the same means and samples as the World.
//   i32, I32_STRIDE = 11 per bot: id, age, cooldown, generation, parentId (the mother; -1 = none), intent kind
//        (index into `INTENT_KINDS`), intent target id (-1 = none), memoryCount, learnedCount,
//        fatherId (-1 = none), sex (index into `SEX_CODES`).
//        These are whole numbers (ids and ticks), so Int32 is exact up to 2,147,483,647.

import type { Bot, IntentKind, Sex } from '../sim/types.ts'
import type { PackedBots, ViewBot } from './protocol.ts'

/** The code of each intent kind in the packed data is its index here. */
export const INTENT_KINDS: readonly IntentKind[] = ['wander', 'seekFood', 'seekWater', 'flee', 'rest', 'reproduce', 'seekMate']

/** The code of each sex in the packed data is its index here. */
export const SEX_CODES: readonly Sex[] = ['female', 'male']

export const F64_STRIDE = 12
export const I32_STRIDE = 11

/** Packs bots (any list of bots with a memory) into typed arrays. */
export function packBots(bots: readonly Bot[]): PackedBots {
  const count = bots.length
  const f64 = new Float64Array(count * F64_STRIDE)
  const i32 = new Int32Array(count * I32_STRIDE)
  for (let i = 0; i < count; i += 1) {
    const bot = bots[i]!
    const f = i * F64_STRIDE
    f64[f] = bot.x
    f64[f + 1] = bot.y
    f64[f + 2] = bot.px
    f64[f + 3] = bot.py
    f64[f + 4] = bot.energy
    f64[f + 5] = bot.health
    f64[f + 6] = bot.thirst
    f64[f + 7] = bot.heading
    f64[f + 8] = bot.traits.senseRadius
    f64[f + 9] = bot.traits.caution
    f64[f + 10] = bot.traits.reproThreshold
    f64[f + 11] = bot.traits.metabolism
    let learned = 0
    for (const entry of bot.memory) if (entry.learnedFrom !== null) learned += 1
    const n = i * I32_STRIDE
    i32[n] = bot.id
    i32[n + 1] = bot.age
    i32[n + 2] = bot.cooldown
    i32[n + 3] = bot.generation
    i32[n + 4] = bot.parentId ?? -1
    i32[n + 5] = INTENT_KINDS.indexOf(bot.intent.kind)
    i32[n + 6] = bot.intent.targetId ?? -1
    i32[n + 7] = bot.memory.length
    i32[n + 8] = learned
    i32[n + 9] = bot.fatherId ?? -1
    i32[n + 10] = SEX_CODES.indexOf(bot.sex)
  }
  return { count, f64, i32 }
}

/** Builds the page's `ViewBot` objects from packed rows. Fresh objects on every call. */
export function unpackBots(packed: PackedBots): ViewBot[] {
  const { count, f64, i32 } = packed
  const out: ViewBot[] = new Array<ViewBot>(count)
  for (let i = 0; i < count; i += 1) {
    const f = i * F64_STRIDE
    const n = i * I32_STRIDE
    const parent = i32[n + 4]!
    const target = i32[n + 6]!
    const father = i32[n + 9]!
    out[i] = {
      id: i32[n]!,
      x: f64[f]!,
      y: f64[f + 1]!,
      px: f64[f + 2]!,
      py: f64[f + 3]!,
      energy: f64[f + 4]!,
      health: f64[f + 5]!,
      thirst: f64[f + 6]!,
      age: i32[n + 1]!,
      cooldown: i32[n + 2]!,
      generation: i32[n + 3]!,
      parentId: parent < 0 ? null : parent,
      fatherId: father < 0 ? null : father,
      sex: SEX_CODES[i32[n + 10]!] ?? 'female',
      traits: { senseRadius: f64[f + 8]!, caution: f64[f + 9]!, reproThreshold: f64[f + 10]!, metabolism: f64[f + 11]! },
      intent: { kind: INTENT_KINDS[i32[n + 5]!] ?? 'wander', targetId: target < 0 ? null : target },
      heading: f64[f + 7]!,
      memoryCount: i32[n + 7]!,
      learnedCount: i32[n + 8]!,
    }
  }
  return out
}

/** The buffers of a packed set, for a postMessage / structuredClone transfer list. */
export function packedBuffers(packed: PackedBots): ArrayBuffer[] {
  return [packed.f64.buffer as ArrayBuffer, packed.i32.buffer as ArrayBuffer]
}
