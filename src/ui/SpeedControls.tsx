// Pause, single step and speed. Speed is a multiple of the base 10 ticks per
// second; the current rate is shown beside the buttons in tabular figures.

import { ticksPerSecond } from './loop.ts'
import { SPEEDS, setPaused, setSpeed, stepOnce, useWorldStore } from './store.ts'

export function SpeedControls() {
  const { paused, speed } = useWorldStore()
  return (
    <section className="panel controls" aria-label="Simulation speed">
      <div className="control-row">
        <button
          type="button"
          className="primary play-button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span> {paused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={stepOnce}
          disabled={!paused}
          title={paused ? 'Advance one tick' : 'Pause to step one tick at a time'}
        >
          <span aria-hidden="true">{'⏭'}</span> Step
        </button>
        <div className="speed-group" role="group" aria-label="Speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className="secondary speed-button"
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
            >
              {value}&times;
            </button>
          ))}
        </div>
        <p className="rate" aria-live="off">
          <span className="rate-label">Rate</span>
          <span className="figure">{paused ? 0 : ticksPerSecond(speed)}</span>
          <span className="rate-unit">ticks/s</span>
        </p>
      </div>
    </section>
  )
}
