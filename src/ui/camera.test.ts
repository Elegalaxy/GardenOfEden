import { describe, expect, it } from 'vitest'

import { DEFAULT_CAMERA, MAX_ZOOM, ZOOM_STEPS, clampCamera, effectiveCamera, ensureVisible, followPosition, panBy, stepZoom, viewKeyAction, zoomAt } from './camera.ts'
import type { Camera } from './camera.ts'
import { cellAtPixel } from './geometry.ts'
import { computeLayout } from './render.ts'

const world = { width: 48, height: 32 }
const size = { width: 960, height: 640 }
const at = (zoom: number, cx: number, cy: number, follow = false): Camera => ({ zoom, cx, cy, follow })

// The layout as it was before the camera existed.
function oldLayout(s: { width: number; height: number }) {
  const scale = Math.max(0.0001, Math.min(s.width / world.width, s.height / world.height))
  return { scale, offsetX: (s.width - world.width * scale) / 2, offsetY: (s.height - world.height * scale) / 2 }
}

describe('computeLayout with a camera', () => {
  it('gives exactly the old fitted layout with no camera or at zoom 1', () => {
    for (const s of [size, { width: 375, height: 250 }, { width: 290.5, height: 400.25 }, { width: 1000, height: 300 }]) {
      expect(computeLayout(s, world)).toEqual(oldLayout(s))
      expect(computeLayout(s, world, DEFAULT_CAMERA)).toEqual(oldLayout(s))
      expect(computeLayout(s, world, clampCamera(DEFAULT_CAMERA, world))).toEqual(oldLayout(s))
    }
  })

  it('scales by the zoom and centres the camera point', () => {
    const layout = computeLayout(size, world, at(2, 24, 16))
    expect(layout.scale).toBe(40)
    expect(layout.offsetX + 24 * layout.scale).toBe(480)
    expect(layout.offsetY + 16 * layout.scale).toBe(320)
  })

  it('maps pixels to cells and back at zoom 3', () => {
    const camera = clampCamera(at(3, 10, 8), world)
    const layout = computeLayout(size, world, camera)
    for (const cell of [{ cx: 6, cy: 5 }, { cx: 10, cy: 8 }, { cx: 14, cy: 11 }]) {
      const px = layout.offsetX + (cell.cx + 0.5) * layout.scale
      const py = layout.offsetY + (cell.cy + 0.5) * layout.scale
      expect(cellAtPixel(layout, world, px, py)).toEqual(cell)
    }
  })
})

describe('clampCamera', () => {
  it('limits the zoom to 1..4 and puts the centre of a whole-map view at the middle', () => {
    expect(clampCamera(at(0.2, 1, 1), world)).toMatchObject({ zoom: 1, cx: 24, cy: 16 })
    expect(clampCamera(at(9, 24, 16), world).zoom).toBe(MAX_ZOOM)
  })

  it('keeps the view inside the map at every edge', () => {
    expect(clampCamera(at(2, -5, -5), world)).toMatchObject({ cx: 12, cy: 8 })
    expect(clampCamera(at(2, 99, 99), world)).toMatchObject({ cx: 36, cy: 24 })
    expect(clampCamera(at(4, 0, 99), world)).toMatchObject({ cx: 6, cy: 28 })
  })

  it('returns the same object when nothing changes, and drops follow at zoom 1', () => {
    const camera = at(2, 20, 12)
    expect(clampCamera(camera, world)).toBe(camera)
    expect(clampCamera(at(1, 24, 16, true), world).follow).toBe(false)
    expect(clampCamera(at(2, 20, 12, true), world).follow).toBe(true)
  })
})

describe('zoomAt', () => {
  it('keeps the map point under the pointer fixed', () => {
    const start = at(1.5, 20, 14)
    for (const [px, py, next] of [[100, 80, 3], [700, 500, 2], [480, 320, 4], [10, 630, 2.5]] as const) {
      const before = computeLayout(size, world, start)
      const mapX = (px - before.offsetX) / before.scale
      const mapY = (py - before.offsetY) / before.scale
      const zoomed = zoomAt(start, world, size, px, py, next)
      expect(zoomed.zoom).toBe(next)
      const after = computeLayout(size, world, zoomed)
      expect((px - after.offsetX) / after.scale).toBeCloseTo(mapX, 9)
      expect((py - after.offsetY) / after.scale).toBeCloseTo(mapY, 9)
    }
  })

  it('zooming out to 1 shows the whole map again', () => {
    const out = zoomAt(at(3, 10, 8), world, size, 300, 200, 1)
    expect(computeLayout(size, world, out)).toEqual(oldLayout(size))
  })
})

