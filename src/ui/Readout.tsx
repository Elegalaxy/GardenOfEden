// Numbers about the society, as a grid of tiles (value large, label small).
// Deaths are split by cause with a letter and a word, not colour.

import { useWorldStore } from './store.ts'

const numberFormat = new Intl.NumberFormat('en-US')

function Tile({ label, value, detail, wide }: { label: string; value: string; detail?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'tile tile-wide' : 'tile'}>
      <dt>{label}</dt>
      <dd className="figure">{value}</dd>
      <p className="tile-detail figure">{detail ?? ' '}</p>
    </div>
  )
}

export function Readout() {
  const s = useWorldStore()
  const { starve, danger, age } = s.deathsByCause
  return (
    <section className="panel" aria-label="Society">
      <dl className="tiles">
        <Tile label="Tick" value={numberFormat.format(s.tick)} />
        <Tile label="Bots" value={numberFormat.format(s.population)} />
        <Tile label="Births" value={numberFormat.format(s.births)} />
        <Tile
          label="Deaths"
          value={numberFormat.format(s.deaths)}
          detail={`Starved ${starve} · Danger ${danger} · Age ${age}`}
          wide
        />
        <Tile label="Food" value={numberFormat.format(Math.round(s.food))} detail="resource units" />
      </dl>
    </section>
  )
}
