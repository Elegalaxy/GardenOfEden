// The map. One canvas, redrawn whenever the store publishes (every frame while
// running). The wrapper keeps the map's aspect ratio and the canvas is sized to
// it in CSS pixels, then scaled up by devicePixelRatio for a sharp picture.
//
// The canvas is also the player's input. A click is converted to a map cell
// and handed to the store (`clickMap`); hovering shows a ghost of what a
// placement tool would add. For keyboard users the canvas takes focus: arrow
// keys move a cursor cell (Shift moves 4), Enter or Space acts like a click.
//
// Camera (F1, camera.ts): Ctrl/Cmd + wheel (or a trackpad pinch) zooms at the pointer, dragging pans while zoomed in, and
// the arrow-key cursor scrolls the view to stay on screen. While following, every frame centres on the selected bot or
// predator. The buttons and keys (+ - 0 F N T) are in ViewControls. A two-finger touch gesture (F3) zooms and pans while zoomed in
// (at zoom 1 a touch must still scroll the page, so a pinch cannot start the zoom; the + button does). The Minimap floats over the map.
//
// Global world events in progress (drought, bounty) are small chips along the top
// edge of the map: a letter badge, the name, the ticks left and, on a wide map, what
// they do, in text. Area events are drawn on the map itself (render.ts).

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { rules, tuning } from '../content/index.ts'
import { checkCommand } from '../sim/commands.ts'
import type { Command } from '../sim/types.ts'
import { effectSummary, eventInfo, formatTicks } from './eventInfo.ts'
import { effectiveCamera, ensureVisible, followPosition, panBy, pinchZoom, zoomAt } from './camera.ts'
import type { Point } from './camera.ts'
import { cellAtPixel, cellCenter, nodeAt, pickAt } from './geometry.ts'
import type { Cell } from './geometry.ts'
import { toolInfo } from './tools.ts'
import type { Tool } from './tools.ts'
import { computeLayout, drawWorld } from './render.ts'
import type { Ghost, Overlay, Size } from './render.ts'
import { PULSE_MS } from './highlights.ts'
import { checkFollow, clickMap, setCamera, setHoverCell, useCamera, usePulse, useWorldStore } from './store.ts'
import { Minimap } from './Minimap.tsx'
import { ViewControls } from './ViewControls.tsx'

const BOT_REACH_CELLS = 1
const BOT_REACH_PIXELS = 14
/** A drag shorter than this many pixels is still a click. */
const DRAG_THRESHOLD = 4

/** The command a placement tool would issue at a cell, or null for inspect/remove. */
function placementAt(tool: Tool, cell: Cell): Command | null {
  const { x, y } = cellCenter(cell)
  switch (tool) {
    case 'resource':
    case 'water':
    case 'predator':
    case 'shelter':
      return { type: 'placeNode', kind: toolInfo(tool).nodeKind ?? tool, x, y }
    case 'bot':
      return { type: 'placeBot', x, y }
    case 'plague':
    case 'meteor':
    case 'blight':
    case 'outbreak':
      return { type: 'triggerEvent', event: tool, x, y }
    default:
      return null
  }
}

