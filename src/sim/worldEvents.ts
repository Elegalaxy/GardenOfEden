// World events (M8): things the player triggers to shake the society. They are
// player commands (`triggerEvent` in commands.ts), applied between two ticks,
// so a run with events still replays from seed + commands.
//
//   drought  global, timed. Resource regrowth is multiplied by `drought.regrowMult` (under 1).
//   bounty   global, timed. Resource regrowth is multiplied by `bounty.regrowMult` (over 1).
//            Springs never regrow and ruins never regrow, so neither is affected. Both at once multiply.
//   plague   area, timed. Every bot within `plague.radius` of the clicked point loses
//            `plague.damage` health per tick (nodes.ts `exposureAt`, applied in the bot's metabolise
//            step). Shelter healing and the base regen still apply, so a shelter weaker than the plague
//            only slows it. Bots do not perceive a plague: it is invisible to the brain, they
//            do not avoid the zone, they only feel their health fall (and may walk to a shelter to
//            rest, like after any injury). That is deliberate: avoidance would need a new kind of
//            memory entry and would make the plague harmless to any bot that has already left it,
//            which is not the point of a plague.
//   meteor   area, instant. Bots within `meteor.radius` of the impact lose health at once, `meteor.damage`
//            at the centre falling in a straight line to 0 at the edge, so a hit near the centre is
//            lethal. Bots it kills die of cause 'meteor' at this moment (event logged, ruin left,
//            all in id order) rather than on the next tick. It also leaves a crater: a danger
//            node (`craterRadius`, `craterDamage`) that expires `craterTicks` later, so bots
//            remember it and steer around it through the ordinary danger paths.
//
// Rules: a drought or bounty cannot start while one of the same kind is in progress; at most
// `events.maxActive` timed events at once and `events.maxCraters` craters. A refused command changes
// nothing and is not recorded. There are no random draws and no `rng` use here.
//
// Tick order: events take effect in the bot loop (plague, in `metabolise`) and in the regrow
// phase (drought and bounty). `expireEvents` runs last in `step`, after the ruins decay: an event
// started after tick T with duration D affects ticks T+1 to T+D and is removed at the end of tick T+D.

import { leaveRuin } from './ruins.ts'
import type { ActiveEvent, Bot, EventKind, Rules, SimEvent, Tuning, World } from './types.ts'
import { makeNode, pushEvent } from './world.ts'

export type TriggerCommand = { type: 'triggerEvent'; event: EventKind; x?: number; y?: number }

export const EVENT_KINDS: readonly EventKind[] = ['drought', 'bounty', 'plague', 'meteor']

/** Ticks a timed event lasts. */
export function eventDuration(tuning: Tuning, kind: 'drought' | 'bounty' | 'plague'): number {
  return tuning.events[kind].duration
}

/** The craters (temporary danger nodes) standing now. */
function craterCount(world: World): number {
  let count = 0
  for (const node of world.nodes) {
    if (node.expires > 0) count += 1
  }
  return count
}

function insideMap(world: World, x: number | undefined, y: number | undefined): boolean {
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x <= world.width &&
    y <= world.height
  )
}

const NAME: Record<EventKind, string> = { drought: 'Drought', bounty: 'Bounty', plague: 'Plague', meteor: 'Meteor' }

/** null when the event could start now, otherwise a short reason a player can read. */
export function checkEvent(world: World, rules: Rules, cmd: TriggerCommand): string | null {
  const { events } = rules.tuning
  if (!EVENT_KINDS.includes(cmd.event)) return 'That event does not exist.'
  if (cmd.event === 'meteor') {
    if (!insideMap(world, cmd.x, cmd.y)) return 'That spot is outside the map.'
    if (craterCount(world) >= events.maxCraters) {
      return `Too many meteor craters (${events.maxCraters}) are still burning. Wait for one to fade.`
    }
    return null
  }
  if (cmd.event !== 'plague') {
    const running = world.events.find((event) => event.kind === cmd.event)
    if (running !== undefined) {
      return `${NAME[cmd.event]} is already active (${running.endTick - world.tick} ticks left).`
    }
  } else if (!insideMap(world, cmd.x, cmd.y)) {
    return 'That spot is outside the map.'
  }
  if (world.events.length >= events.maxActive) {
    return `Too many world events at once (${events.maxActive}). Wait for one to end.`
  }
  return null
}

