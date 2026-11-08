import { useEffect } from 'react'
import { Readout } from './Readout.tsx'
import { SpeedControls } from './SpeedControls.tsx'
import { WorldCanvas } from './WorldCanvas.tsx'
import { startLoop } from './loop.ts'
import './styles.css'

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

export default function App() {
  useEffect(() => startLoop(), [])
  return (
    <main className="app">
      <div className="layout">
        <h1>Garden of Eden</h1>
        <Readout />
        <SpeedControls />
        <section className="panel map-panel">
          <WorldCanvas />
          <Legend />
        </section>
      </div>
    </main>
  )
}
