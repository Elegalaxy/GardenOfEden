// The map. One canvas, redrawn whenever the store publishes (every frame while
// running). The wrapper keeps the map's aspect ratio and the canvas is sized to
// it in CSS pixels, then scaled up by devicePixelRatio for a sharp picture.
//
// The canvas is also the player's input. A click is converted to a map cell
// and handed to the store (`clickMap`); hovering shows a ghost of what a
// placement tool would add. For keyboard users the canvas takes focus: arrow
// keys move a cursor cell (Shift moves 4), Enter or Space acts like a click.
//
// Global world events in progress (drought, bounty) are listed as banners in the
// top-left corner of the map: a letter badge, the name, the ticks left and what
// they do, in text. Area events are drawn on the map itself (render.ts).

import { useEffect, useMemo, useRef, useState } from 'react'
import { rules, tuning } from '../content/index.ts'
import { checkCommand } from '../sim/commands.ts'
import type { Command } from '../sim/types.ts'
import { effectSummary, eventInfo, formatTicks } from './eventInfo.ts'
import { cellAtPixel, cellCenter, nodeAt, pickAt } from './geometry.ts'
import type { Cell } from './geometry.ts'
import { toolInfo } from './tools.ts'
import type { Tool } from './tools.ts'
import { computeLayout, drawWorld } from './render.ts'
import type { Ghost, Overlay, Size } from './render.ts'
import { clickMap, useWorldStore } from './store.ts'

const BOT_REACH_CELLS = 1
const BOT_REACH_PIXELS = 14

/** The command a placement tool would issue at a cell, or null for inspect/remove. */
function placementAt(tool: Tool, cell: Cell): Command | null {
  const { x, y } = cellCenter(cell)
  switch (tool) {
    case 'resource':
    case 'water':
    case 'danger':
    case 'shelter':
      return { type: 'placeNode', kind: toolInfo(tool).nodeKind ?? tool, x, y }
    case 'bot':
      return { type: 'placeBot', x, y }
    case 'plague':
    case 'meteor':
      return { type: 'triggerEvent', event: tool, x, y }
    default:
      return null
  }
}

export function WorldCanvas() {
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

  const { world, alpha, tool, selection } = snapshot
  const layout = useMemo(
    () => (size.width < 1 || size.height < 1 ? null : computeLayout(size, world)),
    [size, world],
  )
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
    drawWorld(ctx, world, alpha, size, tuning, { selection, hover, ghost })
  })

  const cellFromEvent = (clientX: number, clientY: number): Cell | null => {
    const canvas = canvasRef.current
    if (canvas === null || layout === null) return null
    const rect = canvas.getBoundingClientRect()
    return cellAtPixel(layout, world, clientX - rect.left, clientY - rect.top)
  }

  const moveCursor = (dx: number, dy: number): void => {
    setCell((old) => {
      const from = old ?? { cx: Math.floor(world.width / 2), cy: Math.floor(world.height / 2) }
      if (old === null) return from
      return {
        cx: Math.min(world.width - 1, Math.max(0, from.cx + dx)),
        cy: Math.min(world.height - 1, Math.max(0, from.cy + dy)),
      }
    })
  }

  const info = toolInfo(tool)
  const banners = world.events.filter((event) => event.kind === 'drought' || event.kind === 'bounty')
  return (
    <div className="map-frame" ref={wrapRef} style={{ aspectRatio: `${world.width} / ${world.height}` }}>
      <canvas
        ref={canvasRef}
        className={`map-canvas tool-${tool}`}
        tabIndex={0}
        role="application"
        aria-label={`Garden map at tick ${snapshot.tick} with ${snapshot.population} bots. ${info.label} tool: ${info.hint} Use arrow keys to move the cursor and Enter to act.`}
        onPointerMove={(event) => setCell(cellFromEvent(event.clientX, event.clientY))}
        onPointerLeave={() => setCell(null)}
        onBlur={() => setCell(null)}
        onClick={(event) => {
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
    </div>
  )
}
