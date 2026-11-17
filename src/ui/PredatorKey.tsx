// The predator's key in the map legend and on its tool button: a dashed threat ring around a light chevron with a
// dark edge, as on the map. An inline SVG so the chevron keeps its size at 22px (a clipped pseudo-element was too faint).

export function PredatorKey() {
  return (
    <svg className="key key-predator" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" />
      <path d="M20 11 L5 18.5 L9.5 11 L5 3.5 Z" />
    </svg>
  )
}

/** The den's key in the map legend (E3): an arch on a flat base, as drawn on the map (the dashed variant is the empty den). */
export function DenKey() {
  return (
    <svg className="key key-den" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 17 A8 8 0 0 1 19 17 Z" />
    </svg>
  )
}
