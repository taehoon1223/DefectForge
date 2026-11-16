import { describe, expect, it } from 'vitest'
import { labelFileName, toYoloLabel } from './yoloLabel'

describe('toYoloLabel', () => {
  it('writes one normalised line per defect with its class', () => {
    const text = toYoloLabel(
      [
        { classId: 0, points: [[0, 0], [100, 0], [100, 80]] },
        { classId: 3, points: [[199, 159], [150, 159], [150, 100]] },
      ],
      { width: 200, height: 160 },
    )
    expect(text).toBe('0 0.000000 0.000000 0.500000 0.000000 0.500000 0.500000\n3 0.995000 0.993750 0.750000 0.993750 0.750000 0.625000\n')
  })

  it('gives back every vertex pixel when the backend rounds x̂ · size', () => {
    for (const size of [8, 200, 1999, 2048]) {
      for (let x = 0; x < size; x++) {
        const [, xs] = toYoloLabel([{ classId: 0, points: [[x, 0], [0, 1], [1, 1]] }], { width: size, height: 2 }).split(' ')
        expect(Math.round(Number(xs) * size)).toBe(x)
      }
    }
  })
})

describe('labelFileName', () => {
  it('replaces the extension', () => {
    expect(labelFileName('scratch.sample.png')).toBe('scratch.sample.txt')
    expect(labelFileName('noext')).toBe('noext.txt')
  })
})
