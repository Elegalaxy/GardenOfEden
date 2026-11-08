// The map. One canvas, redrawn whenever the store publishes (every frame while
// running). The wrapper keeps the map's aspect ratio and the canvas is sized to
// it in CSS pixels, then scaled up by devicePixelRatio for a sharp picture.

import { useEffect, useRef, useState } from 'react'
import { tuning } from '../content/index.ts'
import { drawWorld } from './render.ts'
import type { Size } from './render.ts'
import { useWorldStore } from './store.ts'

export function WorldCanvas() {
  const snapshot = useWorldStore()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const measure = (): void => {
      const rect = wrap.getBoundingClientRect()
      setSize((old) =>
        old.width === rect.width && old.height === rect.height ? old : { width: rect.width, height: rect.height },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const { world, alpha } = snapshot
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || size.width < 1 || size.height < 1) return
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.round(size.width * dpr)
    const pixelHeight = Math.round(size.height * dpr)
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawWorld(ctx, world, alpha, size, tuning)
  }, [snapshot, world, alpha, size])

  return (
    <div className="map-frame" ref={wrapRef} style={{ aspectRatio: `${world.width} / ${world.height}` }}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        role="img"
        aria-label={`Garden map at tick ${snapshot.tick} with ${snapshot.population} bots`}
      />
    </div>
  )
}
