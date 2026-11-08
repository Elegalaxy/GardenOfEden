import { useEffect } from 'react'
import { DeathCauses } from './DeathCauses.tsx'
import { EventLog } from './EventLog.tsx'
import { Inspector } from './Inspector.tsx'
import { PopulationChart } from './PopulationChart.tsx'
import { RunPanel } from './RunPanel.tsx'
import { SpeedControls } from './SpeedControls.tsx'
import { StatsStrip } from './StatsStrip.tsx'
import { Toolbar } from './Toolbar.tsx'
import { WorldCanvas } from './WorldCanvas.tsx'
import { startLoop } from './loop.ts'
import { useWorldStore } from './store.ts'
import './styles.css'
import './panels.css'

function Legend() {
  return (
    <ul className="legend" aria-label="Map key">
      <li>
        <span className="key key-resource" aria-hidden="true">R</span> Resource
        <span className="legend-note">ring shows what is left</span>
      </li>
      <li>
        <span className="key key-danger" aria-hidden="true">D</span> Danger
        <span className="legend-note">dashed edge</span>
      </li>
      <li>
        <span className="key key-shelter" aria-hidden="true">S</span> Shelter
        <span className="legend-note">heals, rests, reproduces</span>
      </li>
      <li>
        <span className="key key-bot" aria-hidden="true" /> Bot
        <span className="legend-note">small = child, ringed = fleeing</span>
      </li>
    </ul>
  )
}

/** Shown under the map when nobody is alive: at the very start, or after everyone died. */
function EmptyWorld() {
  const { population, births, deaths, tick } = useWorldStore()
  if (population > 0) return null
  const fresh = births === 0 && deaths === 0
  return (
    <p className="empty banner" role="status">
      {fresh ? (
        <>
          No bots yet. Pick <strong>Add bot (5)</strong> and click the map.
        </>
      ) : (
        <>
          Everyone is gone (tick {tick}). Pick <strong>Add bot (5)</strong> and click the map to start a new line, or start a
          new world above.
        </>
      )}
    </p>
  )
}

export default function App() {
  useEffect(() => startLoop(), [])
  return (
    <main className="app">
      <div className="layout">
        <header className="app-header">
          <h1>Garden of Eden</h1>
          <RunPanel />
        </header>
        <StatsStrip />
        <div className="workspace">
          <div className="area-speed">
            <SpeedControls />
          </div>
          <div className="area-tools">
            <Toolbar />
          </div>
          <section className="panel map-panel area-map">
            <WorldCanvas />
            <EmptyWorld />
            <Legend />
          </section>
          <div className="area-chart">
            <PopulationChart />
          </div>
          <div className="area-side">
            <div className="side-inspector">
              <Inspector />
            </div>
            <div className="side-deaths">
              <DeathCauses />
            </div>
            <div className="side-log">
              <EventLog />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
