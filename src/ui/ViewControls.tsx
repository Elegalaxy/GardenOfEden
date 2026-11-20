// The camera controls (F1): zoom out, zoom in, Fit (the whole map) and Follow, floating over the top right corner of the map,
// and the keys that do the same (+ or = in, - out, 0 fit, F follow; ignored while typing in a field). Fit keeps its place
// but is hidden while the whole map is in view, so the row never changes size. The camera is a page setting (store.ts).

import { useEffect } from 'react'
import { MAX_ZOOM, followPosition, viewKeyAction } from './camera.ts'
import { fitCamera, toggleFollow, useCamera, useWorldStore, zoomStep } from './store.ts'
import { isTypingTarget } from './typing.ts'

export function ViewControls() {
  const camera = useCamera()
  const { world, selection, alpha } = useWorldStore()
  const followable = followPosition(world, selection, alpha) !== null
  const zoomed = camera.zoom > 1

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return
      const action = viewKeyAction(event)
      if (action === null) return
      event.preventDefault()
      if (action === 'in') zoomStep(1)
      else if (action === 'out') zoomStep(-1)
      else if (action === 'fit') fitCamera()
      else toggleFollow()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="view-controls" role="group" aria-label="Map view">
      <button
        type="button"
        className="secondary view-button"
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        title={zoomed ? 'Zoom out (-)' : 'Zoom out (-): the whole map is already in view'}
        disabled={!zoomed}
        onClick={() => zoomStep(-1)}
      >
        &minus;
      </button>
      <button
        type="button"
        className="secondary view-button"
        aria-label="Zoom in"
        aria-keyshortcuts="+"
        title={camera.zoom >= MAX_ZOOM ? 'Zoom in (+): already at the closest zoom' : 'Zoom in (+). Ctrl and the mouse wheel zoom at the pointer; drag to pan.'}
        disabled={camera.zoom >= MAX_ZOOM}
        onClick={() => zoomStep(1)}
      >
        +
      </button>
      <button
        type="button"
        className="secondary view-button view-fit"
        aria-label="Fit the whole map"
        aria-keyshortcuts="0"
        title="Show the whole map (0)"
        style={{ visibility: zoomed ? 'visible' : 'hidden' }}
        tabIndex={zoomed ? 0 : -1}
        onClick={fitCamera}
      >
        Fit
      </button>
      <button
        type="button"
        className="secondary view-button"
        aria-label="Follow the selected bot or predator"
        aria-keyshortcuts="F"
        aria-pressed={camera.follow}
        title={
          camera.follow ? 'Stop following (F)' : followable ? 'Follow the selected bot or predator (F)' : 'Follow (F): select a bot or predator first'
        }
        disabled={!camera.follow && !followable}
        onClick={toggleFollow}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
