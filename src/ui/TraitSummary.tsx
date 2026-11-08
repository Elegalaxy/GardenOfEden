// The traits of the bots alive right now: mean, min and max of each, as a
// right-aligned table, plus a small bar per trait. The bar spans the trait's
// allowed range; the filled part runs from the lowest to the highest value in
// the population and the notch marks the mean. The numbers carry the meaning;
// the bar is only a quick look at how spread out the population is. With nobody
// alive the rows stay and show dashes, so the layout does not jump.

import { tuning } from '../content/index.ts'
import { TRAIT_NAMES, traitStats } from '../sim/traits.ts'
import { TRAIT_HELP, TRAIT_LABEL } from './labels.ts'
import { useWorldStore } from './store.ts'
import { fractionOf, traitNumber } from './traitMath.ts'

export function TraitSummary() {
  const { world, population } = useWorldStore()
  const stats = traitStats(world.bots)
  return (
    <section className="panel trait-summary" aria-label="Population traits">
      <h2>
        Population traits <span className="trait-count figure">{population} alive</span>
      </h2>
      <table className="trait-table">
        <thead>
          <tr>
            <th scope="col">Trait</th>
            <th scope="col" className="num">
              Mean
            </th>
            <th scope="col" className="num">
              Min
            </th>
            <th scope="col" className="num">
              Max
            </th>
            <th scope="col" className="trait-bar-col">
              Spread
            </th>
          </tr>
        </thead>
        <tbody>
          {TRAIT_NAMES.map((name) => {
            const stat = stats?.[name]
            const { min, max } = tuning.mutation.bounds[name]
            const left = stat === undefined ? 0 : fractionOf(stat.min, min, max)
            const right = stat === undefined ? 0 : fractionOf(stat.max, min, max)
            const mean = stat === undefined ? 0 : fractionOf(stat.mean, min, max)
            return (
              <tr key={name} title={TRAIT_HELP[name]}>
                <th scope="row">{TRAIT_LABEL[name]}</th>
                <td className="num figure trait-mean">{stat === undefined ? '—' : traitNumber(name, stat.mean)}</td>
                <td className="num figure">{stat === undefined ? '—' : traitNumber(name, stat.min)}</td>
                <td className="num figure">{stat === undefined ? '—' : traitNumber(name, stat.max)}</td>
                <td className="trait-bar-col">
                  <span className="spread" aria-hidden="true">
                    {stat !== undefined && (
                      <>
                        <span
                          className="spread-fill"
                          style={{ left: `${left * 100}%`, width: `${Math.max(right - left, 0.02) * 100}%` }}
                        />
                        <span className="spread-mean" style={{ left: `${mean * 100}%` }} />
                      </>
                    )}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {stats === null ? (
        <p className="chart-note trait-note">Nobody is alive, so there is nothing to average.</p>
      ) : (
        <p className="chart-note trait-note">
          Bar: allowed range of each trait. Filled part = lowest to highest value alive, notch = mean.
        </p>
      )}
    </section>
  )
}
