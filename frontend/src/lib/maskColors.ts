import type { DefectType } from '../types/generation'

type Rgb = [number, number, number]

/** Real-defect label classes cycle through these (label class k = class-mask value 6 + k). */
const REAL_COLORS: Rgb[] = [
  [80, 120, 255],
  [255, 150, 40],
  [170, 110, 255],
  [40, 200, 170],
  [255, 120, 170],
  [200, 200, 80],
]

/** Visualisation palette only — the class-mask PNG itself stays grayscale (values 0..5, 6+ for label classes). */
export const CLASS_COLORS: Record<DefectType, Rgb> = {
  scratch: [255, 59, 48],
  pinhole: [255, 214, 10],
  contamination: [0, 229, 255],
  texture: [255, 64, 220],
  patch: [120, 255, 80],
  real: REAL_COLORS[0],
}

export function realClassColor(labelClass: number): Rgb {
  return REAL_COLORS[labelClass % REAL_COLORS.length]
}

const PALETTE: Array<[number, number, number, number]> = [
  [0, 0, 0, 0],
  [...CLASS_COLORS.scratch, 255],
  [...CLASS_COLORS.pinhole, 255],
  [...CLASS_COLORS.contamination, 255],
  [...CLASS_COLORS.texture, 255],
  [...CLASS_COLORS.patch, 255],
  ...Array.from({ length: 250 }, (_, k): [number, number, number, number] => [...realClassColor(k), 255]),
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
