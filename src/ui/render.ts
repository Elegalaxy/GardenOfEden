// Drawing the world on a Canvas 2D context. Pure drawing: it reads a World and
// draws it, nothing else. Everything is drawn in CSS pixels; the caller sets
// the context transform for devicePixelRatio.
//
// The map is letterboxed to fit. Nodes are tinted circles with a letter, so
// kind never relies on colour alone: R resource, D danger (dashed edge),
// S shelter. A resource also has a ring that fills in with its remaining
// amount. Bots are dots: children are smaller, and a fleeing bot gets a ring.
// Bot positions blend from where the bot was at the start of its last turn
// (px, py) to where it is now (x, y), by `alpha`.

import type { NodeKind, Tuning, World, WorldNode } from '../sim/types.ts'

export type Size = { width: number; height: number }

export type Layout = {
  /** CSS pixels per map cell. */
  scale: number
  offsetX: number
  offsetY: number
}

export const NODE_LETTER: Record<NodeKind, string> = { resource: 'R', danger: 'D', shelter: 'S' }

export const COLORS = {
  background: '#0e1118',
  mapFill: '#141a24',
  gridMinor: '#1b2330',
  gridMajor: '#26324a',
  resource: '#3fb950',
  danger: '#f85149',
  shelter: '#58a6ff',
  bot: '#f2cc60',
  botEdge: '#0e1118',
  flee: '#ffffff',
  ringTrack: '#2a3a2e',
  label: '#f4f6fb',
} as const

const NODE_COLOR: Record<NodeKind, string> = {
  resource: COLORS.resource,
  danger: COLORS.danger,
  shelter: COLORS.shelter,
}

/** Largest scale that fits the whole map, centred. */
export function computeLayout(size: Size, world: Pick<World, 'width' | 'height'>): Layout {
  const scale = Math.max(0.0001, Math.min(size.width / world.width, size.height / world.height))
  return {
    scale,
    offsetX: (size.width - world.width * scale) / 2,
    offsetY: (size.height - world.height * scale) / 2,
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, world: World, layout: Layout): void {
  const { scale, offsetX, offsetY } = layout
  const right = offsetX + world.width * scale
  const bottom = offsetY + world.height * scale
  ctx.lineWidth = 1
  for (let gx = 0; gx <= world.width; gx += 1) {
    const major = gx % 8 === 0
    if (!major && scale < 10) continue
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor
    const x = Math.round(offsetX + gx * scale) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, offsetY)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  }
  for (let gy = 0; gy <= world.height; gy += 1) {
    const major = gy % 8 === 0
    if (!major && scale < 10) continue
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor
    const y = Math.round(offsetY + gy * scale) + 0.5
    ctx.beginPath()
    ctx.moveTo(offsetX, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }
}

function drawZone(ctx: CanvasRenderingContext2D, node: WorldNode, layout: Layout): void {
  const cx = layout.offsetX + node.x * layout.scale
  const cy = layout.offsetY + node.y * layout.scale
  const r = node.radius * layout.scale
  const color = NODE_COLOR[node.kind]
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.globalAlpha = 0.16
  ctx.fillStyle = color
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.setLineDash(node.kind === 'danger' ? [6, 4] : [])
  ctx.stroke()
  ctx.setLineDash([])
}

function drawLetter(ctx: CanvasRenderingContext2D, letter: string, cx: number, cy: number, px: number): void {
  ctx.fillStyle = COLORS.label
  ctx.font = `700 ${Math.max(9, Math.round(px))}px "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, cx, cy + 0.5)
}

function drawResource(ctx: CanvasRenderingContext2D, node: WorldNode, layout: Layout): void {
  const cx = layout.offsetX + node.x * layout.scale
  const cy = layout.offsetY + node.y * layout.scale
  const r = node.radius * layout.scale
  const fraction = node.capacity > 0 ? Math.min(1, Math.max(0, node.amount / node.capacity)) : 0
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.globalAlpha = 0.12 + 0.28 * fraction
  ctx.fillStyle = COLORS.resource
  ctx.fill()
  ctx.globalAlpha = 1
  const ringWidth = Math.max(2, layout.scale * 0.35)
  ctx.lineWidth = ringWidth
  ctx.strokeStyle = COLORS.ringTrack
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  if (fraction > 0) {
    ctx.strokeStyle = COLORS.resource
    ctx.beginPath()
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction)
    ctx.stroke()
  }
  drawLetter(ctx, NODE_LETTER.resource, cx, cy, layout.scale * 1.3)
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  alpha: number,
  size: Size,
  tuning: Tuning,
): void {
  const layout = computeLayout(size, world)
  const { scale, offsetX, offsetY } = layout

  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.fillStyle = COLORS.mapFill
  ctx.fillRect(offsetX, offsetY, world.width * scale, world.height * scale)
  drawGrid(ctx, world, layout)

  // Big zones first so smaller things sit on top of them.
  for (const node of world.nodes) {
    if (node.kind === 'resource') continue
    drawZone(ctx, node, layout)
    // Near the top of the zone, so a resource growing in its middle stays readable.
    drawLetter(
      ctx,
      NODE_LETTER[node.kind],
      offsetX + node.x * scale,
      offsetY + (node.y - node.radius * 0.62) * scale,
      scale * 1.5,
    )
  }
  for (const node of world.nodes) {
    if (node.kind === 'resource') drawResource(ctx, node, layout)
  }

  const adultAge = tuning.bot.adultAge
  for (const bot of world.bots) {
    const x = offsetX + (bot.px + (bot.x - bot.px) * alpha) * scale
    const y = offsetY + (bot.py + (bot.y - bot.py) * alpha) * scale
    const radius = Math.max(3, scale * (bot.age < adultAge ? 0.38 : 0.55))
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.bot
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = COLORS.botEdge
    ctx.stroke()
    if (bot.intent.kind === 'flee') {
      ctx.beginPath()
      ctx.arc(x, y, radius + 3, 0, Math.PI * 2)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = COLORS.flee
      ctx.stroke()
    }
  }
}
