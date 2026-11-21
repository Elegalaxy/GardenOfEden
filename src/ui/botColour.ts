// How a bot is drawn on the map (M20): its fill colour and its shape, by the page's "colour bots by" mode.
// Pure and DOM-free; the page only (nothing here is saved, hashed or sent to the worker).
//
//   plain     every bot the same gold, as before M20.
//   bloodline the bot's `hue` gene (degrees) as an HSL colour, so a family reads as one colour. Blues and
//             purples are drawn lighter so they keep 3:1 against the dark map.
//   sex       females a warm gold dot, males a cool blue diamond (the shape is the second cue).
//   trait     one trait on a 5-step sequential ramp (dim violet to bright yellow) over the living
//             population's lowest to highest value. The legend prints those two numbers.
//   illness   the bot's disease stage: healthy a calm tan, exposed amber, sick red-orange, immune teal (each at
//             least 3:1 against the map). The map's illness rings and dot (render.ts drawIllness) stay on in every
//             mode, so the stage is told apart by shape too.
// Colour is never the only cue: sex has a shape, illness has its rings, and the legend and the inspector print the numbers.

import { TRAIT_NAMES } from '../sim/traits.ts'
import type { Bot, TraitName } from '../sim/types.ts'
import type { IllnessStage } from './protocol.ts'

export const BOT_COLOUR_MODES = ['plain', 'bloodline', 'sex', 'trait', 'illness'] as const
export type BotColourMode = (typeof BOT_COLOUR_MODES)[number]

export const BOT_COLOUR_LABEL: Record<BotColourMode, string> = {
  plain: 'Plain',
  bloodline: 'Bloodline',
  sex: 'Sex',
  trait: 'Trait',
  illness: 'Illness',
}

/** The colour setting the page keeps: a mode, and which trait the `trait` mode shows. */
export type BotColour = { mode: BotColourMode; trait: TraitName }

export const DEFAULT_BOT_COLOUR: BotColour = { mode: 'plain', trait: TRAIT_NAMES[0]! }

export const PLAIN_FILL = '#f2cc60'
export const FEMALE_FILL = '#f2cc60'
export const MALE_FILL = '#6ec8ff'

/** The trait ramp, lowest to highest (each at least 3:1 against the map colour #141a24). */
export const TRAIT_RAMP: readonly string[] = ['#8a7fd8', '#5aa0e0', '#3fc1b0', '#8ad66a', '#f4e04d']

/** The illness colours: a healthy bot (absent stage), then exposed, sick and immune (each at least 3:1 against #141a24). */
export const HEALTHY_FILL = '#c9b98a'
export const ILLNESS_FILL: Record<IllnessStage, string> = { exposed: '#ffb020', sick: '#ff5a36', immune: '#2ec4b6' }

export type TraitRange = { min: number; max: number }

export type ColourBot = Pick<Bot, 'hue' | 'sex' | 'traits'> & { illnessStage?: IllnessStage }

/** The next mode in the cycle plain, bloodline, sex, trait, illness, plain (the C key). */
export function nextBotColourMode(mode: BotColourMode): BotColourMode {
  return BOT_COLOUR_MODES[(BOT_COLOUR_MODES.indexOf(mode) + 1) % BOT_COLOUR_MODES.length]!
}

/** Whether a key press is the colour key (C on its own: not with Ctrl, Alt, Meta or Shift). The caller still ignores presses while typing. */
export function isBotColourKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  return event.key === 'c' || event.key === 'C'
}

/** Lowest and highest value of one trait over these bots, or null when there are none. */
export function traitRange(bots: readonly Pick<Bot, 'traits'>[], trait: TraitName): TraitRange | null {
  if (bots.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const bot of bots) {
    const value = bot.traits[trait]
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

/** The step (0 to 4) of the ramp a value falls in; the middle one when everyone is equal. */
export function rampStep(value: number, range: TraitRange | null): number {
  if (range === null || !(range.max > range.min)) return 2
  const t = (value - range.min) / (range.max - range.min)
  return Math.min(TRAIT_RAMP.length - 1, Math.max(0, Math.floor(t * TRAIT_RAMP.length)))
}

/** The CSS colour of a bloodline hue: 64% light, 72% for the blues and purples (hues 220 to 290). */
export function bloodlineColour(hue: number): string {
  const lightness = hue >= 220 && hue <= 290 ? 72 : 64
  return `hsl(${Math.round(hue * 10) / 10} 70% ${lightness}%)`
}

/** The fill of a bot. `range` is the population's range of `trait` (only read in `trait` mode). */
export function botFill(bot: ColourBot, mode: BotColourMode, trait: TraitName, range: TraitRange | null): string {
  switch (mode) {
    case 'plain':
      return PLAIN_FILL
    case 'bloodline':
      return bloodlineColour(bot.hue)
    case 'sex':
      return bot.sex === 'male' ? MALE_FILL : FEMALE_FILL
    case 'trait':
      return TRAIT_RAMP[rampStep(bot.traits[trait], range)]!
    case 'illness':
      return bot.illnessStage === undefined ? HEALTHY_FILL : ILLNESS_FILL[bot.illnessStage]
  }
}

/** Circle for everyone, except males in `sex` mode (a diamond). */
export function botShape(bot: Pick<Bot, 'sex'>, mode: BotColourMode): 'circle' | 'diamond' {
  return mode === 'sex' && bot.sex === 'male' ? 'diamond' : 'circle'
}