/** Starts the event. The command must have passed `checkEvent`. Returns the crater's node id for a meteor, otherwise 0. */
export function startEvent(world: World, rules: Rules, cmd: TriggerCommand): number {
  const { tuning } = rules
  const x = cmd.x ?? 0
  const y = cmd.y ?? 0
  if (cmd.event === 'meteor') return strike(world, rules, x, y)
  const spec = tuning.events[cmd.event]
  const area = cmd.event === 'plague'
  const event: ActiveEvent = {
    kind: cmd.event,
    startTick: world.tick,
    endTick: world.tick + spec.duration,
    x: area ? x : 0,
    y: area ? y : 0,
    radius: area ? tuning.events.plague.radius : 0,
    magnitude: cmd.event === 'plague' ? tuning.events.plague.damage : tuning.events[cmd.event].regrowMult,
  }
  world.events.push(event)
  pushEvent(world, tuning, {
    tick: world.tick,
    type: 'command',
    command: 'triggerEvent',
    eventKind: cmd.event,
    x: event.x,
    y: event.y,
  })
  return 0
}

/** The impact: damage and kill in id order, then a crater. Returns the crater's node id. */
function strike(world: World, rules: Rules, x: number, y: number): number {
  const { tuning } = rules
  const m = tuning.events.meteor
  const craterId = world.nextId
  world.nextId += 1
  const crater = makeNode(craterId, 'danger', x, y, {
    ...rules.nodeDefs.danger,
    radius: m.craterRadius,
    damage: m.craterDamage,
  })
  crater.expires = world.tick + m.craterTicks
  world.nodes.push(crater)
  pushEvent(world, tuning, {
    tick: world.tick,
    type: 'command',
    command: 'triggerEvent',
    eventKind: 'meteor',
    nodeId: craterId,
    x,
    y,
  })

  const killed: Bot[] = []
  for (const bot of world.bots) {
    const d = Math.hypot(bot.x - x, bot.y - y)
    if (d >= m.radius) continue
    bot.health -= m.damage * (1 - d / m.radius)
    if (bot.health <= 0) killed.push(bot)
  }
  if (killed.length > 0) {
    const gone = new Set(killed.map((bot) => bot.id))
    world.bots = world.bots.filter((bot) => !gone.has(bot.id))
    for (const bot of killed) {
      world.deathsByCause.meteor += 1
      pushEvent(world, tuning, { tick: world.tick, type: 'death', botId: bot.id, cause: 'meteor', x: bot.x, y: bot.y })
    }
    for (const bot of killed) leaveRuin(world, bot, rules)
  }
  return craterId
}

/** Removes the events and craters whose time is up (end of tick `endTick` / `expires`), and logs each. */
export function expireEvents(world: World, tuning: Tuning): void {
  if (world.events.length > 0 && world.events.some((event) => event.endTick <= world.tick)) {
    for (const event of world.events) {
      if (event.endTick > world.tick) continue
      pushEvent(world, tuning, { tick: world.tick, type: 'event', eventKind: event.kind, x: event.x, y: event.y })
    }
    world.events = world.events.filter((event) => event.endTick > world.tick)
  }
  if (world.nodes.some((node) => node.expires > 0 && node.expires <= world.tick)) {
    const faded: SimEvent[] = []
    for (const node of world.nodes) {
      if (node.expires > 0 && node.expires <= world.tick) {
        faded.push({ tick: world.tick, type: 'event', eventKind: 'meteor', nodeId: node.id, x: node.x, y: node.y })
      }
    }
    world.nodes = world.nodes.filter((node) => node.expires === 0 || node.expires > world.tick)
    for (const event of faded) pushEvent(world, tuning, event)
  }
}

/** One line of the "active events" list: a timed event or a standing crater. */
export type ActiveEntry = {
  kind: EventKind
  startTick: number
  endTick: number
  x: number
  y: number
  /** 0 for a global event. */
  radius: number
  /** Regrowth multiplier (drought, bounty) or health damage per tick (plague, crater). */
  magnitude: number
  /** The crater's node id, for a meteor. */
  nodeId?: number
}

/** Everything in progress, soonest to end first (ties keep the order they started in). */
export function activeEntries(world: World, tuning: Tuning): ActiveEntry[] {
  const entries: ActiveEntry[] = world.events.map((event) => ({ ...event }))
  for (const node of world.nodes) {
    if (node.expires === 0) continue
    entries.push({
      kind: 'meteor',
      startTick: node.expires - tuning.events.meteor.craterTicks,
      endTick: node.expires,
      x: node.x,
      y: node.y,
      radius: node.radius,
      magnitude: node.damage,
      nodeId: node.id,
    })
  }
  return entries.sort((a, b) => a.endTick - b.endTick)
}
