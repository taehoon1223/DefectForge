import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultFormState, generationConfigSchema, lineAngleDeg, validateForm, type Point } from '../types/generation'
import { blockingReason, buildActiveConfig, currentConfigHash, nextRegionName, useWorkspaceStore } from './useWorkspaceStore'

const initial = useWorkspaceStore.getState()
const RECT: Point[] = [
  [100, 80],
  [200, 80],
  [200, 300],
  [100, 300],
]

function loadImage() {
  useWorkspaceStore.getState().setSource(new File([new Uint8Array(4)], 'part.png', { type: 'image/png' }), 'blob:m', { width: 640, height: 400 })
}

beforeEach(() => {
  useWorkspaceStore.setState(initial, true)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  loadImage()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const s = () => useWorkspaceStore.getState()

describe('areas and scratch options', () => {
  it('default form is valid and adds nothing beyond config 1.0', () => {
    expect(validateForm(defaultFormState())).toEqual({})
    const config = buildActiveConfig(s())
    expect(generationConfigSchema.safeParse(config).success).toBe(true)
    expect(config).toMatchObject({ version: '1.1', regions: [], edge_margin_px: 0, reference_line: null })
    const scratch = config.defects.find((d) => d.type === 'scratch')
    expect(scratch?.type === 'scratch' && scratch.params.orientation.mode).toBe('random')
    expect(scratch?.type === 'scratch' && scratch.params.shading.mode).toBe('fixed')
  })

  it('names regions by kind', () => {
    expect(nextRegionName('include', [])).toBe('영역 1')
    s().addRegion('include', RECT)
    s().addRegion('exclude', RECT)
    s().addRegion('include', RECT)
    expect(s().regions.map((r) => r.name)).toEqual(['영역 1', '제외 1', '영역 2'])
    expect(s().selectedRegionId).toBe(s().regions[2].id)
  })

  it('explains what is missing before generation is possible', () => {
    expect(blockingReason(s())).toBeNull() // no region = whole image
    s().setDraft([[1, 1]])
    expect(blockingReason(s())).toContain('생성 영역 그리기')
    s().setDraft(null)
    const a = s().addRegion('include', RECT)
    s().renameRegion(a, '  ')
    expect(blockingReason(s())).toContain('이름')
    s().renameRegion(a, '영역 1')
    s().updateRegionPolygon(a, [
      [10, 10],
      [100, 100],
      [100, 10],
      [10, 100],
    ])
    expect(blockingReason(s())).toContain("영역 '영역 1' 다각형의 변이 서로 교차")
    s().updateRegionPolygon(a, RECT)
    s().setScratchOrientation({ mode: 'parallel' })
    expect(blockingReason(s())).toContain('기준선이 필요')
    s().setDefectEnabled('scratch', false) // the line only matters for scratches
    expect(blockingReason(s())).toBeNull()
    s().setDefectEnabled('scratch', true)
    s().setReferenceLine({ start: [100, 200], end: [500, 210] })
    expect(blockingReason(s())).toBeNull()
    s().setLineDraft([10, 10])
    expect(blockingReason(s())).toContain('두 번째 점')
    s().setLineDraft(null)
    s().setEdgeMargin(99)
    expect(blockingReason(s())).toContain('설정 오류')
  })

  it('builds the config 1.1 contract and sends the line only when it is used', () => {
    const a = s().addRegion('include', RECT)
    const x = s().addRegion('exclude', RECT.slice(0, 3))
    s().setReferenceLine({ start: [100, 200], end: [500, 210] })
    s().setEdgeMargin(3)
    expect(buildActiveConfig(s()).reference_line).toBeNull() // orientation is "random"
    s().setScratchOrientation({ mode: 'perpendicular', jitter_deg: 2 })
    s().setScratchShading({ mode: 'local' })
    const config = buildActiveConfig(s())
    expect(generationConfigSchema.safeParse(config).success).toBe(true)
    expect(config).toMatchObject({
      version: '1.1',
      seed: 42,
      allow_overlap: false,
      edge_margin_px: 3,
      reference_line: { start: [100, 200], end: [500, 210] },
      regions: [
        { id: a, name: '영역 1', kind: 'include', polygon: RECT },
        { id: x, name: '제외 1', kind: 'exclude', polygon: RECT.slice(0, 3) },
      ],
    })
    expect(config.defects[0]).toMatchObject({ type: 'scratch', params: { orientation: { mode: 'perpendicular', jitter_deg: 2 }, shading: { mode: 'local' } } })
  })

  it('renaming a region does not mark the preview stale, editing its geometry does', () => {
    const a = s().addRegion('include', RECT)
    const before = currentConfigHash(s())
    s().renameRegion(a, '다른 이름')
    expect(currentConfigHash(s())).toBe(before)
    s().updateRegionPolygon(a, [...RECT.slice(0, 3), [101, 300]])
    expect(currentConfigHash(s())).not.toBe(before)
  })

  it('an unused reference line does not mark the preview stale', () => {
    const before = currentConfigHash(s())
    s().setReferenceLine({ start: [0, 0], end: [50, 0] })
    expect(currentConfigHash(s())).toBe(before)
    s().setScratchOrientation({ mode: 'parallel' })
    expect(currentConfigHash(s())).not.toBe(before)
  })

  it('replacing the image clears regions, selection, drafts and the line', () => {
    s().addRegion('include', RECT)
    s().setDraft([[5, 5]])
    s().setReferenceLine({ start: [0, 0], end: [50, 0] })
    s().setLineDraft([5, 5])
    s().setEdgeMargin(4)
    loadImage()
    expect(s()).toMatchObject({ regions: [], selectedRegionId: null, draft: null, referenceLine: null, lineDraft: null, tool: 'select' })
    expect(s().form.edgeMarginPx).toBe(4) // settings are kept
  })

  it('sends the 1.1 config and drops a late response after an image swap', async () => {
    s().addRegion('include', RECT)
    let resolve!: (r: Response) => void
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((r) => (resolve = r)))
    vi.stubGlobal('fetch', fetchMock)
    const pending = s().generatePreview()
    const sent = JSON.parse((fetchMock.mock.calls[0][1].body as FormData).get('config') as string)
    expect(sent.version).toBe('1.1')
    expect(sent.regions).toHaveLength(1)
    loadImage()
    resolve(new Response(JSON.stringify({}), { status: 200 }))
    await pending
    expect(s().currentResult).toBeNull()
  })
})

describe('lineAngleDeg (mirrors backend)', () => {
  it.each<[Point, Point, number]>([
    [[0, 0], [10, 0], 0],
    [[0, 0], [0, 10], 90],
    [[0, 0], [10, 10], 45],
    [[10, 0], [0, 10], 135],
  ])('%j -> %j = %d°, independent of endpoint order', (a, b, expected) => {
    expect(lineAngleDeg(a, b)).toBeCloseTo(expected, 9)
    expect(lineAngleDeg(b, a)).toBe(lineAngleDeg(a, b))
  })
})
