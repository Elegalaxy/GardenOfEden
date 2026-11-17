// Details of the selected bot or node, as key-value rows. Reads the live
// world on every publish, so a running bot's numbers move. If the selection
// has died or been removed the panel says so (and, for a death, how) instead
// of going blank.

import type { ReactNode } from 'react'
import { tuning } from '../content/index.ts'
import { ruinDecayRate } from '../sim/ruins.ts'
import { TRAIT_NAMES, meanTraits } from '../sim/traits.ts'
import type { TraitName, WorldNode } from '../sim/types.ts'
import { revealFamily } from './familyFocus.ts'
import { findBot, findNode } from './geometry.ts'
import { denFor, originText, predatorCounts, predatorLifeInfo } from './predatorInfo.ts'
import type { PredatorLifeInfo } from './predatorInfo.ts'
import { FERTILITY_PHASE_LABEL, KIND_LABEL, TRAIT_HELP, TRAIT_LABEL, causeSentence, fertilityLabel, formatPoint, formatTrait, hueLabel, inbreedingLabel, intentLabel, memoryCapacity, predatorActivity, SIGHT_HELP, sightText } from './labels.ts'
import { select, useWorldStore } from './store.ts'
import { toolInfo } from './tools.ts'
import type { ViewBot } from './protocol.ts'
import type { Selection } from './tools.ts'
import type { ViewWorld } from './viewWorld.ts'
import { HueSwatch } from './HueSwatch.tsx'
import { TREND_GLYPH, signedDelta, trendOf } from './traitMath.ts'

const cone = tuning.perception.cone
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
  const mateTarget = intent.kind === 'seekMate' && intent.targetId !== null ? findBot(world, intent.targetId) : undefined
  const target = intent.targetId === null || intent.kind === 'seekMate' ? undefined : findNode(world, intent.targetId)
  const mother = bot.parentId === null ? undefined : findBot(world, bot.parentId)
  const father = bot.fatherId === null ? undefined : findBot(world, bot.fatherId)
  const lifeScale = bot.traits.longevity
  const stage =
    bot.age < tuning.bot.adultAge * lifeScale ? 'child' : bot.age >= tuning.fertility.fertileUntil * lifeScale ? 'elder' : 'adult'
  const fertility = fertilityLabel(bot.age, tuning, lifeScale)
  const children = world.bots.filter((other) => other.parentId === bot.id || other.fatherId === bot.id)
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
          {bot.age} ticks · {stage}
        </Row>
        <Row label="Lifespan">{bot.lifespan} ticks</Row>
        <Row label="Inbred">{inbreedingLabel(bot.inbreeding)}</Row>
        <Row label="Bloodline">
          <HueSwatch hue={bot.hue} /> {hueLabel(bot.hue)}
        </Row>
        <Row label="Sex">{bot.sex === 'female' ? 'Female' : 'Male'}</Row>
        <Row label="Generation">{bot.generation}</Row>
        <Row label="Goal">{intentLabel(intent.kind, target)}</Row>
        <Row label="Target">
          {intent.targetId === null ? (
            'none'
          ) : mateTarget !== undefined ? (
            <SelectButton target={{ kind: 'bot', id: mateTarget.id }}>female #{mateTarget.id}</SelectButton>
          ) : target === undefined ? (
            <>#{intent.targetId} (gone)</>
          ) : (
            <SelectButton target={{ kind: 'node', id: target.id }}>
              {KIND_LABEL[target.kind]} #{target.id}
            </SelectButton>
          )}
        </Row>
        <Row label="Position">{formatPoint(bot.x, bot.y)}</Row>
        <Row label="Fertility">
          {fertility.percent}% · {FERTILITY_PHASE_LABEL[fertility.phase]}
        </Row>
        <Row label="Ready to breed in">{Math.max(0, Math.ceil(bot.cooldown))} ticks</Row>
        <Row label="Memory">
          {bot.memoryCount} / {memoryCapacity(tuning.memory)} nodes · {bot.learnedCount} from family
        </Row>
      </dl>
      <h4>Family</h4>
      <dl className="kv">
        <Row label="Mother">
          {bot.parentId === null ? (
            'none (founder)'
          ) : mother === undefined ? (
            <>#{bot.parentId} · gone</>
          ) : (
            <>
              <SelectButton target={{ kind: 'bot', id: mother.id }}>#{mother.id}</SelectButton> · alive
            </>
          )}
        </Row>
        <Row label="Father">
          {bot.fatherId === null ? (
            'none (founder)'
          ) : father === undefined ? (
            <>#{bot.fatherId} · gone</>
          ) : (
            <>
              <SelectButton target={{ kind: 'bot', id: father.id }}>#{father.id}</SelectButton> · alive
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
      <button type="button" className="secondary show-family" onClick={() => revealFamily(bot.id)}>
        Show family tree
      </button>
      <h4>Traits</h4>
      <dl className="kv">
        {TRAIT_NAMES.map((name) => (
          <TraitRow key={name} name={name} bot={bot} mean={mean[name]} />
        ))}
        <div className="kv-row" title={SIGHT_HELP}>
          <dt>Sight</dt>
          <dd className="figure">{sightText(bot.traits.senseRadius, cone.botFront, cone.botRear, cone.enabled)}</dd>
        </div>
      </dl>
    </>
  )
}

