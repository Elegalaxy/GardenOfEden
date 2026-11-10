// Which record the family panel shows (M14). Normally the selected bot; the player can point the
// panel at any other record (a relative, a dead ancestor, a founder line) without changing the map
// selection, and the inspector's "Show family" button points it at the selected bot and scrolls to
// it. The choice is a `FocusOverride` (familyMath.ts) that holds only while the selection is the
// one it was made for. `seq` counts the player's own focus moves, so the panel can move keyboard
// focus to its heading after one (the button the player pressed may be gone from the new tree).

import { useSyncExternalStore } from 'react'
import { resolveFocus } from './familyMath.ts'
import type { FocusOverride } from './familyMath.ts'
import { getSnapshot } from './store.ts'

export type FamilyFocusState = { override: FocusOverride | null; seq: number; reveal: boolean }

let state: FamilyFocusState = { override: null, seq: 0, reveal: false }
const listeners = new Set<() => void>()

function selectedBotId(): number | null {
  const { selection } = getSnapshot()
  return selection !== null && selection.kind === 'bot' ? selection.id : null
}

function set(override: FocusOverride | null, reveal: boolean): void {
  state = { override, seq: state.seq + 1, reveal }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getFamilyFocus = (): FamilyFocusState => state

export function useFamilyFocus(): FamilyFocusState {
  return useSyncExternalStore(subscribe, getFamilyFocus, getFamilyFocus)
}

/** Shows the tree of any record (a relative, a founder line). `null` goes back to the founder lines. */
export function focusRecord(id: number | null): void {
  set({ id, forSelection: selectedBotId(), runId: getSnapshot().runId }, false)
}

/** The inspector's "Show family": the panel shows this bot and scrolls into view. */
export function revealFamily(id: number): void {
  set({ id, forSelection: selectedBotId(), runId: getSnapshot().runId }, true)
}

/** The panel is about to select a bot on the map: keep showing `keepId` while that selection stands. */
export function pinFocusFor(selectedId: number, keepId: number | null): void {
  state = { ...state, override: { id: keepId, forSelection: selectedId, runId: getSnapshot().runId } }
  for (const listener of listeners) listener()
}

/** The record the panel shows right now (for non-React callers and tests). */
export function currentFocus(): number | null {
  return resolveFocus(state.override, selectedBotId(), getSnapshot().runId)
}
