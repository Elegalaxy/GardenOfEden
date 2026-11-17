// The headline numbers, as KPI tiles (value large, label small, detail muted).
// Population shows its change over the last "minute" with an arrow and a sign.
// A minute is `tuning.stats.minuteTicks` ticks (600, which is one minute of
// real time at 1x speed); births and deaths per minute are measured over the
// same window, or over the whole run while it is younger than that. The Food
// tile counts resource food (what the chart plots); food in ruins is shown
// beside it, not added in. The Season tile (S3) shows the name, the regrowth
// multiplier and the ticks to the next season (`seasonInfo.ts`); "Off" when disabled. The Predators tile (E3) shows how many
// predators are alive, their change over the same minute and the cap; its hover text says how many are hungry and where they came from.

import { tuning } from '../content/index.ts'
import { ratePer, windowChange } from '../sim/stats.ts'
import { takeSample, totalRuinFood } from '../sim/world.ts'
import { predatorChange, predatorCounts } from './predatorInfo.ts'
import { seasonSummary } from './seasonInfo.ts'
import { useWorldStore } from './store.ts'

const numberFormat = new Intl.NumberFormat('en-US')
const rateFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function Tile({ label, value, detail, hint }: { label: string; value: string; detail?: string; hint?: string }) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd className="figure">{value}</dd>
      <p className="tile-detail figure" title={hint ?? detail}>
        {detail ?? ' '}
      </p>
    </div>
  )
}

function changeText(delta: number): string {
  if (delta > 0) return `▲ +${numberFormat.format(delta)}`
  if (delta < 0) return `▼ −${numberFormat.format(-delta)}`
  return '= 0'
}

export function StatsStrip() {
  const { world, tick, births, deaths } = useWorldStore()
  const { minuteTicks, sampleEvery } = tuning.stats
  const current = takeSample(world)
  const change = windowChange(world.samples, current, 'pop', minuteTicks)
  const birthRate = ratePer(world.samples, current, 'births', minuteTicks, minuteTicks, sampleEvery)
  const deathRate = ratePer(world.samples, current, 'deaths', minuteTicks, minuteTicks, sampleEvery)
  const season = seasonSummary(tick, tuning)
  const predators = predatorCounts(world.nodes, tuning)
  const predatorDelta = predatorChange(world.samples, current, minuteTicks)
  const cap = `cap ${tuning.predator.maxCount}`
  const { byOrigin } = predators
  const origins = [
    byOrigin.founder > 0 ? `${byOrigin.founder} founder${byOrigin.founder === 1 ? '' : 's'}` : '',
    byOrigin.cub > 0 ? `${byOrigin.cub} cub${byOrigin.cub === 1 ? '' : 's'}` : '',
    byOrigin.placed > 0 ? `${byOrigin.placed} placed` : '',
    byOrigin.arrived > 0 ? `${byOrigin.arrived} arrived` : '',
  ].filter((part) => part !== '')
  const rate = (value: number | null): string => (value === null ? '—' : rateFormat.format(value))
  return (
    <section className="panel stats-panel" aria-label="Society">
      <dl className="tiles">
        <Tile label="Tick" value={numberFormat.format(tick)} detail={`1 min = ${numberFormat.format(minuteTicks)} ticks`} />
        <Tile
          label="Population"
          value={numberFormat.format(current.pop)}
          detail={change.span === 0 ? 'just started' : `${changeText(change.delta)} in ${numberFormat.format(change.span)} ticks`}
        />
        <Tile label="Births / min" value={rate(birthRate)} detail={`${numberFormat.format(births)} total`} />
        <Tile label="Deaths / min" value={rate(deathRate)} detail={`${numberFormat.format(deaths)} total`} />
        <Tile
          label="Food"
          value={numberFormat.format(Math.round(current.food))}
          detail={`+${numberFormat.format(Math.round(totalRuinFood(world)))} in ruins`}
        />
        <Tile
          label="Season"
          value={season.value}
          detail={season.detail}
          hint={season.enabled ? `Food regrowth multiplier, then ticks to the next season (${season.detail})` : 'Seasons are off'}
        />
        <Tile
          label="Predators"
          value={numberFormat.format(predators.total)}
          detail={predatorDelta === null ? cap : `${changeText(predatorDelta.delta)} · ${cap}`}
          hint={`${predators.hungry} hungry${origins.length === 0 ? '' : `, ${origins.join(', ')}`} (${cap})`}
        />
      </dl>
    </section>
  )
}
