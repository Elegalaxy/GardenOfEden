// The headline numbers, as KPI tiles (value large, label small, detail muted).
// Population shows its change over the last "minute" with an arrow and a sign.
// A minute is `tuning.stats.minuteTicks` ticks (600, which is one minute of
// real time at 1x speed); births and deaths per minute are measured over the
// same window, or over the whole run while it is younger than that.

import { tuning } from '../content/index.ts'
import { ratePer, windowChange } from '../sim/stats.ts'
import { takeSample } from '../sim/world.ts'
import { useWorldStore } from './store.ts'

const numberFormat = new Intl.NumberFormat('en-US')
const rateFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd className="figure">{value}</dd>
      <p className="tile-detail figure">{detail ?? ' '}</p>
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
  const rate = (value: number | null): string => (value === null ? '—' : rateFormat.format(value))
  return (
    <section className="panel" aria-label="Society">
      <dl className="tiles">
        <Tile label="Tick" value={numberFormat.format(tick)} detail={`1 min = ${numberFormat.format(minuteTicks)} ticks`} />
        <Tile
          label="Population"
          value={numberFormat.format(current.pop)}
          detail={change.span === 0 ? 'just started' : `${changeText(change.delta)} in ${numberFormat.format(change.span)} ticks`}
        />
        <Tile label="Births / min" value={rate(birthRate)} detail={`${numberFormat.format(births)} total`} />
        <Tile label="Deaths / min" value={rate(deathRate)} detail={`${numberFormat.format(deaths)} total`} />
        <Tile label="Food" value={numberFormat.format(Math.round(current.food))} detail="resource units" />
      </dl>
    </section>
  )
}
