// Drawing the world on a Canvas 2D context. Pure drawing: it reads a World and
// draws it, nothing else. Everything is drawn in CSS pixels; the caller sets
// the context transform for devicePixelRatio.
//
// The map is letterboxed to fit. Nodes are tinted shapes with a letter, so
// kind never relies on colour alone: R resource, D danger (dashed edge),
// S shelter, U ruin (a diamond, not a circle), W water (a droplet with a point
// at the top). A water node is a permanent spring, so it has no fill level. A resource also has a ring that
// fills in with its remaining amount; a ruin's diamond fills in the same way. Bots are dots: children are smaller, and a fleeing bot gets a ring.
// Bot positions blend from where the bot was at the start of its last turn
// (px, py) to where it is now (x, y), by `alpha`.
//
// On top of the world, `drawOverlay` adds what the player is doing: the
// selection (a double ring, plus a dashed line from a selected bot to its
// target), an outline on whatever the inspect or remove tool would hit, and a
// ghost of what a placement tool would add (an X through it when it would be
// refused).

import type { NodeKind, Tuning, World, WorldNode } from '../sim/types.ts'
import { botPosition, findBot, findNode } from './geometry.ts'
import type { Layout } from './geometry.ts'
import type { Selection } from './tools.ts'

export type Size = { width: number; height: number }

/** A placement preview: a node (with its radius) or a bot, centred at map position (x, y). */
export type Ghost = {
  kind: NodeKind | 'bot'
  x: number
  y: number
  radius: number
  /** False when the command would be refused; the ghost then shows an X. */
  valid: boolean
}

export type Overlay = {
  selection: Selection | null
  /** The thing the inspect or remove tool would act on under the pointer. */
  hover: Selection | null
  ghost: Ghost | null
}

export const NODE_LETTER: Record<NodeKind, string> = { resource: 'R', danger: 'D', shelter: 'S', ruin: 'U', water: 'W' }

export const COLORS = {
  background: '#0e1118',
  mapFill: '#141a24',
  gridMinor: '#1b2330',
  gridMajor: '#26324a',
  resource: '#3fb950',
  danger: '#f85149',
  shelter: '#58a6ff',
  ruin: '#bc8cff',
  water: '#4dd0e1',
  bot: '#f2cc60',
  botEdge: '#0e1118',
  flee: '#ffffff',
  ringTrack: '#2a3a2e',
  label: '#f4f6fb',
  select: '#ffffff',
  ghostInvalid: '#c9d1d9',
} as const

const NODE_COLOR: Record<NodeKind, string> = {
  resource: COLORS.resource,
  danger: COLORS.danger,
  shelter: COLORS.shelter,
  ruin: COLORS.ruin,
  water: COLORS.water,
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

/** A ruin is a diamond (a circle's corners pulled out), filled in by how much food is left. */
function drawRuin(ctx: CanvasRenderingContext2D, node: WorldNode, layout: Layout): void {
  const cx = layout.offsetX + node.x * layout.scale
  const cy = layout.offsetY + node.y * layout.scale
  // A diamond with the circle's radius would look smaller than a circle of the same radius.
  const r = node.radius * layout.scale * 1.35
  const fraction = node.capacity > 0 ? Math.min(1, Math.max(0, node.amount / node.capacity)) : 0
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx + r, cy)
  ctx.lineTo(cx, cy + r)
  ctx.lineTo(cx - r, cy)
  ctx.closePath()
  ctx.globalAlpha = 0.25 + 0.5 * fraction
  ctx.fillStyle = COLORS.ruin
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineWidth = 2
  ctx.strokeStyle = COLORS.ruin
  ctx.stroke()
  drawLetter(ctx, NODE_LETTER.ruin, cx, cy, layout.scale * 1.1)
}

/**
 * A droplet: round at the bottom with the circle's radius, a point 1.5 radii above the centre.
 * The path only; the caller fills and strokes it.
 */
function dropletPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const tip = cy - r * 1.55
  ctx.beginPath()
  ctx.moveTo(cx, tip)
  ctx.bezierCurveTo(cx + r * 0.25, cy - r * 0.95, cx + r, cy - r * 0.55, cx + r, cy)
  ctx.arc(cx, cy, r, 0, Math.PI, false)
  ctx.bezierCurveTo(cx - r, cy - r * 0.55, cx - r * 0.25, cy - r * 0.95, cx, tip)
  ctx.closePath()
}

/**
 * Water is a droplet in the water colour with a W, over a faint disc that shows where a bot can drink
 * (the node's radius). The droplet never changes, since a spring never runs dry.
 */
