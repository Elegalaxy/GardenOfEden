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
// target, and a thinner dotted line to its living parent and children), an outline on whatever the inspect or remove tool would hit, and a
// ghost of what a placement tool would add (an X through it when it would be
// refused).
//
// World events (M8): a plague zone is a hatched disc with a dashed ring and the
// label "P PLAGUE" with the ticks left (shortened, or left out, when the zone is small); a meteor crater is a danger zone drawn in
// the meteor colour with an M instead of a D, and for its first moments an
// expanding ring shows the impact. The global events (drought, bounty) are
// banners over the map, in WorldCanvas.

import type { ActiveEvent, NodeKind, Tuning, World, WorldNode } from '../sim/types.ts'
import { botPosition, findBot, findNode } from './geometry.ts'
import type { Layout } from './geometry.ts'
import { chordWidth, fitLabel } from './labels.ts'
import type { Selection } from './tools.ts'

export type Size = { width: number; height: number }

/** A placement preview: a node (with its radius) or a bot, centred at map position (x, y). */
export type Ghost = {
  kind: NodeKind | 'bot' | 'plague' | 'meteor'
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
  plague: '#ff7ab6',
  meteor: '#ff9f43',
  bot: '#f2cc60',
  family: '#f2cc60',
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

const GHOST_LETTER = { plague: 'P', meteor: 'M' } as const

/** A meteor crater is a temporary danger node (it has an end tick). */
function isCrater(node: WorldNode): boolean {
  return node.kind === 'danger' && node.expires > 0
}

/** How long (ticks) the impact ring takes to grow to the full impact radius and fade out. */
const FLASH_TICKS = 24

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
  const color = isCrater(node) ? COLORS.meteor : NODE_COLOR[node.kind]
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

/** Text with a dark outline so it stays readable over hatching and nodes. */
function drawOutlinedLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, px: number): void {
  ctx.font = `700 ${Math.max(10, Math.round(px))}px "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = COLORS.background
  ctx.strokeText(text, cx, cy)
  ctx.fillStyle = COLORS.label
  ctx.fillText(text, cx, cy)
}

/** A plague zone: a hatched disc inside a dashed ring, labelled with its name and the ticks left. */
function drawPlague(ctx: CanvasRenderingContext2D, event: ActiveEvent, tick: number, layout: Layout): void {
  const cx = layout.offsetX + event.x * layout.scale
  const cy = layout.offsetY + event.y * layout.scale
  const r = event.radius * layout.scale
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.globalAlpha = 0.1
  ctx.fillStyle = COLORS.plague
  ctx.fill()
  ctx.clip()
  ctx.globalAlpha = 0.4
  ctx.strokeStyle = COLORS.plague
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let d = -2 * r; d <= 2 * r; d += 10) {
    ctx.moveTo(cx - r + d, cy + r)
    ctx.lineTo(cx + r + d, cy - r)
  }
  ctx.stroke()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = 2
  ctx.strokeStyle = COLORS.plague
  ctx.setLineDash([3, 5])
  ctx.stroke()
  ctx.restore()
  // The label sits near the top of the disc. It shrinks (P PLAGUE 800, then P 800, then P) to the width of the
  // disc at that height, and is left out when even the letter would spill over a tiny zone.
  const left = Math.max(0, event.endTick - tick)
  const labelY = cy - r + Math.max(12, layout.scale * 1.2)
  const labelPx = Math.max(10, Math.round(layout.scale * 1.15))
  ctx.font = `700 ${labelPx}px "Segoe UI", system-ui, sans-serif`
  const text = fitLabel([`P PLAGUE ${left}`, `P ${left}`, 'P'], chordWidth(r, labelY - cy) - 8, (t) => ctx.measureText(t).width)
  if (text !== null) drawOutlinedLabel(ctx, text, cx, labelY, labelPx)
}

/** The impact of a fresh meteor: a ring that grows to the impact radius and fades. `age` is the crater's age in ticks. */
function drawImpact(ctx: CanvasRenderingContext2D, node: WorldNode, age: number, impactRadius: number, layout: Layout): void {
  if (age < 0 || age >= FLASH_TICKS) return
  const progress = age / FLASH_TICKS
  ctx.save()
  ctx.beginPath()
  ctx.arc(layout.offsetX + node.x * layout.scale, layout.offsetY + node.y * layout.scale, impactRadius * layout.scale * (0.2 + 0.8 * progress), 0, Math.PI * 2)
  ctx.globalAlpha = 1 - progress
  ctx.lineWidth = 4
  ctx.strokeStyle = COLORS.meteor
  ctx.stroke()
  ctx.restore()
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
      if (bot !== undefined) {
        // Family ties (M10): a dotted line to the living parent and each living child. The inspector
        // names them too, so the line is never the only cue.
        const p = botPosition(bot, alpha)
        ctx.save()
        ctx.globalAlpha = 0.7
        ctx.strokeStyle = COLORS.family
        ctx.lineWidth = 1
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        for (const other of world.bots) {
          if (other.id !== bot.parentId && other.parentId !== bot.id) continue
          const q = botPosition(other, alpha)
          ctx.moveTo(px(p.x), py(p.y))
          ctx.lineTo(px(q.x), py(q.y))
        }
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
    const color = ghost.valid ? (ghost.kind === 'bot' ? COLORS.bot : ghost.kind === 'plague' || ghost.kind === 'meteor' ? COLORS[ghost.kind] : NODE_COLOR[ghost.kind]) : COLORS.ghostInvalid
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
      if (ghost.kind === 'plague' || ghost.kind === 'meteor') drawLetter(ctx, GHOST_LETTER[ghost.kind], cx, cy, scale * 1.4)
      else if (ghost.kind !== 'bot') drawLetter(ctx, NODE_LETTER[ghost.kind], cx, cy, scale * 1.4)
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
  for (const event of world.events) {
    if (event.kind === 'plague') drawPlague(ctx, event, world.tick, layout)
  }
  for (const node of world.nodes) {
    if (node.kind !== 'danger' && node.kind !== 'shelter') continue
    drawZone(ctx, node, layout)
    // Near the top of the zone, so a resource growing in its middle stays readable.
    drawLetter(
      ctx,
      isCrater(node) ? 'M' : NODE_LETTER[node.kind],
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

  const meteor = tuning.events.meteor
  for (const node of world.nodes) {
    if (isCrater(node)) drawImpact(ctx, node, meteor.craterTicks - (node.expires - world.tick), meteor.radius, layout)
  }

  if (overlay !== undefined) drawOverlay(ctx, world, alpha, layout, overlay)
}
