// Share links in the address bar (M9). Opening the page with `#run=<payload>` loads
// that run, paused at the saved tick. The fragment is removed from the address bar
// as soon as it is read, so reloading the page later does not replace the run you
// are playing with the shared one. The payload is untrusted; `readShareFragment`
// validates it and a bad one only produces an error notice (the current run stays).

import { readShareFragment } from '../persist/share.ts'
import { reportSave, startLoad } from './store.ts'

/** The page address without any fragment, plus `fragment`. */
export function shareUrl(fragment: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}${fragment}`
}

/** Loads the run in the address bar's fragment, if there is one. Returns true when it found a share link. */
export function loadFromLocation(): boolean {
  const result = readShareFragment(window.location.hash)
  if (result === null) return false
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // Some embedded contexts forbid it; the link then just stays in the bar.
  }
  if (!result.ok) {
    reportSave('error', `${result.error.message} Your current run was kept.`)
    return true
  }
  void startLoad(result.save)
  return true
}

/** Loads a share link present at page start, and one pasted into the address bar later. Returns a cleanup. */
export function watchShareLinks(): () => void {
  loadFromLocation()
  const onChange = (): void => {
    loadFromLocation()
  }
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}