/** `children` are drawn over the map (the empty-world note), inside its frame. */
export function WorldCanvas({ children }: { children?: ReactNode }) {
  const snapshot = useWorldStore()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [cell, setCell] = useState<Cell | null>(null)

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

  const { world, alpha, tool, selection, heat, botColour } = snapshot
  const storedCamera = useCamera()
  const pulse = usePulse()
  const [, setPulseFrame] = useState(0)
  const target = storedCamera.follow ? followPosition(world, selection, alpha) : null
  const camera = effectiveCamera(storedCamera, world, target)
  const layout = size.width < 1 || size.height < 1 ? null : computeLayout(size, world, camera)
  // What the wheel and drag handlers (registered once) need to read.
  const live = useRef({ size, world, camera })
  const lastCentre = useRef<{ x: number; y: number } | undefined>(undefined)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const swallowClick = useRef(false)
  // Touch pointers down while zoomed in (F3): two of them make a pinch.
  const touches = useRef(new Map<number, Point>())
  const reachCells = layout === null ? BOT_REACH_CELLS : Math.max(BOT_REACH_CELLS, BOT_REACH_PIXELS / layout.scale)

  // What is under the hover/cursor cell, and what a placement there would do.
  let hover: Overlay['hover'] = null
  let ghost: Ghost | null = null
  if (cell !== null) {
    const { x, y } = cellCenter(cell)
    if (tool === 'inspect') {
      hover = pickAt(world, x, y, alpha, reachCells)
    } else if (tool === 'remove') {
      const node = nodeAt(world, x, y)
      hover = node === undefined ? null : { kind: 'node', id: node.id }
    } else {
      const cmd = placementAt(tool, cell)
      if (cmd !== null) {
        const valid = checkCommand(world, rules, cmd) === null
        const kind = cmd.type === 'placeNode' ? cmd.kind : cmd.type === 'triggerEvent' ? cmd.event : 'bot'
        let radius = 0
        if (cmd.type === 'placeNode') radius = rules.nodeDefs[cmd.kind].radius
        else if (cmd.type === 'triggerEvent' && cmd.event === 'plague') radius = rules.tuning.events.plague.radius
        else if (cmd.type === 'triggerEvent' && cmd.event === 'blight') radius = rules.tuning.events.blight.radius
        else if (cmd.type === 'triggerEvent' && cmd.event === 'outbreak') radius = rules.tuning.disease.outbreakRadius
        else if (cmd.type === 'triggerEvent' && cmd.event === 'meteor') radius = rules.tuning.events.meteor.radius
        ghost = { kind: kind as Ghost['kind'], x, y, radius, valid }
      }
    }
  }

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
    drawWorld(ctx, world, alpha, size, tuning, { selection, hover, ghost, pulse }, heat === null ? null : { snapshot: heat, cell }, botColour, camera)
    live.current = { size, world, camera }
    if (target !== null) lastCentre.current = { x: camera.cx, y: camera.cy }
    // Following stops (with a notice) when what it follows is gone.
    checkFollow(lastCentre.current)
  })

  // A highlight's ring (F2) needs redraws while it lasts, even with the sim paused: one cheap frame loop that stops when it ends.
  useEffect(() => {
    if (pulse === null) return
    let raf = 0
    const step = (): void => {
      setPulseFrame((n) => n + 1)
      if (performance.now() - pulse.start < PULSE_MS) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [pulse])

  // Ctrl/Cmd + wheel zooms at the pointer. Registered by hand: React's onWheel is passive, so it could not stop the page zooming.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const { size: s, world: w, camera: c } = live.current
      const rect = canvas.getBoundingClientRect()
      const delta = Math.max(-100, Math.min(100, event.deltaY))
      const next = zoomAt(c, w, s, event.clientX - rect.left, event.clientY - rect.top, c.zoom * Math.pow(1.0025, -delta))
      setCamera(next)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // The heatmap legend reads the cell under the pointer (or the keyboard cursor) from the store.
  useEffect(() => {
    setHoverCell(cell)
  }, [cell])
  useEffect(() => () => setHoverCell(null), [])

  const cellFromEvent = (clientX: number, clientY: number): Cell | null => {
    const canvas = canvasRef.current
    if (canvas === null || layout === null) return null
    const rect = canvas.getBoundingClientRect()
    return cellAtPixel(layout, world, clientX - rect.left, clientY - rect.top)
  }

  const moveCursor = (dx: number, dy: number): void => {
    // The first press only shows the cursor, at the middle of what the view shows.
    const from = cell ?? { cx: Math.min(world.width - 1, Math.floor(camera.cx)), cy: Math.min(world.height - 1, Math.floor(camera.cy)) }
    const next =
      cell === null
        ? from
        : {
            cx: Math.min(world.width - 1, Math.max(0, from.cx + dx)),
            cy: Math.min(world.height - 1, Math.max(0, from.cy + dy)),
          }
    setCell(next)
    const scrolled = ensureVisible(camera, world, next)
    if (scrolled !== camera) setCamera({ ...scrolled, follow: false })
  }

  const info = toolInfo(tool)
  const banners = world.events.filter((event) => event.kind === 'drought' || event.kind === 'bounty')
  return (
    <div className="map-frame" ref={wrapRef} style={{ aspectRatio: `${world.width} / ${world.height}` }}>
      <canvas
        ref={canvasRef}
        className={`map-canvas tool-${tool}${camera.zoom > 1 ? ' zoomed' : ''}`}
        tabIndex={0}
        role="application"
        aria-label={`Garden map at tick ${snapshot.tick} with ${snapshot.population} bots. ${info.label} tool: ${info.hint} Use arrow keys to move the cursor and Enter to act.`}
        onPointerDown={(event) => {
          swallowClick.current = false
          if (camera.zoom <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return
          if (event.pointerType !== 'mouse') {
            const rect = event.currentTarget.getBoundingClientRect()
            touches.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top })
            if (touches.current.size === 2) {
              // A second finger turns the drag into a pinch; the lifted finger's click must not place anything.
              drag.current = null
              swallowClick.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              return
            }
            if (touches.current.size > 2) return
          }
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          setCell(cellFromEvent(event.clientX, event.clientY))
          const held = touches.current
          if (held.has(event.pointerId) && held.size === 2) {
            const rect = event.currentTarget.getBoundingClientRect()
            const before = [...held.values()] as [Point, Point]
            held.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top })
            const after = [...held.values()] as [Point, Point]
            const { size: s, world: w, camera: c } = live.current
            setCamera(pinchZoom(c, w, s, before, after))
            swallowClick.current = true
            return
          }
          const d = drag.current
          if (d === null || d.id !== event.pointerId) return
          const dx = event.clientX - d.x
          const dy = event.clientY - d.y
          if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
          d.moved = true
          d.x = event.clientX
          d.y = event.clientY
          const { size: s, world: w, camera: c } = live.current
          setCamera(panBy(c, w, s, dx, dy))
        }}
        onPointerUp={(event) => {
          touches.current.delete(event.pointerId)
          const d = drag.current
          if (d === null || d.id !== event.pointerId) return
          drag.current = null
          // The click that ends a drag must not place or select anything.
          if (d.moved) swallowClick.current = true
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId)
          drag.current = null
        }}
        onPointerLeave={() => setCell(null)}
        onBlur={() => setCell(null)}
        onClick={(event) => {
          if (swallowClick.current) {
            swallowClick.current = false
            return
          }
          const canvas = canvasRef.current
          if (canvas === null || layout === null) return
          const rect = canvas.getBoundingClientRect()
          const px = event.clientX - rect.left
          const py = event.clientY - rect.top
          const hit = cellAtPixel(layout, world, px, py)
          if (hit === null) return
          setCell(hit)
          clickMap((px - layout.offsetX) / layout.scale, (py - layout.offsetY) / layout.scale, reachCells)
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          const step = event.shiftKey ? 4 : 1
          switch (event.key) {
            case 'ArrowLeft':
              moveCursor(-step, 0)
              break
            case 'ArrowRight':
              moveCursor(step, 0)
              break
            case 'ArrowUp':
              moveCursor(0, -step)
              break
            case 'ArrowDown':
              moveCursor(0, step)
              break
            case 'Enter':
            case ' ':
              if (cell === null) moveCursor(0, 0)
              else {
                const centre = cellCenter(cell)
                clickMap(centre.x, centre.y, reachCells)
              }
              break
            default:
              return
          }
          event.preventDefault()
        }}
      />
      {banners.length > 0 && (
        <ul className="map-banners" aria-label="World events in progress">
          {banners.map((event) => (
            <li key={`${event.kind}-${event.startTick}`} className={`map-banner banner-${event.kind}`}>
              <span className="banner-letter" aria-hidden="true">
                {eventInfo(event.kind).letter}
              </span>
              <strong>{eventInfo(event.kind).label}</strong>
              <span className="figure banner-left">{formatTicks(event.endTick - snapshot.tick)} left</span>
              <span className="banner-effect">{effectSummary(event.kind, tuning)}</span>
            </li>
          ))}
        </ul>
      )}
      <Minimap />
      <ViewControls />
      {children}
    </div>
  )
}
