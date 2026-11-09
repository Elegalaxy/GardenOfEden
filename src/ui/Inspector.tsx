// Details of the selected bot or node, as key-value rows. Reads the live
// world on every publish, so a running bot's numbers move. If the selection
// has died or been removed the panel says so (and, for a death, how) instead
// of going blank.

import type { ReactNode } from 'react'
import { tuning } from '../content/index.ts'
import { ruinDecayRate } from '../sim/ruins.ts'
import { TRAIT_NAMES, meanTraits } from '../sim/traits.ts'
import type { TraitName, WorldNode } from '../sim/types.ts'
import { findBot, findNode } from './geometry.ts'
import { INTENT_LABEL, KIND_LABEL, TRAIT_HELP, TRAIT_LABEL, causeSentence, formatPoint, formatTrait } from './labels.ts'
import { select, useWorldStore } from './store.ts'
import { toolInfo } from './tools.ts'
import type { ViewBot } from './protocol.ts'
import type { Selection } from './tools.ts'
import type { ViewWorld } from './viewWorld.ts'
import { TREND_GLYPH, signedDelta, trendOf } from './traitMath.ts'

const fixed1 = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
const fixed2 = (value: number): string => (Math.round(value * 100) / 100).toFixed(2)
const capital = (text: string): string => `${text[0]!.toUpperCase()}${text.slice(1)}`

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd className="figure">{children}</dd>
    </div>
  )
}

/** A bar with its number beside it. The number and the "low" flag carry the meaning; the fill is decoration. */
function Meter({ label, value, max, low }: { label: string; value: number; max: number; low: boolean }) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd className="figure meter-cell">
        <span
          className="meter"
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.round(value)}
        >
          <span className="meter-fill" style={{ width: `${fraction * 100}%` }} />
        </span>
        <span className="meter-value">
          {Math.round(value)} / {max}
        </span>
        <span className="meter-flag">{low ? '▼ low' : ''}</span>
      </dd>
    </div>
  )
}

/** A trait row: the bot's value, and how far it is from the average of the living population (the bot itself included). */
function TraitRow({ name, bot, mean }: { name: TraitName; bot: ViewBot; mean: number }) {
  const delta = bot.traits[name] - mean
  const trend = trendOf(name, delta)
  return (
    <div className="kv-row" title={TRAIT_HELP[name]}>
      <dt>{TRAIT_LABEL[name]}</dt>
      <dd className="figure">
        {formatTrait(name, bot.traits[name])}{' '}
        <span className={`trait-diff trait-${trend}`}>
          <span aria-hidden="true">{TREND_GLYPH[trend]}</span>{' '}
          {trend === 'flat' ? 'average' : `${signedDelta(name, delta)} vs avg`}
        </span>
      </dd>
    </div>
  )
}

function botsInside(world: Pick<ViewWorld, 'bots'>, node: WorldNode): number {
  let count = 0
  for (const bot of world.bots) {
    if (Math.hypot(bot.x - node.x, bot.y - node.y) <= node.radius) count += 1
  }
  return count
}

/** Ticks until a ruin has decayed away if nobody eats it. */
function ruinTimeLeft(node: WorldNode, rate: number): string {
  if (rate <= 0) return 'does not decay'
  return `about ${Math.ceil(node.amount / rate).toLocaleString('en-US')} ticks`
}

function SelectButton({ target, children }: { target: Selection; children: ReactNode }) {
  return (
    <button type="button" className="link-button" onClick={() => select(target)}>
      {children}
    </button>
  )
}

/** Most children named as links in the inspector; the rest are counted. */
const MAX_CHILD_LINKS = 4

function BotDetails({ bot, world }: { bot: ViewBot; world: ViewWorld }) {
  const { intent } = bot
  const target = intent.targetId === null ? undefined : findNode(world, intent.targetId)
  const parent = bot.parentId === null ? undefined : findBot(world, bot.parentId)
  const adult = bot.age >= tuning.bot.adultAge
  const children = world.bots.filter((other) => other.parentId === bot.id)
  // The bot is alive, so the population is never empty here.
  const mean = meanTraits(world.bots) ?? bot.traits
  return (
    <>
      <h3>Bot #{bot.id}</h3>
      <dl className="kv">
        <Meter label="Energy" value={bot.energy} max={tuning.bot.maxEnergy} low={bot.energy < 0.2 * tuning.bot.maxEnergy} />
        <Meter label="Thirst" value={bot.thirst} max={tuning.bot.maxThirst} low={bot.thirst < 0.2 * tuning.bot.maxThirst} />
        <Meter label="Health" value={bot.health} max={tuning.bot.maxHealth} low={bot.health < 0.3 * tuning.bot.maxHealth} />
        <Row label="Age">
          {bot.age} ticks · {adult ? 'adult' : 'child'}
        </Row>
        <Row label="Generation">{bot.generation}</Row>
        <Row label="Goal">{INTENT_LABEL[intent.kind]}</Row>
        <Row label="Target">
          {intent.targetId === null ? (
            'none'
          ) : target === undefined ? (
            <>#{intent.targetId} (gone)</>
          ) : (
            <SelectButton target={{ kind: 'node', id: target.id }}>
              {KIND_LABEL[target.kind]} #{target.id}
            </SelectButton>
          )}
        </Row>
        <Row label="Position">{formatPoint(bot.x, bot.y)}</Row>
        <Row label="Repro cooldown">{Math.max(0, Math.ceil(bot.cooldown))} ticks</Row>
        <Row label="Memory">
          {bot.memoryCount} / {tuning.memory.cap + tuning.memory.waterCap} nodes · {bot.learnedCount} from family
        </Row>
      </dl>
      <h4>Family</h4>
      <dl className="kv">
        <Row label="Parent">
          {bot.parentId === null ? (
            'none (founder)'
          ) : parent === undefined ? (
            <>#{bot.parentId} · gone</>
          ) : (
            <>
              <SelectButton target={{ kind: 'bot', id: parent.id }}>#{parent.id}</SelectButton> · alive
            </>
          )}
        </Row>
        <Row label="Children">
          {children.length === 0 ? (
            'none alive'
          ) : (
            <>
              {children.length} alive{' '}
              {children.slice(0, MAX_CHILD_LINKS).map((child) => (
                <span key={child.id}>
                  <SelectButton target={{ kind: 'bot', id: child.id }}>#{child.id}</SelectButton>{' '}
                </span>
              ))}
              {children.length > MAX_CHILD_LINKS ? `+${children.length - MAX_CHILD_LINKS} more` : ''}
            </>
          )}
        </Row>
      </dl>
      <h4>Traits</h4>
      <dl className="kv">
        {TRAIT_NAMES.map((name) => (
          <TraitRow key={name} name={name} bot={bot} mean={mean[name]} />
        ))}
      </dl>
    </>
  )
}

