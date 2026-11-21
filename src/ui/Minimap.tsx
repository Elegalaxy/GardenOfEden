// The minimap (F3): a small whole-map picture floating in the bottom left corner of the map frame, shown only while the view is zoomed in.
// It draws the nodes as dots by kind, the bots as 1 px dots, predators apart, and the camera's view as an outline. A click or drag on it
// moves the view there (turning follow and the auto-tour off). The picture of the world is rebuilt at most 4 times a second; the
// outline is redrawn on every camera change. It floats, so the page layout does not change; CSS hides it on a small map.

import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { clampCamera, effectiveCamera, followPosition, minimapSize, minimapToMap, viewportRect } from './camera.ts'
import { COLORS, NODE_COLOR } from './render.ts'
import { getCamera, setCamera, useCamera, useWorldStore } from './store.ts'

const REBUILD_MS = 250
const PREDATOR_FILL = '#e6e6ee'

export function Minimap() {
  const storedCamera = useCamera()
  const { world, selection, alpha } = useWorldStore()
  // While following, the stored centre is stale: the view is centred on the target.
  const camera = effectiveCamera(storedCamera, world, storedCamera.follow ? followPosition(world, selection, alpha) : null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cache = useRef<{ canvas: HTMLCanvasElement; at: number; key: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dragging = useRef(false)
  const box = minimapSize(world)
  const shown = camera.zoom > 1

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || !shown) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(box.width * dpr)
    const h = Math.round(box.height * dpr)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    const rebuild = (): void => {
      const layer = cache.current?.canvas ?? document.createElement('canvas')
      layer.width = w
      layer.height = h
      const lc = layer.getContext('2d')
      if (lc === null) return
      lc.setTransform(dpr, 0, 0, dpr, 0, 0)
      lc.fillStyle = COLORS.mapFill
      lc.fillRect(0, 0, box.width, box.height)
      const kx = box.width / world.width
      const ky = box.height / world.height
      for (const node of world.nodes) {
        if (node.kind === 'rough' || node.kind === 'predator') continue
        lc.fillStyle = NODE_COLOR[node.kind]
        lc.fillRect(Math.round(node.x * kx) - 1, Math.round(node.y * ky) - 1, 3, 3)
      }
      lc.fillStyle = COLORS.bot
      for (const bot of world.bots) lc.fillRect(Math.floor(bot.x * kx), Math.floor(bot.y * ky), 1, 1)
      for (const node of world.nodes) {
        if (node.kind !== 'predator') continue
        const px = Math.round(node.x * kx)
        const py = Math.round(node.y * ky)
        lc.fillStyle = COLORS.predator
        lc.fillRect(px - 3, py - 3, 6, 6)
        lc.fillStyle = PREDATOR_FILL
        lc.fillRect(px - 2, py - 2, 4, 4)
      }
      cache.current = { canvas: layer, at: performance.now(), key: `${w}x${h}` }
    }

    const compose = (): void => {
      const layer = cache.current
      if (layer === null) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer.canvas, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const r = viewportRect(camera, world, box)
      ctx.lineWidth = 1
      ctx.strokeStyle = COLORS.select
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.max(1, Math.round(r.w) - 1), Math.max(1, Math.round(r.h) - 1))
    }

    const stale = cache.current === null || cache.current.key !== `${w}x${h}` || performance.now() - cache.current.at >= REBUILD_MS
    if (stale) {
      rebuild()
      compose()
    } else {
      compose()
      if (timer.current === undefined) {
        timer.current = setTimeout(() => {
          timer.current = undefined
          rebuild()
          compose()
        }, REBUILD_MS)
      }
    }
  })

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )

  const moveTo = (event: PointerEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const point = minimapToMap(event.clientX - rect.left, event.clientY - rect.top, box, world)
    setCamera(clampCamera({ ...getCamera(), cx: point.x, cy: point.y, follow: false }, world))
  }

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      role="img"
      aria-label="Minimap of the whole map. Click or drag to move the view."
      title="Whole map: click or drag to move the view"
      style={{ width: box.width, height: box.height, visibility: shown ? 'visible' : 'hidden' }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        moveTo(event)
      }}
      onPointerMove={(event) => {
        if (dragging.current) moveTo(event)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    />
  )
}