/** A predator's extra rows (M21c): what it is doing, its record and the numbers that make it dangerous. */
function PredatorRows({ node, world }: { node: WorldNode; world: ViewWorld }) {
  const hunt = node.hunt
  const life = hunt === null ? null : predatorLifeInfo(hunt, tuning, predatorCounts(world.nodes, tuning).total)
  const activity = predatorActivity(hunt, world.tick, life !== null && !life.hungry)
  const prey = activity.kind === 'hunting' ? findBot(world, activity.targetId) : undefined
  return (
    <>
      <Row label="State">
        {activity.kind === 'hunting' ? (
          prey === undefined ? (
            <>Hunting bot #{activity.targetId}</>
          ) : (
            <>
              Hunting <SelectButton target={{ kind: 'bot', id: prey.id }}>bot #{prey.id}</SelectButton>
            </>
          )
        ) : activity.kind === 'resting' ? (
          <>Resting {activity.ticksLeft.toLocaleString('en-US')} ticks</>
        ) : activity.kind === 'sated' ? (
          'Fed, walking home (does not bite)'
        ) : (
          'Prowling'
        )}
      </Row>
      <Row label="Kills">{hunt === null ? 0 : hunt.kills.toLocaleString('en-US')}</Row>
      {hunt !== null && (
        <Row label="Home">
          {formatPoint(hunt.homeX, hunt.homeY)}
          {life !== null && ` · ${world.ecology !== undefined && denFor(world.ecology.dens, hunt, tuning.predator.ecology.denRadius) !== null ? 'den' : 'no den (cubs make none)'}`}
        </Row>
      )}
      <div className="kv-row" title={SIGHT_HELP}>
        <dt>Sight</dt>
        <dd className="figure">{sightText(tuning.predator.senseRadius, cone.predatorFront, cone.predatorRear, cone.enabled)}</dd>
      </div>
      <Row label="Threat radius">{fixed1(node.radius)} cells</Row>
      <Row label="Bite range">{fixed1(tuning.predator.biteRange)} cells</Row>
      <Row label="Damage">{fixed1(node.damage)} health / tick</Row>
      <Row label="Speed">{fixed2(tuning.predator.speed)} cells / tick</Row>
    </>
  )
}

/** Why the next cub has to wait, in a few words (the kills case shows the kill count itself). */
const CUB_BLOCK_TEXT = {
  age: 'too young',
  energy: 'needs more energy',
  cap: 'predator cap reached',
} as const

/** The ecology rows of a predator (E3), under the main rows: energy, hunger, age, the next cub, where it came from and its den. */
function PredatorLifeSection({ hunt, life, world }: { hunt: NonNullable<WorldNode['hunt']>; life: PredatorLifeInfo; world: ViewWorld }) {
  const { ecology } = tuning.predator
  const origin = originText(hunt.life!)
  const parent = origin.parentId === null ? undefined : findNode(world, origin.parentId)
  const ticks = (value: number): string => `${value.toLocaleString('en-US')} ticks`
  return (
    <>
      <h4>Life</h4>
      <dl className="kv">
        <Meter label="Energy" value={life.energy} max={life.maxEnergy} low={life.hungry} />
        <Row label="Hunger">
          {life.hungry
            ? `Hungry (hunts below ${life.huntBelow})`
            : life.ticksToHungry === null
              ? 'Fed'
              : `Fed, hungry again in ${ticks(life.ticksToHungry)}`}
        </Row>
        <Row label="Starves in">{life.ticksToStarve === null ? 'does not starve' : ticks(life.ticksToStarve)}</Row>
        <Row label="Age">
          {life.age.toLocaleString('en-US')} / {life.maxAge.toLocaleString('en-US')} ticks
          {life.adult ? '' : ` · young, breeds from ${ecology.adultAge.toLocaleString('en-US')}`}
        </Row>
        <Row label="Next cub">
          {life.cubBlock === null
            ? 'ready, looking for territory'
            : life.cubBlock === 'kills'
              ? `${life.kidsKills} / ${life.killsPerCub} kills`
              : `${life.kidsKills} / ${life.killsPerCub} kills · ${CUB_BLOCK_TEXT[life.cubBlock]}`}
        </Row>
        <Row label="Origin">
          {origin.parentId === null ? (
            origin.text
          ) : parent === undefined ? (
            <>
              {origin.text} · #{origin.parentId} gone
            </>
          ) : (
            <>
              Cub of <SelectButton target={{ kind: 'node', id: parent.id }}>#{parent.id}</SelectButton>, born tick {hunt.life!.born.toLocaleString('en-US')}
            </>
          )}
        </Row>
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
        <Row label="Kind">{crater ? 'meteor crater' : KIND_LABEL[node.kind]}</Row>
        <Row label="Position">{formatPoint(node.x, node.y)}</Row>
        {node.kind !== 'predator' && <Row label="Radius">{fixed1(node.radius)} cells</Row>}
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
        {node.kind === 'predator' && <PredatorRows node={node} world={world} />}
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
      {node.kind === 'predator' && node.hunt !== null && node.hunt.life !== undefined && (
        <PredatorLifeSection hunt={node.hunt} life={predatorLifeInfo(node.hunt, tuning, predatorCounts(world.nodes, tuning).total)!} world={world} />
      )}
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
    if (selection.kind === 'node' && event.type === 'predator' && event.nodeId === selection.id && (event.predatorEvent === 'starved' || event.predatorEvent === 'aged' || event.predatorEvent === 'left')) {
      const verb = { starved: 'Starved', aged: 'Died of age', left: 'Left the map (too few bots)' }[event.predatorEvent]
      detail = `${verb} at tick ${event.tick}, at ${formatPoint(event.x, event.y)}.`
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
      <div className="gone-actions">
        {selection.kind === 'bot' && (
          <button type="button" className="secondary" onClick={() => revealFamily(selection.id)}>
            Show family tree
          </button>
        )}
        <button type="button" className="secondary" onClick={() => select(null)}>
          Clear selection
        </button>
      </div>
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
