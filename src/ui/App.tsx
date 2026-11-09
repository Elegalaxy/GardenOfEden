import { useEffect } from 'react'
import { DeathCauses } from './DeathCauses.tsx'
import { EventLog } from './EventLog.tsx'
import { EventsPanel } from './EventsPanel.tsx'
import { Inspector } from './Inspector.tsx'
import { PopulationChart } from './PopulationChart.tsx'
import { RunMenu } from './RunMenu.tsx'
import { SpeedControls } from './SpeedControls.tsx'
import { StatsStrip } from './StatsStrip.tsx'
import { ToolStatus, Toolbar } from './Toolbar.tsx'
import { TraitChart } from './TraitChart.tsx'
import { TraitSummary } from './TraitSummary.tsx'
import { WorldCanvas } from './WorldCanvas.tsx'
import { startAutosave } from './autosave.ts'
import { startLoop } from './loop.ts'
import { watchShareLinks } from './shareLink.ts'
import { useWorldStore } from './store.ts'
import { toolInfo } from './tools.ts'
import './styles.css'
import './panels.css'

function Legend() {
  return (
    <ul className="panel legend" aria-label="Map key">
      <li>
        <span className="key key-resource" aria-hidden="true">R</span> Resource
        <span className="legend-note">ring shows what is left</span>
      </li>
      <li>
        <span className="key key-water" aria-hidden="true"><span>W</span></span> Water
        <span className="legend-note">droplet, bots drink, never runs dry</span>
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
        <span className="key key-ruin" aria-hidden="true"><span>U</span></span> Ruin
        <span className="legend-note">diamond, left by a dead bot, decays</span>
      </li>
      <li>
        <span className="key key-event key-plague" aria-hidden="true">P</span> Plague
        <span className="legend-note">hatched disc, bots inside lose health</span>
      </li>
      <li>
        <span className="key key-event key-meteor" aria-hidden="true">M</span> Meteor crater
        <span className="legend-note">dashed orange danger, fades</span>
      </li>
      <li>
        <span className="key key-bot" aria-hidden="true" /> Bot
        <span className="legend-note">small = child, ringed = fleeing</span>
      </li>
    </ul>
  )
}

/** A note over the bottom edge of the map when nobody is alive: at the very start, or after everyone died. */
function EmptyWorld() {
  const { population, births, deaths, tick } = useWorldStore()
  if (population > 0) return null
  const addBot = toolInfo('bot')
  const fresh = births === 0 && deaths === 0
  return (
    <p className="empty map-note" role="status">
      {fresh ? (
        <>
          No bots yet. Pick <strong>{addBot.label} ({addBot.key})</strong> and click the map.
        </>
      ) : (
        <>
          Everyone is gone (tick {tick}). Pick <strong>{addBot.label} ({addBot.key})</strong>, click the map, or start a new world.
        </>
      )}
    </p>
  )
}

export default function App() {
  useEffect(() => startLoop(), [])
  useEffect(() => watchShareLinks(), [])
  useEffect(() => startAutosave(), [])
  return (
    <main className="app">
      <div className="layout">
        <header className="app-header">
          <h1>Garden of Eden</h1>
          <RunMenu />
        </header>
        <div className="workspace">
          <div className="area-stats">
            <StatsStrip />
          </div>
          <div className="area-speed">
            <SpeedControls />
          </div>
          <div className="area-tools">
            <Toolbar />
          </div>
          <section className="area-map" aria-label="Map">
            <WorldCanvas>
              <EmptyWorld />
            </WorldCanvas>
          </section>
          <div className="area-status">
            <ToolStatus />
          </div>
          <div className="area-legend">
            <Legend />
          </div>
          <div className="area-events">
            <EventsPanel />
          </div>
          <div className="area-chart">
            <PopulationChart />
            <TraitChart />
            <TraitSummary />
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
