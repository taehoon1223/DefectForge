/**
 * Coordinate model
 * - Image space: continuous, pixel i spans [i, i+1); ROI points are integer pixel indices.
 * - Screen (stage container) space: screen = image * scale + offset.
 * Zoom/pan only change the view transform; they never touch image data.
 */
import type { Point } from '../types/generation'

export type Vec = { x: number; y: number }
export type ViewTransform = { scale: number; x: number; y: number }
export type Size = { width: number; height: number }

export const MIN_SCALE = 0.05
export const MAX_SCALE = 32

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function screenToImage(p: Vec, view: ViewTransform): Vec {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }
}

export function imageToScreen(p: Vec, view: ViewTransform): Vec {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y }
}

/** Continuous image coordinate -> integer pixel index, clamped into the image. */
export function toPixel(p: Vec, size: Size): Point {
  const x = Math.min(size.width - 1, Math.max(0, Math.floor(p.x)))
  const y = Math.min(size.height - 1, Math.max(0, Math.floor(p.y)))
  return [x, y]
}

/** Canvas position of a pixel's centre (pixel i spans [i, i+1)). */
export function pixelCenter([x, y]: Point): [number, number] {
  return [x + 0.5, y + 0.5]
}

export function flatCenters(points: Point[]): number[] {
  return points.flatMap(pixelCenter)
}

export function isInsideImage(p: Vec, size: Size): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < size.width && p.y < size.height
}

/** Zoom so that the image point under `anchor` (screen) stays under it. */
export function zoomAt(view: ViewTransform, anchor: Vec, nextScale: number): ViewTransform {
  const scale = clampScale(nextScale)
  const focus = screenToImage(anchor, view)
  return { scale, x: anchor.x - focus.x * scale, y: anchor.y - focus.y * scale }
}

export function fitView(image: Size, viewport: Size, padding = 24): ViewTransform {
  const availW = Math.max(1, viewport.width - padding * 2)
  const availH = Math.max(1, viewport.height - padding * 2)
  const scale = clampScale(Math.min(availW / image.width, availH / image.height))
  return {
    scale,
    x: (viewport.width - image.width * scale) / 2,
    y: (viewport.height - image.height * scale) / 2,
  }
}

// ---------------------------------------------------------------- polygon validation (mirrors backend core/roi.py)

export function polygonArea(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  )
}

export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const o1 = orient(p1, p2, p3)
  const o2 = orient(p1, p2, p4)
  const o3 = orient(p3, p4, p1)
  const o4 = orient(p3, p4, p2)
  if (o1 !== o2 && o3 !== o4) return true
  return (
    (o1 === 0 && onSegment(p1, p2, p3)) ||
    (o2 === 0 && onSegment(p1, p2, p4)) ||
    (o3 === 0 && onSegment(p3, p4, p1)) ||
    (o4 === 0 && onSegment(p3, p4, p2))
  )
}

export function hasSelfIntersection(points: Point[]): boolean {
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a1 = points[i]
    const a2 = points[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      const b1 = points[j]
      const b2 = points[(j + 1) % n]
      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      if (adjacent) {
        const [shared, aOther, bOther] = j === i + 1 ? [a2, a1, b2] : [a1, a2, b1]
        if (orient(aOther, shared, bOther) === 0) {
          const dot = (aOther[0] - shared[0]) * (bOther[0] - shared[0]) + (aOther[1] - shared[1]) * (bOther[1] - shared[1])
          if (dot > 0) return true
        }
        continue
      }
      if (segmentsIntersect(a1, a2, b1, b2)) return true
    }
  }
  return false
}

/** Korean error message, or null when the ROI is valid. */
export function validateRoi(points: Point[], size: Size, maxPoints: number, label = 'ROI'): string | null {
  if (points.length === 0) return `${label}가 비어 있습니다.`
  if (points.length < 3) return `${label} 다각형은 최소 3개의 점이 필요합니다.`
  if (points.length > maxPoints) return `${label} 점은 최대 ${maxPoints}개까지 지정할 수 있습니다.`
  if (points.some(([x, y]) => !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size.width || y >= size.height)) {
    return `${label} 점이 이미지 범위를 벗어났습니다.`
  }
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % points.length]
    if (ax === bx && ay === by) return `${label}에 연속으로 중복된 점이 있습니다.`
  }
  if (points.slice(2).every((p) => orient(points[0], points[1], p) === 0)) return `${label} 다각형의 면적이 0입니다.`
  if (hasSelfIntersection(points)) return `${label} 다각형의 변이 서로 교차합니다. 자기 교차가 없도록 꼭짓점을 옮기세요.`
  if (polygonArea(points) === 0) return `${label} 다각형의 면적이 0입니다.`
  return null
}