describe('panBy', () => {
  it('moves the map with the pointer, clamps at the edge and stops following', () => {
    const camera = at(2, 24, 16, true)
    const moved = panBy(camera, world, size, 80, -40)
    expect(moved.cx).toBe(22)
    expect(moved.cy).toBe(17)
    expect(moved.follow).toBe(false)
    expect(panBy(camera, world, size, 100000, 100000)).toMatchObject({ cx: 12, cy: 8 })
  })
})

describe('stepZoom', () => {
  it('walks the steps both ways and stops at the ends', () => {
    let camera = at(1, 24, 16)
    const seen = [camera.zoom]
    for (let i = 0; i < 6; i += 1) {
      camera = { ...camera, zoom: stepZoom(camera, 1) }
      seen.push(camera.zoom)
    }
    expect(seen).toEqual([1, 1.5, 2, 3, 4, 4, 4])
    expect(ZOOM_STEPS).toEqual([1, 1.5, 2, 3, 4])
    expect(stepZoom(at(4, 24, 16), -1)).toBe(3)
    expect(stepZoom(at(1, 24, 16), -1)).toBe(1)
    expect(stepZoom(at(2.4, 24, 16), 1)).toBe(3)
    expect(stepZoom(at(2.4, 24, 16), -1)).toBe(2)
  })
})

describe('ensureVisible', () => {
  it('leaves the camera alone while the cell is in view', () => {
    const camera = at(2, 24, 16)
    expect(ensureVisible(camera, world, { cx: 14, cy: 10 })).toBe(camera)
  })

  it('scrolls the least needed to bring a cell in, and stops following', () => {
    const camera = at(2, 24, 16, true)
    const right = ensureVisible(camera, world, { cx: 40, cy: 16 })
    expect(right.cx).toBe(29) // the cell's far edge (41) at the view's right edge: 41 - 12
    expect(right.follow).toBe(false)
    const up = ensureVisible(at(2, 24, 16), world, { cx: 24, cy: 2 })
    expect(up.cy).toBe(10) // the cell's top edge (2) at the view's top edge: 2 + 8
  })

  it('never scrolls past the map', () => {
    expect(ensureVisible(at(4, 12, 8), world, { cx: 0, cy: 0 })).toMatchObject({ cx: 6, cy: 4 })
  })
})

describe('followPosition and effectiveCamera', () => {
  const bot = { id: 7, x: 10, y: 6, px: 8, py: 6 }
  const predator = { id: 3, kind: 'predator', x: 30, y: 20, hunt: null }
  const resource = { id: 4, kind: 'resource', x: 12, y: 12, hunt: null }
  const w = { bots: [bot], nodes: [predator, resource] } as unknown as Parameters<typeof followPosition>[0]

  it('follows a bot (blended by alpha) or a predator, nothing else', () => {
    expect(followPosition(w, { kind: 'bot', id: 7 }, 0.5)).toEqual({ x: 9, y: 6 })
    expect(followPosition(w, { kind: 'node', id: 3 }, 1)).toEqual({ x: 30, y: 20 })
    expect(followPosition(w, { kind: 'node', id: 4 }, 1)).toBeNull()
    expect(followPosition(w, { kind: 'bot', id: 99 }, 1)).toBeNull()
    expect(followPosition(w, null, 1)).toBeNull()
  })

  it('centres on the target while following, clamped to the map', () => {
    expect(effectiveCamera(at(2, 24, 16, true), world, { x: 30, y: 20 })).toMatchObject({ cx: 30, cy: 20 })
    expect(effectiveCamera(at(2, 24, 16, true), world, { x: 47, y: 31 })).toMatchObject({ cx: 36, cy: 24 })
    expect(effectiveCamera(at(2, 20, 10, false), world, { x: 30, y: 20 })).toMatchObject({ cx: 20, cy: 10 })
  })
})

describe('viewKeyAction', () => {
  const key = (k: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean }> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra })

  it('maps + = - 0, F and N, and leaves the tool, event and other keys alone', () => {
    expect(viewKeyAction(key('+', { shiftKey: true }))).toBe('in')
    expect(viewKeyAction(key('='))).toBe('in')
    expect(viewKeyAction(key('-'))).toBe('out')
    expect(viewKeyAction(key('0'))).toBe('fit')
    expect(viewKeyAction(key('f'))).toBe('follow')
    expect(viewKeyAction(key('F'))).toBe('follow')
    expect(viewKeyAction(key('n'))).toBe('highlight')
    expect(viewKeyAction(key('N'))).toBe('highlight')
    expect(viewKeyAction(key('n', { ctrlKey: true }))).toBeNull()
    expect(viewKeyAction(key('n', { shiftKey: true }))).toBeNull()
    for (const other of ['1', '7', 'Escape', 'd', 'b', 'p', 'm', 'l', 'h', 'c']) expect(viewKeyAction(key(other))).toBeNull()
    expect(viewKeyAction(key('-', { ctrlKey: true }))).toBeNull()
    expect(viewKeyAction(key('f', { shiftKey: true }))).toBeNull()
  })
})
