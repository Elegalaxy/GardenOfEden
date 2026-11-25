// A small read-only mark on the map while the run has experimental world rules on: how many, with their names in the
// tooltip and the accessible label. It floats in the map's bottom right corner and renders nothing for a plain world, so
// the layout never moves. It is focusable so a keyboard user can reach the names.

import { featureNames } from './labels.ts'
import { useStoreValue } from './store.ts'

export function ExperimentalChip() {
  const features = useStoreValue((snapshot) => snapshot.features)
  if (features.length === 0) return null
  const text = `Experimental rules on: ${featureNames(features)}`
  return (
    <p className="run-chip" role="note" tabIndex={0} title={text} aria-label={text}>
      Experimental · {features.length}
    </p>
  )
}
