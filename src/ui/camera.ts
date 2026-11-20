// The map camera (F1): zoom, pan and follow, for the page only. It is never saved, never sent to the worker and
// starts over (whole map in view, not following) on a new world, a load or a swapped client. Pure functions, no DOM.
//
// `zoom` 1 shows the whole map (exactly the old fitted layout); at zoom z the view shows 1/z of the map's width.
// `cx`, `cy` are the map point (in cells) at the middle of the view. The centre is limited so the map always fills
// the view: no empty edge. `follow` means the view tracks the current selection (a bot or a predator); the render
// then centres on it every frame, so the stored centre only matters once following stops.

import type { Bot, World } from '../sim/types.ts'
import { botPosition, findBot, findNode, predatorPosition } from './geometry.ts'
import type { Selection } from './tools.ts'

export type Camera = { zoom: number; cx: number; cy: number; follow: boolean }

export type CameraWorld = Pick<World, 'width' | 'height'>
export type ViewSize = { width: number; height: number }

export const ZOOM_STEPS: readonly number[] = [1, 1.5, 2, 3, 4]
export const MAX_ZOOM = 4

/** The whole map in view, not following. The centre is a placeholder: `clampCamera` puts it at the map's middle at zoom 1. */
export const DEFAULT_CAMERA: Camera = { zoom: 1, cx: 0, cy: 0, follow: false }

/** True for a camera that shows the whole map (the old layout). */
export function isFit(camera: Camera): boolean {
  return camera.zoom <= 1
}

/** Zoom limited to 1..MAX_ZOOM; the centre limited so the view stays inside the map. */
export function clampCamera(camera: Camera, world: CameraWorld): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, camera.zoom))
  const halfW = world.width / (2 * zoom)
  const halfH = world.height / (2 * zoom)
  const cx = Math.min(world.width - halfW, Math.max(halfW, camera.cx))
  const cy = Math.min(world.height - halfH, Math.max(halfH, camera.cy))
  // With the whole map in view there is nothing to follow.
  const follow = zoom > 1 && camera.follow
  if (zoom === camera.zoom && cx === camera.cx && cy === camera.cy && follow === camera.follow) return camera
  return { ...camera, zoom, cx, cy, follow }
}

/** CSS pixels per cell when the whole map just fits the view. */
export function fitScale(size: ViewSize, world: CameraWorld): number {
  return Math.max(0.0001, Math.min(size.width / world.width, size.height / world.height))
}

/** Zooms to `nextZoom` keeping the map point under pixel (px, py) (relative to the view) where it is. */
export function zoomAt(camera: Camera, world: CameraWorld, size: ViewSize, px: number, py: number, nextZoom: number): Camera {
  const fit = fitScale(size, world)
  const zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom))
  const oldScale = fit * camera.zoom
  const newScale = fit * zoom
  const mapX = camera.cx + (px - size.width / 2) / oldScale
  const mapY = camera.cy + (py - size.height / 2) / oldScale
  return clampCamera({ ...camera, zoom, cx: mapX - (px - size.width / 2) / newScale, cy: mapY - (py - size.height / 2) / newScale }, world)
}

/** Drags the map by a pixel offset (the map follows the pointer). Panning ends following. */
export function panBy(camera: Camera, world: CameraWorld, size: ViewSize, dxPx: number, dyPx: number): Camera {
  const scale = fitScale(size, world) * camera.zoom
  return clampCamera({ ...camera, cx: camera.cx - dxPx / scale, cy: camera.cy - dyPx / scale, follow: false }, world)
}

/** The next zoom step in a direction (+1 in, -1 out); the current zoom when there is none. A zoom between steps goes to the nearest step beyond it. */
export function stepZoom(camera: Camera, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((step) => step > camera.zoom + 1e-9) ?? camera.zoom
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    const step = ZOOM_STEPS[i]!
    if (step < camera.zoom - 1e-9) return step
  }
  return camera.zoom
}

/**
 * Moves the view the least needed so the whole `cell` is inside it (the keyboard cursor stays in view). Returns the
 * same object when nothing moves; a move ends following.
 */
export function ensureVisible(camera: Camera, world: CameraWorld, cell: { cx: number; cy: number }): Camera {
  const halfW = world.width / (2 * camera.zoom)
  const halfH = world.height / (2 * camera.zoom)
  let { cx, cy } = camera
  if (cell.cx < cx - halfW) cx = cell.cx + halfW
  else if (cell.cx + 1 > cx + halfW) cx = cell.cx + 1 - halfW
  if (cell.cy < cy - halfH) cy = cell.cy + halfH
  else if (cell.cy + 1 > cy + halfH) cy = cell.cy + 1 - halfH
  if (cx === camera.cx && cy === camera.cy) return camera
  return clampCamera({ ...camera, cx, cy, follow: false }, world)
}

/** What the camera can follow: a bot, or a predator node. Its drawn position (blended by `alpha`), or null when the selection is neither or is gone. */
export function followPosition(
  world: { bots: readonly Pick<Bot, 'id' | 'x' | 'y' | 'px' | 'py'>[]; nodes: World['nodes'] },
  selection: Selection | null,
  alpha: number,
): { x: number; y: number } | null {
  if (selection === null) return null
  if (selection.kind === 'bot') {
    const bot = findBot(world, selection.id)
    return bot === undefined ? null : botPosition(bot, alpha)
  }
  const node = findNode(world, selection.id)
  return node === undefined || node.kind !== 'predator' ? null : predatorPosition(node, alpha)
}

/** The camera as drawn: while following, centred on the target (clamped); otherwise as stored. */
export function effectiveCamera(camera: Camera, world: CameraWorld, target: { x: number; y: number } | null): Camera {
  if (!camera.follow || target === null) return clampCamera(camera, world)
  return clampCamera({ ...camera, cx: target.x, cy: target.y }, world)
}

export type ViewKey = 'in' | 'out' | 'fit' | 'follow'

/** The camera key a press is: + or = zoom in, - zoom out, 0 the whole map, F follow (on their own; Shift only for the + itself). The caller ignores presses while typing. */
export function viewKeyAction(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): ViewKey | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === '+') return 'in'
  if (event.shiftKey) return null
  switch (event.key) {
    case '=':
      return 'in'
    case '-':
      return 'out'
    case '0':
      return 'fit'
    case 'f':
    case 'F':
      return 'follow'
    default:
      return null
  }
}