function drawWater(ctx: CanvasRenderingContext2D, node: WorldNode, layout: Layout): void {
  const cx = layout.offsetX + node.x * layout.scale
  const cy = layout.offsetY + node.y * layout.scale
  const reach = node.radius * layout.scale
  ctx.beginPath()
  ctx.arc(cx, cy, reach, 0, Math.PI * 2)
  ctx.globalAlpha = 0.08
  ctx.fillStyle = COLORS.water
  ctx.fill()
  ctx.globalAlpha = 1
  // Shrunk and nudged down so the whole droplet stays inside the node's circle.
  const r = reach * 0.75
  dropletPath(ctx, cx, cy + reach * 0.25, r)
  ctx.globalAlpha = 0.3
  ctx.fillStyle = COLORS.water
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineWidth = 2
  ctx.strokeStyle = COLORS.water
  ctx.stroke()
  drawLetter(ctx, NODE_LETTER.water, cx, cy + reach * 0.25, layout.scale * 1.2)
}

function drawOverlay(ctx: CanvasRenderingContext2D, world: World, alpha: number, layout: Layout, overlay: Overlay): void {
  const { scale, offsetX, offsetY } = layout
  const px = (x: number): number => offsetX + x * scale
  const py = (y: number): number => offsetY + y * scale

  const outline = (sel: Selection, width: number, gap: number, dash: number[], alphaValue: number): void => {
    ctx.save()
    ctx.globalAlpha = alphaValue
    ctx.strokeStyle = COLORS.select
    ctx.lineWidth = width
    ctx.setLineDash(dash)
    ctx.beginPath()
    if (sel.kind === 'node') {
      const node = findNode(world, sel.id)
      if (node === undefined) {
        ctx.restore()
        return
      }
      ctx.arc(px(node.x), py(node.y), node.radius * scale + gap, 0, Math.PI * 2)
    } else {
      const bot = findBot(world, sel.id)
      if (bot === undefined) {
        ctx.restore()
        return
      }
      const p = botPosition(bot, alpha)
      ctx.arc(px(p.x), py(p.y), Math.max(3, scale * 0.55) + gap, 0, Math.PI * 2)
    }
    ctx.stroke()
    ctx.restore()
  }

  if (overlay.hover !== null) outline(overlay.hover, 1.5, 4, [3, 3], 0.8)

  const sel = overlay.selection
  if (sel !== null) {
    outline(sel, 2.5, 5, [], 1)
    outline(sel, 1, 9, [2, 3], 0.7)
    if (sel.kind === 'bot') {
      const bot = findBot(world, sel.id)
      const target = bot === undefined || bot.intent.targetId === null ? undefined : findNode(world, bot.intent.targetId)
      if (bot !== undefined && target !== undefined) {
        const p = botPosition(bot, alpha)
        ctx.save()
        ctx.globalAlpha = 0.5
        ctx.strokeStyle = COLORS.select
        ctx.lineWidth = 1
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(px(p.x), py(p.y))
        ctx.lineTo(px(target.x), py(target.y))
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  const ghost = overlay.ghost
  if (ghost !== null) {
    const cx = px(ghost.x)
    const cy = py(ghost.y)
    const r = ghost.kind === 'bot' ? Math.max(3, scale * 0.55) : ghost.radius * scale
    const color = ghost.valid ? (ghost.kind === 'bot' ? COLORS.bot : NODE_COLOR[ghost.kind]) : COLORS.ghostInvalid
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.globalAlpha = 0.25
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
    if (ghost.valid) {
      if (ghost.kind === 'water') {
        // The droplet inside the drinking disc, as on the map.
        dropletPath(ctx, cx, cy + r * 0.25, r * 0.75)
        ctx.setLineDash([])
        ctx.stroke()
      }
      if (ghost.kind !== 'bot') drawLetter(ctx, NODE_LETTER[ghost.kind], cx, cy, scale * 1.4)
    } else {
      // An X through the ghost: "refused", not just a different colour.
      const arm = Math.max(5, Math.min(r, scale * 1.2) * 0.7)
      ctx.beginPath()
      ctx.moveTo(cx - arm, cy - arm)
      ctx.lineTo(cx + arm, cy + arm)
      ctx.moveTo(cx + arm, cy - arm)
      ctx.lineTo(cx - arm, cy + arm)
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
    ctx.restore()
  }
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  alpha: number,
  size: Size,
  tuning: Tuning,
  overlay?: Overlay,
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
    if (node.kind !== 'danger' && node.kind !== 'shelter') continue
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
    if (node.kind === 'water') drawWater(ctx, node, layout)
  }
  for (const node of world.nodes) {
    if (node.kind === 'resource') drawResource(ctx, node, layout)
  }
  for (const node of world.nodes) {
    if (node.kind === 'ruin') drawRuin(ctx, node, layout)
  }

  const adultAge = tuning.bot.adultAge
  for (const bot of world.bots) {
    const position = botPosition(bot, alpha)
    const x = offsetX + position.x * scale
    const y = offsetY + position.y * scale
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

  if (overlay !== undefined) drawOverlay(ctx, world, alpha, layout, overlay)
}
