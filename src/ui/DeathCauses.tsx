// Deaths by cause: a count and a small bar per cause. The label and the number
// carry the meaning; the bar only shows the share at a glance.

import type { DeathCause } from '../sim/types.ts'
import { CAUSE_LABEL } from './labels.ts'
import { useWorldStore } from './store.ts'

const CAUSES: readonly DeathCause[] = ['starve', 'thirst', 'danger', 'age']
const numberFormat = new Intl.NumberFormat('en-US')

export function DeathCauses() {
  const { deathsByCause, deaths } = useWorldStore()
  return (
    <section className="panel death-causes" aria-label="Deaths by cause">
      <h2>Deaths by cause</h2>
      <table className="cause-table">
        <thead>
          <tr>
            <th scope="col">Cause</th>
            <th scope="col" className="bar-col">
              Share
            </th>
            <th scope="col" className="num">
              Deaths
            </th>
            <th scope="col" className="num">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {CAUSES.map((cause) => {
            const count = deathsByCause[cause]
            const share = deaths > 0 ? count / deaths : 0
            return (
              <tr key={cause}>
                <th scope="row">{CAUSE_LABEL[cause]}</th>
                <td className="bar-col">
                  <span className="cause-bar" aria-hidden="true">
                    <span className={`cause-fill cause-${cause}`} style={{ width: `${share * 100}%` }} />
                  </span>
                </td>
                <td className="num figure">{numberFormat.format(count)}</td>
                <td className="num figure">{deaths > 0 ? `${Math.round(share * 100)}%` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {deaths === 0 && <p className="empty">No deaths yet.</p>}
    </section>
  )
}
