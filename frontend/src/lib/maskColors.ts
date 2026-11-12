import type { DefectType } from '../types/generation'

/** Visualisation palette only — the class-mask PNG itself stays grayscale (values 0..5). */
export const CLASS_COLORS: Record<DefectType, [number, number, number]> = {
  scratch: [255, 59, 48],
  pinhole: [255, 214, 10],
  contamination: [0, 229, 255],
  texture: [255, 64, 220],
  patch: [120, 255, 80],
}

const PALETTE: Array<[number, number, number, number]> = [
  [0, 0, 0, 0],
  [...CLASS_COLORS.scratch, 255],
  [...CLASS_COLORS.pinhole, 255],
  [...CLASS_COLORS.contamination, 255],
  [...CLASS_COLORS.texture, 255],
  [...CLASS_COLORS.patch, 255],
]

export function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r} ${g} ${b})`
}

/**
 * Map a decoded grayscale class mask (RGBA pixels, class id in the R channel) to a colour overlay.
 * Returns a new buffer; the input is never modified.
 */
export function colorizeClassMask(rgba: Uint8ClampedArray, background: [number, number, number, number] = [0, 0, 0, 0]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const id = rgba[i]
    const color = id === 0 ? background : (PALETTE[id] ?? [255, 0, 255, 255])
    out[i] = color[0]
    out[i + 1] = color[1]
    out[i + 2] = color[2]
    out[i + 3] = color[3]
  }
  return out
}

export function pngDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`
}
