import { describe, expect, it } from 'vitest'
import { CLASS_COLORS, colorizeClassMask, pngDataUrl } from './maskColors'

describe('colorizeClassMask', () => {
  it('maps class ids 0..3 to the legend palette without touching the input', () => {
    const input = new Uint8ClampedArray([0, 0, 0, 255, 1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255])
    const snapshot = input.slice()
    const out = colorizeClassMask(input)
    expect(Array.from(input)).toEqual(Array.from(snapshot))
    expect(out).not.toBe(input)
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(out.slice(4, 8))).toEqual([...CLASS_COLORS.scratch, 255])
    expect(Array.from(out.slice(8, 12))).toEqual([...CLASS_COLORS.pinhole, 255])
    expect(Array.from(out.slice(12, 16))).toEqual([...CLASS_COLORS.contamination, 255])
  })

  it('uses the default red/yellow/cyan scheme from the spec', () => {
    const [r1, g1, b1] = CLASS_COLORS.scratch
    expect(r1).toBeGreaterThan(200)
    expect(g1 + b1).toBeLessThan(150)
    const [r2, g2, b2] = CLASS_COLORS.pinhole
    expect(r2 + g2).toBeGreaterThan(400)
    expect(b2).toBeLessThan(80)
    const [r3, g3, b3] = CLASS_COLORS.contamination
    expect(r3).toBeLessThan(60)
    expect(g3 + b3).toBeGreaterThan(400)
  })

  it('adds the data-URI prefix only on the client', () => {
    expect(pngDataUrl('AAAA')).toBe('data:image/png;base64,AAAA')
  })
})
