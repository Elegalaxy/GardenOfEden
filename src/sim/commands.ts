// Player commands. `checkCommand` says whether a command would be accepted
// (the UI uses it to preview a placement); `applyCommand` checks it, changes
// the world, records `{ tick, cmd }` in `World.commands` and logs a `command`
// event. A rejected command changes nothing and is not recorded, so replaying
// the recorded list always reproduces the run.
//
// Ruins are made by the sim when a bot dies, so the player cannot place them
// (they can remove one). Ruins and meteor craters do not count toward `player.maxNodes`.
// `triggerEvent` starts a world event (drought, bounty, plague, meteor); the rules
// are in worldEvents.ts.
//
// A command is applied between two ticks: at world.tick = T, after step T and
// before step T+1. Placed nodes use the numbers for their kind from
// `rules.nodeDefs`. A placed bot gets the default traits, full health and a
// heading drawn from the `world` stream (never `ai`, so a placement does not
// shift the random draws bots make while wandering). It also gets a lineage record (no parent, born now).

import { addRecord } from './lineage.ts'
import { nextFloat } from './rng.ts'
import type { Command, Rules, World } from './types.ts'
import { makeBot, makeNode, placedNodeCount, pushEvent } from './world.ts'
import { checkEvent, startEvent } from './worldEvents.ts'
import type { CheckableWorld } from './worldEvents.ts'

export type CommandResult = { ok: true; id: number } | { ok: false; reason: string }

function insideMap(world: Pick<World, 'width' | 'height'>, x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= world.width && y <= world.height
}

/** null when the command would be accepted, otherwise a short reason a player can read. */
export function checkCommand(world: CheckableWorld, rules: Rules, cmd: Command): string | null {
  const { tuning } = rules
  switch (cmd.type) {
    case 'placeNode': {
      if (!insideMap(world, cmd.x, cmd.y)) return 'That spot is outside the map.'
      if (cmd.kind === 'ruin') return 'Ruins are left by dead bots. They cannot be placed.'
      if (placedNodeCount(world) >= tuning.player.maxNodes) {
        return `The map is full (${tuning.player.maxNodes} nodes).`
      }
      for (const node of world.nodes) {
        if (node.kind === cmd.kind && Math.hypot(node.x - cmd.x, node.y - cmd.y) < tuning.player.minNodeGap) {
          return `Too close to another ${cmd.kind} node.`
        }
      }
      return null
    }
    case 'removeNode':
      return world.nodes.some((node) => node.id === cmd.id) ? null : 'There is no such node.'
    case 'placeBot':
      if (!insideMap(world, cmd.x, cmd.y)) return 'That spot is outside the map.'
      if (world.bots.length >= tuning.population.cap) {
        return `The population cap (${tuning.population.cap}) is reached.`
      }
      return null
    case 'triggerEvent':
      return checkEvent(world, rules, cmd)
  }
}

export function applyCommand(world: World, rules: Rules, cmd: Command): CommandResult {
  const reason = checkCommand(world, rules, cmd)
  if (reason !== null) return { ok: false, reason }
  const { tuning } = rules
  let id: number
  switch (cmd.type) {
    case 'placeNode': {
      id = world.nextId
      world.nextId += 1
      world.nodes.push(makeNode(id, cmd.kind, cmd.x, cmd.y, rules.nodeDefs[cmd.kind]))
      pushEvent(world, tuning, {
        tick: world.tick,
        type: 'command',
        command: cmd.type,
        nodeKind: cmd.kind,
        nodeId: id,
        x: cmd.x,
        y: cmd.y,
      })
      break
    }
    case 'removeNode': {
      const index = world.nodes.findIndex((node) => node.id === cmd.id)
      const [removed] = world.nodes.splice(index, 1)
      id = cmd.id
      pushEvent(world, tuning, {
        tick: world.tick,
        type: 'command',
        command: cmd.type,
        nodeKind: removed?.kind,
        nodeId: id,
        x: removed?.x ?? 0,
        y: removed?.y ?? 0,
      })
      break
    }
    case 'placeBot': {
      id = world.nextId
      world.nextId += 1
      const heading = nextFloat(world.rng.world) * Math.PI * 2
      // New ids are the largest so far, so pushing keeps `bots` in ascending id order.
      const bot = makeBot(id, cmd.x, cmd.y, heading, rules)
      world.bots.push(bot)
      addRecord(world, id, null, bot.generation, bot.traits)
      pushEvent(world, tuning, {
        tick: world.tick,
        type: 'command',
        command: cmd.type,
        botId: id,
        x: cmd.x,
        y: cmd.y,
      })
      break
    }
    case 'triggerEvent':
      id = startEvent(world, rules, cmd)
      break
  }
  world.commands.push({ tick: world.tick, cmd: { ...cmd } })
  return { ok: true, id }
}
