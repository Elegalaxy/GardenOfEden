// Share links in the address bar (M9). Opening the page with `#run2=<payload>` (compressed)
// or `#run=<payload>` (the original form) loads that run, paused at the saved tick. The
// fragment is removed from the address bar as soon as it is seen, so reloading the page
// later does not replace the run you are playing with the shared one. The payload is
// untrusted; `readShareFragment` unpacks (async, with a size limit) and validates it, and a
// bad one only produces an error notice (the current run stays).

import { parseShareFragment, readShareFragment } from '../persist/share.ts'
import { reportSave, startLoad } from './store.ts'

/** The page address without any fragment, plus `fragment`. */
export function shareUrl(fragment: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}${fragment}`
}

/**
 * Loads the run in the address bar's fragment, if there is one. The fragment is stripped at once;
 * the returned promise settles when the payload has been unpacked and the load has been started
 * (or the error shown). Resolves to true when it found a share link.
 */
export async function loadFromLocation(): Promise<boolean> {
  const hash = window.location.hash
  if (parseShareFragment(hash) === null) return false
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // Some embedded contexts forbid it; the link then just stays in the bar.
  }
  let result
  try {
    result = await readShareFragment(hash)
  } catch {
    reportSave('error', 'This link could not be read. Your current run was kept.')
    return true
  }
  if (result === null) return false
  if (!result.ok) {
    reportSave('error', `${result.error.message} Your current run was kept.`)
    return true
  }
  void startLoad(result.save)
  return true
}

/** Loads a share link present at page start, and one pasted into the address bar later. Returns a cleanup. */
export function watchShareLinks(): () => void {
  void loadFromLocation()
  const onChange = (): void => {
    void loadFromLocation()
  }
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}
