// Drawing the world on a Canvas 2D context. Pure drawing: it reads a World and
// draws it, nothing else. Everything is drawn in CSS pixels; the caller sets
// the context transform for devicePixelRatio.
//
// The map is letterboxed to fit. Nodes are tinted shapes with a letter, so
// kind never relies on colour alone: R resource, V predator (a chevron pointing along its heading in a dashed threat ring, "z" while it rests), D meteor crater (dashed edge, drawn with an M),
// S shelter, U ruin (a diamond, not a circle), W water (a droplet with a point
// at the top). A water node is a permanent spring, so it has no fill level. A resource also has a ring that
// fills in with its remaining amount; a ruin's diamond fills in the same way. Bots are dots: children are smaller, and a fleeing bot gets a ring. Their fill follows the page's colour mode (botColour.ts, M20: plain, bloodline, sex, one trait); in sex mode males are diamonds.
// Bot positions blend from where the bot was at the start of its last turn
// (px, py) to where it is now (x, y), by `alpha`.
//
// On top of the world, `drawOverlay` adds what the player is doing: the
// selection (a double ring, plus a dashed line from a selected bot to its
// target, a dashed sight outline (V3: the vision cone, a circle with the cone off), and a thinner dotted line to its living parent and children), an outline on whatever the inspect or remove tool would hit, and a
// ghost of what a placement tool would add (an X through it when it would be
// refused).
//
// A heatmap layer (M15, heatRender.ts) is drawn right after the grid, under the zones, nodes and bots; the cell the
// readout is about gets a thin outline on top.
//
// World events (M8): a plague zone is a hatched disc with a dashed ring and the
// label "P PLAGUE" with the ticks left (shortened, or left out, when the zone is small); a meteor crater is the one remaining danger zone, drawn in
// the meteor colour with an M, and for its first moments an
// expanding ring shows the impact. The global events (drought, bounty) are
// banners over the map, in WorldCanvas.

import { coneFactor } from '../sim/perception.ts'
import { isHungry } from '../sim/predators.ts'
import { predatorTrait } from '../sim/predatorTraits.ts'
import type { ActiveEvent, Den, NodeKind, Tuning, World, WorldNode } from '../sim/types.ts'
import type { Camera } from './camera.ts'
import { DEFAULT_BOT_COLOUR, botFill, botShape, traitRange } from './botColour.ts'
import type { BotColour } from './botColour.ts'
import { PREDATOR_BODY_CELLS, botPosition, findBot, findNode, predatorPosition } from './geometry.ts'
import type { Cell, Layout } from './geometry.ts'
import { drawHeat, drawHeatCursor } from './heatRender.ts'
import type { HeatSnapshot } from './heat.ts'
import { PULSE_MS } from './highlights.ts'
import type { Pulse } from './highlights.ts'
import type { IllnessStage } from './protocol.ts'
import { chordWidth, fitLabel } from './labels.ts'
import type { Selection } from './tools.ts'
import type { ViewWorld } from './viewWorld.ts'

export type Size = { width: number; height: number }

/** A placement preview: a node (with its radius) or a bot, centred at map position (x, y). */
export type Ghost = {
  kind: NodeKind | 'bot' | 'plague' | 'meteor' | 'blight' | 'outbreak'
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
  /** The ring at the spot of the last highlight jump (F2), drawn for PULSE_MS of page time, then ignored. */
  pulse?: Pulse | null
}

/** A heat layer to draw, and the cell under the pointer (outlined while a layer is on). */
export type HeatOverlay = { snapshot: HeatSnapshot; cell: Cell | null }

export const NODE_LETTER: Record<NodeKind, string> = { resource: 'R', danger: 'D', shelter: 'S', ruin: 'U', water: 'W', predator: 'V', rough: 'G' }

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
  predator: '#ff9d5c',
  plague: '#ff7ab6',
  blight: '#a8b83c',
  disease: '#e056fd',
  meteor: '#ff9f43',
  toxic: '#ff6b6b',
  bot: '#f2cc60',
  family: '#f2cc60',
  botEdge: '#0e1118',
  flee: '#ffffff',
  ringTrack: '#2a3a2e',
  label: '#f4f6fb',
  select: '#ffffff',
  ghostInvalid: '#c9d1d9',
} as const

