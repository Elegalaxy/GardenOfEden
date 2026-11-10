// The family panel's data (M14): asks the worker for the focus's family (or, with no focus, the founder
// lines) when the focus changes and then about once a second while the run is going. A paused run is
// asked again only when its tick moves (a step). Answers can arrive out of order or after the focus has
// changed, so only the newest request's answer is kept (`createLatestOnly`). While a new answer is on
// its way the last one stays in place (`loading` is true), so the panel never blanks or jumps.

import { useEffect, useRef, useState } from 'react'
import type { FamilyView, FounderLine } from '../sim/lineage.ts'
import { MAX_CHILDREN_SHOWN, QUERY_DEPTH, QUERY_MAX_NODES, createLatestOnly, shouldRequery } from './familyMath.ts'
import { getSnapshot, queryFamily, queryFounders } from './store.ts'

/** How often (ms) a running world is asked again. */
export const REQUERY_MS = 1000

export type FamilyData = {
  /** The record these answers are about: null for the founder lines. */
  focus: number | null
  view: FamilyView | null
  lines: FounderLine[]
}

export type FamilyState = {
  data: FamilyData | null
  /** A request is on its way (the data shown, if any, is the previous answer). */
  loading: boolean
  /** The last request failed (the simulation stopped); the data shown, if any, is the last good answer. */
  failed: boolean
}

export function useFamilyData(focus: number | null, up: number, runId: number): FamilyState {
  const [state, setState] = useState<FamilyState>({ data: null, loading: true, failed: false })
  const latest = useRef(createLatestOnly())
  const answeredTick = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const ask = (): void => {
      const ticket = latest.current.next()
      const askedAtTick = getSnapshot().tick
      setState((old) => (old.loading ? old : { ...old, loading: true }))
      const request: Promise<FamilyData> =
        focus === null
          ? queryFounders().then((lines) => ({ focus, view: null, lines }))
          : queryFamily(focus, up, QUERY_DEPTH, QUERY_MAX_NODES, MAX_CHILDREN_SHOWN).then((view) => ({ focus, view, lines: [] }))
      request.then(
        (data) => {
          if (cancelled || !latest.current.isCurrent(ticket)) return
          answeredTick.current = askedAtTick
          setState({ data, loading: false, failed: false })
        },
        () => {
          if (cancelled || !latest.current.isCurrent(ticket)) return
          setState((old) => ({ ...old, loading: false, failed: true }))
        },
      )
    }
    answeredTick.current = null
    ask()
    const timer = setInterval(() => {
      if (document.hidden) return
      const snapshot = getSnapshot()
      if (snapshot.load === null && shouldRequery(snapshot.paused, snapshot.tick, answeredTick.current)) ask()
    }, REQUERY_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [focus, up, runId])

  return state
}
