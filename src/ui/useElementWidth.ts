// A callback ref plus the element's width in whole pixels, kept up to date by a
// ResizeObserver. A callback ref, because a chart's box may not be rendered
// yet (the empty state) when the component first mounts. Width is 0 until the
// element exists.

import { useEffect, useState } from 'react'

export function useElementWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (element === null) return
    const measure = (): void => setWidth(Math.floor(element.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}
