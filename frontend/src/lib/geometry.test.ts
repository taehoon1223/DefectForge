import Konva from 'konva'
import { describe, expect, it } from 'vitest'
import type { Point } from '../types/generation'
import { fitView, imageToScreen, screenToImage, toPixel, validateRoi, zoomAt, type ViewTransform } from './geometry'

const SIZE = { width: 512, height: 448 }

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('view transform', () => {
  it('round-trips screen <-> image at any zoom', () => {
    const rand = rng(1)
    for (let i = 0; i < 500; i++) {
      const view: ViewTransform = { scale: 0.05 + rand() * 31.95, x: rand() * 2000 - 1000, y: rand() * 2000 - 1000 }
      const p = { x: rand() * 512, y: rand() * 448 }
      const back = screenToImage(imageToScreen(p, view), view)
      expect(back.x).toBeCloseTo(p.x, 9)
      expect(back.y).toBeCloseTo(p.y, 9)
    }
  })

  it('matches the inverse of the Konva stage transform used by the canvas', () => {
    const rand = rng(2)
    for (let i = 0; i < 200; i++) {
      const view: ViewTransform = { scale: 0.05 + rand() * 31.95, x: rand() * 800 - 400, y: rand() * 800 - 400 }
      const t = new Konva.Transform()
      t.translate(view.x, view.y)
      t.scale(view.scale, view.scale)
      const screen = { x: rand() * 1600, y: rand() * 1000 }
      const viaKonva = t.copy().invert().point(screen)
      const ours = screenToImage(screen, view)
      expect(ours.x).toBeCloseTo(viaKonva.x, 9)
      expect(ours.y).toBeCloseTo(viaKonva.y, 9)
    }
  })

  it('T14: a click on any pixel after zoom/pan maps back within 1px, even with integer mouse coordinates', () => {
    const rand = rng(3)
    let worst = 0
    for (let i = 0; i < 2000; i++) {
      const view: ViewTransform = { scale: 1 + rand() * 31, x: rand() * 1200 - 600, y: rand() * 1200 - 600 }
      const pixel: Point = [Math.floor(rand() * SIZE.width), Math.floor(rand() * SIZE.height)]
      const s = imageToScreen({ x: pixel[0] + 0.5, y: pixel[1] + 0.5 }, view)
      const mouse = { x: Math.round(s.x), y: Math.round(s.y) } // browsers report whole CSS pixels
      const [px, py] = toPixel(screenToImage(mouse, view), SIZE)
      worst = Math.max(worst, Math.abs(px - pixel[0]), Math.abs(py - pixel[1]))
    }
    expect(worst).toBeLessThanOrEqual(1)
  })

  it('zoomAt keeps the image point under the cursor fixed', () => {
    const view: ViewTransform = { scale: 1.7, x: 33, y: -12 }
    const anchor = { x: 400, y: 260 }
    const before = screenToImage(anchor, view)
    for (const next of [0.1, 0.5, 3, 12, 32]) {
      const after = screenToImage(anchor, zoomAt(view, anchor, next))
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  })

  it('fitView centres the whole image inside the viewport', () => {
    const v = fitView(SIZE, { width: 1000, height: 800 }, 20)
    const tl = imageToScreen({ x: 0, y: 0 }, v)
    const br = imageToScreen({ x: SIZE.width, y: SIZE.height }, v)
    expect(tl.x).toBeGreaterThanOrEqual(20 - 1e-9)
    expect(br.x).toBeLessThanOrEqual(980 + 1e-9)
    expect((tl.x + br.x) / 2).toBeCloseTo(500, 9)
    expect((tl.y + br.y) / 2).toBeCloseTo(400, 9)
  })

  it('toPixel floors and clamps into the image', () => {
    expect(toPixel({ x: 10.99, y: 0.01 }, SIZE)).toEqual([10, 0])
    expect(toPixel({ x: -5, y: 9999 }, SIZE)).toEqual([0, 447])
    expect(toPixel({ x: 512, y: 448 }, SIZE)).toEqual([511, 447])
  })
})

describe('validateRoi (mirrors backend rules)', () => {
  it.each<[Point[], string | null]>([
    [[[10, 10], [100, 10], [100, 80]], null],
    [[[10, 10], [100, 10], [100, 40], [40, 40], [40, 100], [10, 100]], null], // concave
    [[], '비어'],
    [[[0, 0], [10, 10]], '최소 3개'],
    [[[0, 0], [512, 0], [0, 10]], '범위'],
    [[[0, 0], [10, 10], [20, 20]], '면적'],
    [[[10, 10], [10, 10], [50, 10], [10, 50]], '중복'],
    [[[10, 10], [100, 100], [100, 10], [10, 100]], '교차'],
    [[[10, 10], [50, 10], [30, 10], [30, 40]], '교차'],
  ])('%j -> %s', (points, fragment) => {
    const message = validateRoi(points, SIZE, 256)
    if (fragment === null) expect(message).toBeNull()
    else expect(message).toContain(fragment)
  })
})