function NodeDetails({ node, world }: { node: WorldNode; world: ViewWorld }) {
  const crater = node.expires > 0
  return (
    <>
      <h3>
        {crater ? 'Meteor crater' : capital(KIND_LABEL[node.kind])} #{node.id}
      </h3>
      <dl className="kv">
        <Row label="Kind">{crater ? 'danger (meteor crater)' : KIND_LABEL[node.kind]}</Row>
        <Row label="Position">{formatPoint(node.x, node.y)}</Row>
        <Row label="Radius">{fixed1(node.radius)} cells</Row>
        {node.kind === 'resource' && (
          <>
            <Meter label="Amount" value={node.amount} max={node.capacity} low={node.amount <= 0} />
            <Row label="Regrowth">+{fixed2(node.regen)} / tick</Row>
          </>
        )}
        {node.kind === 'ruin' && (
          <>
            <Meter label="Amount" value={node.amount} max={node.capacity} low={false} />
            <Row label="Decay">
              &minus;{fixed2(ruinDecayRate(world, node, tuning))} / tick
              {ruinDecayRate(world, node, tuning) > node.decay ? ' (in danger)' : ''}
            </Row>
            <Row label="Time left">{ruinTimeLeft(node, ruinDecayRate(world, node, tuning))}</Row>
          </>
        )}
        {node.kind === 'water' && (
          <>
            <Row label="Drink rate">+{fixed1(tuning.bot.drinkRate)} thirst / tick</Row>
            <Row label="Supply">never runs dry</Row>
          </>
        )}
        {node.kind === 'danger' && <Row label="Damage">{fixed1(node.damage)} health / tick</Row>}
        {crater && <Row label="Time left">{Math.max(0, node.expires - world.tick).toLocaleString('en-US')} ticks</Row>}
        {node.kind === 'shelter' && (
          <>
            <Row label="Heal">+{fixed1(node.heal)} health / tick</Row>
            <Row label="Energy loss">&times;{fixed2(node.drainMult)}</Row>
          </>
        )}
        <Row label="Bots inside">{botsInside(world, node)}</Row>
      </dl>
    </>
  )
}

function GoneNotice({ selection, world }: { selection: Selection; world: ViewWorld }) {
  // The newest event about this thing tells the player what happened to it.
  let detail = ''
  for (let i = world.log.length - 1; i >= 0; i -= 1) {
    const event = world.log[i]!
    if (selection.kind === 'bot' && event.type === 'death' && event.botId === selection.id) {
      detail = `${causeSentence(event.cause)} at tick ${event.tick}, at ${formatPoint(event.x, event.y)}.`
      break
    }
    if (selection.kind === 'node' && event.command === 'removeNode' && event.nodeId === selection.id) {
      detail = `Removed at tick ${event.tick}.`
      break
    }
    if (selection.kind === 'node' && event.type === 'event' && event.nodeId === selection.id) {
      detail = `Faded away at tick ${event.tick}.`
      break
    }
  }
  return (
    <>
      <h3>
        {selection.kind === 'bot' ? 'Bot' : 'Node'} #{selection.id}
      </h3>
      <p className="gone" role="status">
        <span aria-hidden="true">✕</span> Gone. {detail || 'It is no longer in the world.'}
      </p>
      <button type="button" className="secondary" onClick={() => select(null)}>
        Clear selection
      </button>
    </>
  )
}

export function Inspector() {
  const { world, selection } = useWorldStore()
  let body: ReactNode
  if (selection === null) {
    body = (
      <p className="empty">
        Nothing selected. Pick <strong>Inspect ({toolInfo('inspect').key})</strong> and click a bot or node on the map, or pick an entry in the event
        log.
      </p>
    )
  } else if (selection.kind === 'bot') {
    const bot = findBot(world, selection.id)
    body = bot === undefined ? <GoneNotice selection={selection} world={world} /> : <BotDetails bot={bot} world={world} />
  } else {
    const node = findNode(world, selection.id)
    body = node === undefined ? <GoneNotice selection={selection} world={world} /> : <NodeDetails node={node} world={world} />
  }
  return (
    <section className="panel inspector" aria-label="Inspector">
      <h2>Inspector</h2>
      {body}
    </section>
  )
}
