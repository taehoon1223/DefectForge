import { describe, expect, it } from 'vitest'
import { buildGenerationConfig, defaultFormState, fingerprint, generationConfigSchema, LIMITS, validateForm, type FormState, type Point } from './generation'

function form(mutate?: (f: FormState) => void): FormState {
  const f = defaultFormState()
  mutate?.(f)
  return f
}

describe('defaults and limits', () => {
  it('default form produces a valid API config', () => {
    const config = buildGenerationConfig(defaultFormState(), [], null)
    expect(generationConfigSchema.safeParse(config).success).toBe(true)
    expect(validateForm(defaultFormState())).toEqual({})
  })

  it('defaults sit inside their limits', () => {
    for (const [type, spec] of Object.entries(LIMITS.defects)) {
      const limits = spec.limits as Record<string, number[]>
      for (const [key, value] of Object.entries(spec.defaults)) {
        if (typeof value === 'string') continue
        const [lo, hi] = limits[key]
        for (const v of Array.isArray(value) ? value : [value]) {
          expect(v, `${type}.${key}`).toBeGreaterThanOrEqual(lo)
          expect(v, `${type}.${key}`).toBeLessThanOrEqual(hi)
        }
      }
    }
  })
})

describe('buildGenerationConfig', () => {
  it('includes only enabled defects, in the fixed scratch -> pinhole -> contamination order', () => {
    const polygon: Point[] = [
      [1, 2],
      [30, 2],
      [30, 40],
    ]
    const config = buildGenerationConfig(
      form((f) => {
        f.defects.pinhole.enabled = false
      }),
      [{ id: 'r1', name: '영역 1', kind: 'include', polygon }],
      null,
    )
    expect(config.defects.map((d) => d.type)).toEqual(['scratch', 'contamination'])
    expect(config.regions).toEqual([{ id: 'r1', name: '영역 1', kind: 'include', polygon }])
    expect(config).toMatchObject({ version: '1.1', seed: 42, allow_overlap: false })
  })

  it('emits no regions for the full image', () => {
    expect(buildGenerationConfig(defaultFormState(), [], null).regions).toEqual([])
  })
})

describe('validateForm (Zod)', () => {
  it('reports Korean field errors keyed by type and field', () => {
    const errors = validateForm(
      form((f) => {
        f.defects.scratch.params.length_px = [200, 100]
        f.defects.pinhole.count = 31
        f.defects.contamination.params.blur_sigma = 9
        f.defects.scratch.params.orientation.jitter_deg = 46
        f.edgeMarginPx = -1
        f.seed = -1
      }),
    )
    expect(errors['scratch.params.length_px']).toContain('최솟값')
    expect(errors['scratch.params.orientation.jitter_deg']).toContain('45 이하')
    expect(errors.edgeMarginPx).toContain('0 이상')
    expect(errors['pinhole.count']).toContain('30 이하')
    expect(errors['contamination.params.blur_sigma']).toContain('8 이하')
    expect(errors.seed).toContain('0 이상')
  })

  it('rejects empty numeric input (NaN) and out-of-range ranges', () => {
    const errors = validateForm(
      form((f) => {
        f.defects.scratch.params.width_px = [Number.NaN, 3]
        f.defects.pinhole.params.radius_px = [0, 5]
      }),
    )
    expect(errors['scratch.params.width_px']).toBeDefined()
    expect(errors['pinhole.params.radius_px']).toContain('범위')
  })

  it('ignores invalid settings of disabled types but requires at least one type', () => {
    const f = form((x) => {
      x.defects.scratch.count = 999
      x.defects.scratch.enabled = false
    })
    expect(validateForm(f)['scratch.count']).toBeUndefined()
    f.defects.pinhole.enabled = false
    f.defects.contamination.enabled = false
    expect(validateForm(f).defects).toBeDefined()
  })
})

describe('fingerprint', () => {
  it('is independent of key order and changes with any value', () => {
    expect(fingerprint({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(fingerprint({ b: { d: 'x', c: [1, 2] }, a: 1 }))
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }))
  })
})