export const NODE_COLOR: Record<NodeKind, string> = {
  resource: COLORS.resource,
  danger: COLORS.danger,
  shelter: COLORS.shelter,
  ruin: COLORS.ruin,
  water: COLORS.water,
  predator: COLORS.predator,
  rough: COLORS.gridMajor, // R1: compile-only entry, drawing comes later
}

/** The predator chevron's fill: a light grey, so it reads against the dark map and apart from every orange and yellow thing. */
const PREDATOR_FILL = '#e6e6ee'

const GHOST_LETTER = { plague: 'P', meteor: 'M', blight: 'L', outbreak: 'I' } as const

/** Letters and labels never grow past this many pixels, so text at zoom 4 stays sane (F1). */
const MAX_TEXT_PX = 32

/** A meteor crater is a temporary danger node (it has an end tick). */
function isCrater(node: WorldNode): boolean {
  return node.kind === 'danger' && node.expires > 0
}

/** How long (ticks) the impact ring takes to grow to the full impact radius and fade out. */
const FLASH_TICKS = 24

/**
 * Largest scale that fits the whole map, centred. With a zoomed camera (F1) the scale is that times the zoom and the view is
 * centred on the camera's point; no camera, or zoom 1, gives the fitted layout exactly.
 */
export function computeLayout(size: Size, world: Pick<World, 'width' | 'height'>, camera?: Camera): Layout {
  const fit = Math.max(0.0001, Math.min(size.width / world.width, size.height / world.height))
  if (camera !== undefined && camera.zoom > 1) {
    const scale = fit * camera.zoom
    return { scale, offsetX: size.width / 2 - camera.cx * scale, offsetY: size.height / 2 - camera.cy * scale }
  }
  const scale = fit
  return {
    scale,
    offsetX: (size.width - world.width * scale) / 2,
    offsetY: (size.height - world.height * scale) / 2,
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, world: ViewWorld, layout: Layout): void {
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
  ctx.font = `700 ${Math.min(MAX_TEXT_PX, Math.max(9, Math.round(px)))}px "Segoe UI", system-ui, sans-serif`
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
  const ringWidth = Math.min(10, Math.max(2, layout.scale * 0.35))
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
  if (node.toxin !== undefined) drawToxic(ctx, cx, cy, r + ringWidth / 2 + 2, layout.scale)
}

/** Toxic food: a dashed ring outside the food ring and a "!" badge at its upper right, so the mark never rests on colour alone. */
function drawToxic(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, scale: number): void {
  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = COLORS.toxic
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  const badge = Math.min(16, Math.max(6, scale * 0.65))
  const bx = cx + r * Math.SQRT1_2
  const by = cy - r * Math.SQRT1_2
  ctx.beginPath()
  ctx.arc(bx, by, badge, 0, Math.PI * 2)
  ctx.fillStyle = COLORS.toxic
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = COLORS.botEdge
  ctx.stroke()
  ctx.fillStyle = COLORS.botEdge
  ctx.font = `800 ${Math.round(badge * 1.6)}px "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', bx, by + 0.5)
  ctx.restore()
}

/** A ruin is a diamond (a circle's corners pulled out), filled in by how much food is left. */
function drawRuin(ctx: CanvasRenderingContext2D, node: WorldNode, layout: Layout, covered: boolean): void {
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
  // A ruin under a predator (it sits on its kill) is pushed back: fainter, thin edge, no letter, so the two never blend.
  ctx.globalAlpha = (0.25 + 0.5 * fraction) * (covered ? 0.4 : 1)
  ctx.fillStyle = COLORS.ruin
  ctx.fill()
  ctx.globalAlpha = covered ? 0.45 : 1
  ctx.lineWidth = covered ? 1 : 2
  ctx.strokeStyle = COLORS.ruin
  ctx.stroke()
  ctx.globalAlpha = 1
  if (!covered) drawLetter(ctx, NODE_LETTER.ruin, cx, cy, layout.scale * 1.1)
}

/** True when a predator's body overlaps the ruin's diamond (the ruin is drawn pushed back, see `drawRuin`). */
function ruinCovered(ruin: WorldNode, predators: WorldNode[]): boolean {
  const reach = ruin.radius * 1.35 + PREDATOR_BODY_CELLS * 1.4
  return predators.some((p) => Math.abs(p.x - ruin.x) + Math.abs(p.y - ruin.y) <= reach)
}

/**
 * A predator den (E3): a small arch (a semicircle on a flat base, about 1.1 cells across the radius, at least 7 px) stroked in the
 * predator's light tone over a faint dark fill. Dens sit where a grove's resource grows, so it is drawn after the resources, as an
 * outline the R shows through. An empty den (`vacantSince` set, a newcomer is due) is drawn dashed and fainter, so the difference is
 * in the line style, not only in the strength of the colour.
 */
function drawDen(ctx: CanvasRenderingContext2D, den: Den, layout: Layout): void {
  const cx = layout.offsetX + den.x * layout.scale
  const cy = layout.offsetY + den.y * layout.scale
  const r = Math.max(7, layout.scale * 1.1)
  const vacant = den.vacantSince !== null
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.5, r, Math.PI, 0)
  ctx.closePath()
  ctx.globalAlpha = vacant ? 0.15 : 0.3
  ctx.fillStyle = COLORS.botEdge
  ctx.fill()
  ctx.globalAlpha = vacant ? 0.6 : 0.95
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.setLineDash(vacant ? [3, 3] : [])
  ctx.strokeStyle = PREDATOR_FILL
  ctx.stroke()
  ctx.restore()
}

/**
 * A predator (M21c): a light chevron pointing along its heading (a V-shaped arrowhead with a dark edge and the
 * letter V), at its position blended by `alpha`, inside a faint dashed ring at the threat radius. A resting
 * predator (tick <= restUntil) is dimmed and gets a "z". Shape, ring and letter carry the meaning, not the colour.
 */
function drawPredator(ctx: CanvasRenderingContext2D, node: WorldNode, layout: Layout, tick: number, alpha: number, tuning: Tuning): void {
  const position = predatorPosition(node, alpha)
  const cx = layout.offsetX + position.x * layout.scale
  const cy = layout.offsetY + position.y * layout.scale
  const resting = node.hunt !== null && node.hunt.restUntil > 0 && tick <= node.hunt.restUntil
  const heading = node.hunt?.heading ?? 0
  // E3: with ecology on, a fed predator does not bite, so its threat ring is dotted and fainter (a hungry or ecology-off one is as before).
  const fed = !resting && node.hunt !== null && !isHungry(node.hunt, tuning)

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, node.radius * layout.scale, 0, Math.PI * 2)
  ctx.globalAlpha = resting || fed ? 0.25 : 0.45
  ctx.lineWidth = 1.5
  ctx.setLineDash(fed ? [2, 6] : [5, 4])
  ctx.strokeStyle = COLORS.predator
  ctx.stroke()
  ctx.setLineDash([])

  // Tip ahead, two wings behind, a notch in the back (an arrowhead).
  const r = Math.max(6.5, layout.scale * PREDATOR_BODY_CELLS * 1.4)
  if (resting) {
    // A resting predator is a token: a dark disc with a thin light ring behind a full-contrast chevron, so it never reads as a ruin.
    ctx.beginPath()
    ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2)
    ctx.globalAlpha = 0.8
    ctx.fillStyle = COLORS.botEdge
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = PREDATOR_FILL
    ctx.stroke()
  }
  const cos = Math.cos(heading)
  const sin = Math.sin(heading)
  const point = (forward: number, side: number): [number, number] => [cx + cos * forward - sin * side, cy + sin * forward + cos * side]
  ctx.beginPath()
  ctx.moveTo(...point(r, 0))
  ctx.lineTo(...point(-r * 0.75, r * 0.9))
  ctx.lineTo(...point(-r * 0.2, 0))
  ctx.lineTo(...point(-r * 0.75, -r * 0.9))
  ctx.closePath()
  ctx.globalAlpha = 1
  ctx.fillStyle = PREDATOR_FILL
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.strokeStyle = COLORS.botEdge
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.fillStyle = COLORS.botEdge
  ctx.font = `800 ${Math.min(MAX_TEXT_PX, Math.max(8, Math.round(layout.scale * 0.85)))}px "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // With predator sexes the chevron carries F or M in place of its V (the chevron shape still says predator).
  const sex = node.hunt?.sex
  if (sex === undefined) ctx.fillText(NODE_LETTER.predator, cx - r * 0.1, cy + 0.5)
  else {
    // The sex has to be read, so it is a little larger and sits on a light halo that keeps it apart from the chevron's edge.
    ctx.font = `800 ${Math.min(MAX_TEXT_PX, Math.max(11, Math.round(layout.scale * 0.95)))}px "Segoe UI", system-ui, sans-serif`
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = PREDATOR_FILL
    const letter = sex === 'female' ? 'F' : 'M'
    ctx.strokeText(letter, cx - r * 0.1, cy + 0.5)
    ctx.fillText(letter, cx - r * 0.1, cy + 0.5)
  }
  if (resting) {
    ctx.globalAlpha = 1
    ctx.font = `800 ${Math.min(MAX_TEXT_PX, Math.max(13, Math.round(layout.scale * 1.7)))}px "Segoe UI", system-ui, sans-serif`
    ctx.lineWidth = 3
    ctx.strokeStyle = COLORS.botEdge
    ctx.strokeText('z', cx + r * 1.1, cy - r * 1.1)
    ctx.fillStyle = COLORS.label
    ctx.fillText('z', cx + r * 1.1, cy - r * 1.1)
  }
  ctx.restore()
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
  ctx.font = `700 ${Math.min(MAX_TEXT_PX, Math.max(10, Math.round(px)))}px "Segoe UI", system-ui, sans-serif`
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
  const labelPx = Math.min(MAX_TEXT_PX, Math.max(10, Math.round(layout.scale * 1.15)))
  ctx.font = `700 ${labelPx}px "Segoe UI", system-ui, sans-serif`
  const text = fitLabel([`P PLAGUE ${left}`, `P ${left}`, 'P'], chordWidth(r, labelY - cy) - 8, (t) => ctx.measureText(t).width)
  if (text !== null) drawOutlinedLabel(ctx, text, cx, labelY, labelPx)
}

/** A blight zone: a stippled (dotted) disc inside a long-dashed ring, labelled with its name and the ticks left. Plague is hatched; this is dots. */
function drawBlight(ctx: CanvasRenderingContext2D, event: ActiveEvent, tick: number, layout: Layout): void {
  const cx = layout.offsetX + event.x * layout.scale
  const cy = layout.offsetY + event.y * layout.scale
  const r = event.radius * layout.scale
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.globalAlpha = 0.1
  ctx.fillStyle = COLORS.blight
  ctx.fill()
  ctx.clip()
  ctx.globalAlpha = 0.55
  ctx.fillStyle = COLORS.blight
  const step = 9
  let row = 0
  for (let y = cy - r; y <= cy + r; y += step * 0.5, row += 1) {
    const shift = row % 2 === 0 ? 0 : step * 0.5
    for (let x = cx - r + shift; x <= cx + r; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = 2
  ctx.strokeStyle = COLORS.blight
  ctx.setLineDash([10, 4, 2, 4])
  ctx.stroke()
  ctx.restore()
  const left = Math.max(0, event.endTick - tick)
  const labelY = cy - r + Math.max(12, layout.scale * 1.2)
  const labelPx = Math.min(MAX_TEXT_PX, Math.max(10, Math.round(layout.scale * 1.15)))
  ctx.font = `700 ${labelPx}px "Segoe UI", system-ui, sans-serif`
  const text = fitLabel([`L BLIGHT ${left}`, `L ${left}`, 'L'], chordWidth(r, labelY - cy) - 8, (t) => ctx.measureText(t).width)
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

/**
 * The selected thing's sight (V3): a faint dashed outline at distance R * coneFactor(cos theta) in 48 directions around it, turned to
 * its heading (a plain circle of radius R with the cone off). It is the only sense-radius shape drawn; the dashes and the shape
 * carry the meaning, the colour is the selection's.
 */
function drawSight(ctx: CanvasRenderingContext2D, layout: Layout, x: number, y: number, heading: number, radius: number, front: number, rear: number, enabled: boolean): void {
  const cx = layout.offsetX + x * layout.scale
  const cy = layout.offsetY + y * layout.scale
  ctx.save()
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = COLORS.select
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  if (!enabled) {
    ctx.arc(cx, cy, radius * layout.scale, 0, Math.PI * 2)
  } else {
    for (let i = 0; i < SIGHT_POINTS; i += 1) {
      const theta = (i / SIGHT_POINTS) * Math.PI * 2
      const reach = radius * coneFactor(Math.cos(theta), front, rear) * layout.scale
      const a = heading + theta
      const qx = cx + Math.cos(a) * reach
      const qy = cy + Math.sin(a) * reach
      if (i === 0) ctx.moveTo(qx, qy)
      else ctx.lineTo(qx, qy)
    }
    ctx.closePath()
  }
  ctx.stroke()
  ctx.restore()
}

const SIGHT_POINTS = 48

function drawOverlay(ctx: CanvasRenderingContext2D, world: ViewWorld, alpha: number, layout: Layout, overlay: Overlay, tuning: Tuning): void {
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
    const cone = tuning.perception.cone
    if (sel.kind === 'bot') {
      const bot = findBot(world, sel.id)
      if (bot !== undefined) {
        const p = botPosition(bot, alpha)
        drawSight(ctx, layout, p.x, p.y, bot.heading, bot.traits.senseRadius, cone.botFront, cone.botRear, cone.enabled)
      }
    } else {
      const node = findNode(world, sel.id)
      if (node !== undefined && node.kind === 'predator' && node.hunt !== null) {
        const p = predatorPosition(node, alpha)
        drawSight(ctx, layout, p.x, p.y, node.hunt.heading, tuning.predator.senseRadius * predatorTrait(node.hunt, 'sense'), cone.predatorFront, cone.predatorRear, cone.enabled)
      }
    }
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
        // Family ties (M10): a dotted line to the living mother, the living father and each living child. The inspector
        // names them too, so the line is never the only cue.
        const p = botPosition(bot, alpha)
        ctx.save()
        ctx.globalAlpha = 0.7
        ctx.strokeStyle = COLORS.family
        ctx.lineWidth = 1
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        for (const other of world.bots) {
          if (other.id !== bot.parentId && other.id !== bot.fatherId && other.parentId !== bot.id && other.fatherId !== bot.id) continue
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
    const color = ghost.valid ? (ghost.kind === 'bot' ? COLORS.bot : ghost.kind === 'plague' || ghost.kind === 'meteor' || ghost.kind === 'blight' || ghost.kind === 'outbreak' ? COLORS[ghost.kind === 'outbreak' ? 'disease' : ghost.kind] : NODE_COLOR[ghost.kind]) : COLORS.ghostInvalid
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
      if (ghost.kind === 'plague' || ghost.kind === 'meteor' || ghost.kind === 'blight' || ghost.kind === 'outbreak') drawLetter(ctx, GHOST_LETTER[ghost.kind], cx, cy, scale * 1.4)
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

/**
 * A bot's illness (D3), in the disease colour and told apart by shape, not colour: sick = a dashed ring, exposed = a thin dotted ring,
 * immune = a small dot at the upper right of the bot. No ring or dot means healthy.
 */
function drawIllness(ctx: CanvasRenderingContext2D, stage: IllnessStage, x: number, y: number, radius: number): void {
  ctx.save()
  ctx.strokeStyle = COLORS.disease
  ctx.fillStyle = COLORS.disease
  if (stage === 'immune') {
    ctx.beginPath()
    ctx.arc(x + radius * 0.8, y - radius * 0.8, 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.setLineDash(stage === 'sick' ? [4, 3] : [1, 3])
    ctx.lineWidth = stage === 'sick' ? 2 : 1
    ctx.beginPath()
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** Two expanding rings that fade out at a highlight (F2), over PULSE_MS of page time. Needs only the spot, so no simulation data. */
function drawPulse(ctx: CanvasRenderingContext2D, pulse: Pulse, layout: Layout, now: number): void {
  const t = (now - pulse.start) / PULSE_MS
  if (t < 0 || t >= 1) return
  const cx = layout.offsetX + pulse.x * layout.scale
  const cy = layout.offsetY + pulse.y * layout.scale
  ctx.save()
  ctx.strokeStyle = pulse.tone === 'disease' ? COLORS.disease : COLORS.select
  ctx.setLineDash([])
  const reach = (pulse.radius ?? 4.8) - 0.8
  for (const lag of [0, 0.25]) {
    const u = (t - lag) / (1 - lag)
    if (u <= 0) continue
    ctx.globalAlpha = 1 - u
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, layout.scale * (0.8 + reach * u), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: ViewWorld,
  alpha: number,
  size: Size,
  tuning: Tuning,
  overlay?: Overlay,
  heat?: HeatOverlay | null,
  botColour: BotColour = DEFAULT_BOT_COLOUR,
  camera?: Camera,
): void {
  const layout = computeLayout(size, world, camera)
  const { scale, offsetX, offsetY } = layout

  ctx.clearRect(0, 0, size.width, size.height)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.fillStyle = COLORS.mapFill
  ctx.fillRect(offsetX, offsetY, world.width * scale, world.height * scale)
  drawGrid(ctx, world, layout)
  if (heat) drawHeat(ctx, heat.snapshot, world, layout)

  // Big zones first so smaller things sit on top of them.
  for (const event of world.events) {
    if (event.kind === 'plague') drawPlague(ctx, event, world.tick, layout)
    else if (event.kind === 'blight') drawBlight(ctx, event, world.tick, layout)
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
  // Dens sit at the old grove centres, under a resource's disc, so they are drawn over the resources (an outline, so the R shows through).
  for (const den of world.ecology?.dens ?? []) drawDen(ctx, den, layout)
  const predators = world.nodes.filter((node) => node.kind === 'predator')
  for (const node of world.nodes) {
    if (node.kind === 'ruin') drawRuin(ctx, node, layout, ruinCovered(node, predators))
  }
  for (const node of world.nodes) {
    if (node.kind === 'predator') drawPredator(ctx, node, layout, world.tick, alpha, tuning)
  }

  const adultAge = tuning.bot.adultAge
  const { mode, trait } = botColour
  const range = mode === 'trait' ? traitRange(world.bots, trait) : null
  for (const bot of world.bots) {
    const position = botPosition(bot, alpha)
    const x = offsetX + position.x * scale
    const y = offsetY + position.y * scale
    const radius = Math.max(3, scale * (bot.age < adultAge * bot.traits.longevity ? 0.38 : 0.55))
    ctx.beginPath()
    if (botShape(bot, mode) === 'diamond') {
      const r = radius * 1.25
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2)
    }
    ctx.fillStyle = botFill(bot, mode, trait, range)
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
    if (bot.illnessStage !== undefined) drawIllness(ctx, bot.illnessStage, x, y, radius)
  }

  const meteor = tuning.events.meteor
  for (const node of world.nodes) {
    if (isCrater(node)) drawImpact(ctx, node, meteor.craterTicks - (node.expires - world.tick), meteor.radius, layout)
  }

  if (overlay !== undefined) drawOverlay(ctx, world, alpha, layout, overlay, tuning)
  if (overlay?.pulse) drawPulse(ctx, overlay.pulse, layout, performance.now())
  if (heat?.cell) drawHeatCursor(ctx, heat.cell, layout)
}
