// Drawing a heat layer (M15) under the nodes and bots. One neutral warm-white ramp serves every layer, so it never
// clashes with the node colours (green, red, blue, purple, cyan) and the layer is named by the controls and the legend,
// not by a colour: HEAT_BIN_COUNT steps of growing opacity, with an empty cell left clear. The snapshot becomes a small
// offscreen canvas (one pixel per map cell) once per snapshot, so at most about four times a second; every frame only
// stretches that canvas over the map with smoothing off, which keeps the cells square. The canvas is reused while the
// snapshot object stays the same.

import type { Cell, Layout } from './geometry.ts'
import { HEAT_BIN_COUNT, heatBin, scaleFor } from './heat.ts'
import type { HeatSnapshot } from './heat.ts'

/** The ramp colour (warm white) and the opacity of each bin, 1 to HEAT_BIN_COUNT. Index 0 is an empty cell. */
export const HEAT_RGB = [255, 238, 196] as const
export const HEAT_BIN_ALPHA = [0, 0.2, 0.34, 0.48, 0.62, 0.78] as const

/** The CSS colour of a bin, for the legend swatches. */
export function heatBinColor(bin: number): string {
  const alpha = HEAT_BIN_ALPHA[Math.min(HEAT_BIN_COUNT, Math.max(0, bin))] ?? 0
  return `rgba(${HEAT_RGB[0]}, ${HEAT_RGB[1]}, ${HEAT_RGB[2]}, ${alpha})`
}

/** RGBA pixels (one per cell) for a snapshot. Pure, so the picture can be checked without a canvas. */
export function heatPixels(snapshot: Pick<HeatSnapshot, 'cells' | 'layer' | 'max'>, into?: Uint8ClampedArray): Uint8ClampedArray {
  const pixels = into ?? new Uint8ClampedArray(snapshot.cells.length * 4)
  const scale = scaleFor(snapshot.layer)
  for (let i = 0; i < snapshot.cells.length; i += 1) {
    const bin = heatBin(snapshot.cells[i]!, snapshot.max, scale)
    const o = i * 4
    pixels[o] = HEAT_RGB[0]
    pixels[o + 1] = HEAT_RGB[1]
    pixels[o + 2] = HEAT_RGB[2]
    pixels[o + 3] = Math.round(HEAT_BIN_ALPHA[bin]! * 255)
  }
  return pixels
}

let cached: { snapshot: HeatSnapshot; canvas: HTMLCanvasElement } | null = null

function layerCanvas(snapshot: HeatSnapshot): HTMLCanvasElement | null {
  if (cached !== null && cached.snapshot === snapshot) return cached.canvas
  if (typeof document === 'undefined') return null
  const canvas = cached?.canvas ?? document.createElement('canvas')
  if (canvas.width !== snapshot.width) canvas.width = snapshot.width
  if (canvas.height !== snapshot.height) canvas.height = snapshot.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  const image = ctx.createImageData(snapshot.width, snapshot.height)
  heatPixels(snapshot, image.data)
  ctx.putImageData(image, 0, 0)
  cached = { snapshot, canvas }
  return canvas
}

/** Draws the layer over the map area (under the nodes and bots). Does nothing for a snapshot of a different size than the map. */
export function drawHeat(ctx: CanvasRenderingContext2D, snapshot: HeatSnapshot, map: { width: number; height: number }, layout: Layout): void {
  if (snapshot.width !== map.width || snapshot.height !== map.height) return
  const canvas = layerCanvas(snapshot)
  if (canvas === null) return
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(canvas, layout.offsetX, layout.offsetY, map.width * layout.scale, map.height * layout.scale)
  ctx.restore()
}

/** A thin outline around the cell the readout is about, drawn over everything. */
export function drawHeatCursor(ctx: CanvasRenderingContext2D, cell: Cell, layout: Layout): void {
  const x = layout.offsetX + cell.cx * layout.scale
  const y = layout.offsetY + cell.cy * layout.scale
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffffff'
  ctx.setLineDash([])
  ctx.strokeRect(x + 0.75, y + 0.75, Math.max(1, layout.scale - 1.5), Math.max(1, layout.scale - 1.5))
  ctx.restore()
}
