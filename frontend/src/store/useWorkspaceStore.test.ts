import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewResponse } from '../types/generation'
import { blockingReason, currentConfigHash, useWorkspaceStore } from './useWorkspaceStore'

const initial = useWorkspaceStore.getState()
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'surface.png', { type: 'image/png' })

const fakeResult = (): PreviewResponse => ({
  image_png_base64: 'IMG',
  class_mask_png_base64: 'CLS',
  binary_mask_png_base64: 'BIN',
  processing_ms: 12,
  metadata: {
    version: '1.1',
    engine_version: '1.1.0',
    seed: 42,
    source_sha256: 'a'.repeat(64),
    width: 512,
    height: 448,
    class_map: { '0': 'background', '1': 'scratch', '2': 'pinhole', '3': 'contamination' },
    bbox_format: 'xyxy_inclusive',
    allow_overlap: false,
    requested_count: 7,
    generated_count: 7,
    changed_pixel_count: 100,
    class_pixel_counts: { scratch: 10, pinhole: 20, contamination: 70, texture: 0, patch: 0 },
    instances: [],
    config: { version: '1.1', seed: 42, allow_overlap: false, regions: [], edge_margin_px: 0, reference_line: null, defects: [] },
    area: { full_image: true, edge_margin_px: 0, include_pixel_count: 512 * 448, excluded_pixel_count: 0, allowed_pixel_count: 512 * 448, regions: [] },
    reference_line: null,
    surface_analysis: null,
    algorithm_versions: {},
  },
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function loadImage() {
  useWorkspaceStore.getState().setSource(png(), 'blob:test', { width: 512, height: 448 })
}

beforeEach(() => {
  useWorkspaceStore.setState(initial, true)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('workspace store', () => {
  it('T13: changing overlay opacity never touches the generated result', () => {
    const result = fakeResult()
    const snapshot = JSON.stringify(result)
    useWorkspaceStore.setState({ currentResult: result })
    for (const value of [0, 0.25, 1, 1.5, -1]) useWorkspaceStore.getState().setOverlayOpacity(value)
    expect(useWorkspaceStore.getState().currentResult).toBe(result)
    expect(JSON.stringify(useWorkspaceStore.getState().currentResult)).toBe(snapshot)
    expect(useWorkspaceStore.getState().overlayOpacity).toBe(0)
  })

  it('replacing the image resets regions, preview and error', () => {
    loadImage()
    useWorkspaceStore.getState().addRegion('include', [
      [1, 1],
      [9, 1],
      [9, 9],
    ])
    useWorkspaceStore.setState({
      currentResult: fakeResult(),
      currentResultConfigHash: 'x',
      error: { code: 'X', message: 'old' },
      viewMode: 'overlay',
    })
    const version = useWorkspaceStore.getState().sourceVersion
    loadImage()
    const s = useWorkspaceStore.getState()
    expect(s.sourceVersion).toBe(version + 1)
    expect(s).toMatchObject({ regions: [], draft: null, currentResult: null, currentResultConfigHash: null, error: null, viewMode: 'original' })
  })

  it('blocks generation without an image, while drawing, with an invalid region or invalid form', () => {
    expect(blockingReason(useWorkspaceStore.getState())).toContain('이미지')
    loadImage()
    expect(blockingReason(useWorkspaceStore.getState())).toBeNull()
    useWorkspaceStore.setState({ draft: [[1, 1]] })
    expect(blockingReason(useWorkspaceStore.getState())).toContain('그리기를 완료')
    useWorkspaceStore.setState({ draft: null })
    const id = useWorkspaceStore.getState().addRegion('include', [
      [10, 10],
      [100, 100],
      [100, 10],
      [10, 100],
    ])
    expect(blockingReason(useWorkspaceStore.getState())).toContain('교차')
    useWorkspaceStore.getState().deleteRegion(id)
    useWorkspaceStore.getState().setDefectCount('scratch', 0)
    expect(blockingReason(useWorkspaceStore.getState())).toContain('설정 오류')
  })

  it('sends multipart file + config JSON and stores the result; later edits mark it stale', async () => {
    loadImage()
    useWorkspaceStore.getState().addRegion('include', [
      [40, 40],
      [460, 40],
      [460, 400],
    ])
    const fetchMock = vi.fn(async () => json(fakeResult()))
    vi.stubGlobal('fetch', fetchMock)
    await useWorkspaceStore.getState().generatePreview()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/preview$/)
    const body = init.body as FormData
    expect((body.get('file') as File).name).toBe('surface.png')
    const config = JSON.parse(body.get('config') as string)
    expect(config).toMatchObject({ version: '1.1', seed: 42, allow_overlap: false, edge_margin_px: 0, reference_line: null })
    expect(config.regions.map((r: { kind: string; polygon: number[][] }) => [r.kind, r.polygon])).toEqual([
      [
        'include',
        [
          [40, 40],
          [460, 40],
          [460, 400],
        ],
      ],
    ])
    expect(config.defects.map((d: { type: string }) => d.type)).toEqual(['scratch', 'pinhole', 'contamination'])

    let s = useWorkspaceStore.getState()
    expect(s.currentResult?.image_png_base64).toBe('IMG')
    expect(s.isGenerating).toBe(false)
    expect(s.viewMode).toBe('overlay')
    expect(s.currentResultConfigHash).toBe(currentConfigHash(s))

    s.setDefectParam('scratch', 'curvature', 0.9)
    s = useWorkspaceStore.getState()
    expect(s.currentResultConfigHash).not.toBe(currentConfigHash(s))
  })

  it('keeps every setting when the server rejects the request', async () => {
    loadImage()
    useWorkspaceStore.getState().setSeed(777)
    const formBefore = JSON.stringify(useWorkspaceStore.getState().form)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'DEFECT_PLACEMENT_FAILED', message: '배치하지 못했습니다.', details: { attempts: 100 } } }, 422)),
    )
    await useWorkspaceStore.getState().generatePreview()
    const s = useWorkspaceStore.getState()
    expect(s.error).toMatchObject({ code: 'DEFECT_PLACEMENT_FAILED', message: '배치하지 못했습니다.' })
    expect(JSON.stringify(s.form)).toBe(formBefore)
    expect(s.isGenerating).toBe(false)
  })

  it('reports an unreachable backend in Korean', async () => {
    loadImage()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await useWorkspaceStore.getState().generatePreview()
    expect(useWorkspaceStore.getState().error?.code).toBe('NETWORK_ERROR')
    expect(useWorkspaceStore.getState().error?.message).toContain('연결할 수 없습니다')
  })

  it('drops a late response once the image has been replaced (and aborts the request)', async () => {
    loadImage()
    let resolve!: (r: Response) => void
    let seenSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        seenSignal = init.signal ?? undefined
        return new Promise<Response>((r) => (resolve = r))
      }),
    )
    const pending = useWorkspaceStore.getState().generatePreview()
    expect(useWorkspaceStore.getState().isGenerating).toBe(true)
    loadImage() // user swaps the image mid-request
    expect(seenSignal?.aborted).toBe(true)
    resolve(json(fakeResult()))
    await pending
    const s = useWorkspaceStore.getState()
    expect(s.currentResult).toBeNull()
    expect(s.isGenerating).toBe(false)
  })

  it('exports a ZIP with sample_count and triggers a download', async () => {
    loadImage()
    useWorkspaceStore.getState().setExportCount(10)
    const fetchMock = vi.fn(
      async () => new Response(new Blob([new Uint8Array([80, 75, 3, 4])]), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="defectforge_dataset.zip"' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await useWorkspaceStore.getState().exportDataset()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/export$/)
    expect((init.body as FormData).get('sample_count')).toBe('10')
    expect(click).toHaveBeenCalledOnce()
    expect(useWorkspaceStore.getState().toasts.at(-1)?.message).toContain('10장')
  })

  it('refuses export counts outside 1..20 before calling the server', async () => {
    loadImage()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useWorkspaceStore.getState().setExportCount(21)
    await useWorkspaceStore.getState().exportDataset()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().error?.message).toContain('1~20')
  })
})
