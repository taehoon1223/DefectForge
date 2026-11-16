import type { Point } from '../types/generation'
import type { Size } from './geometry'

/** A defect drawn on a sample image: integer pixel vertices (pixel i spans [i, i+1)) and its label class. */
export type DrawnDefect = { classId: number; points: Point[] }

/**
 * YOLO segmentation label text, one defect per line: "class x1 y1 x2 y2 …" with x / width and y / height
 * to 6 decimals. The backend (core/yolo.py) fills round(x̂ · width) the Ultralytics way, which gives back
 * exactly the drawn vertex pixels, so the sample's defect pixels are the polygon shown on screen.
 */
export function toYoloLabel(defects: DrawnDefect[], size: Size): string {
  const line = ({ classId, points }: DrawnDefect) =>
    [String(classId), ...points.flatMap(([x, y]) => [(x / size.width).toFixed(6), (y / size.height).toFixed(6)])].join(' ')
  return defects.map(line).join('\n') + '\n'
}

/** "scratch.png" -> "scratch.txt" (the YOLO convention of one label file per image). */
export function labelFileName(imageName: string): string {
  const dot = imageName.lastIndexOf('.')
  return `${dot > 0 ? imageName.slice(0, dot) : imageName}.txt`
}
