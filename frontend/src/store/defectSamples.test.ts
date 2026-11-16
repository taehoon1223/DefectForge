import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DefectSampleAnalysis } from '../types/generation'
import { blockingReason, currentConfigHash, describeFit, useWorkspaceStore } from './useWorkspaceStore'

const initial = useWorkspaceStore.getState()
const file = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const names = (form: FormData, key: string) => form.getAll(key).map((f) => (f as File).name)
const body = (mock: ReturnType<typeof vi.fn>, call: number) => (mock.mock.calls[call] as unknown as [string, RequestInit])[1].body as FormData

const analysis = (samples = 1): DefectSampleAnalysis => ({
  samples: Array.from({ length: samples }, (_, index) => ({
    index,
    width: 200,
    height: 160,
    image_sha256: 'a'.repeat(64),
    label_sha256: 'b'.repeat(64),
    defect_count: 2,
    class_counts: { '0': 1, '1': 1 },
  })),
  classes: [
    { id: 0, name: 'line_mark', defect_count: samples },
    { id: 1, name: 'dot', defect_count: samples },
  ],
  defects: [],
  suggestions: {
    scratch: { length_px: [72, 88], width_px: [2.7, 3.3], contrast: [0.45, 0.6], polarity: 'dark' },
    pinhole: { radius_px: [4.5, 5.5], contrast: [0.5, 0.7], polarity: 'bright' },
    contamination: { radius_px: [4.5, 12], opacity: [0.6, 0.9], polarity: 'random' },
  },
  fitted_from: { scratch: 1, pinhole: 3, contamination: 3 },
})

function loadImage() {
  useWorkspaceStore.getState().setSource(file('surface.png'), 'blob:test', { width: 512, height: 448 })
}

beforeEach(() => {
  useWorkspaceStore.setState(initial, true)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('defect samples', () => {
  it('adds a sample only after the server has analysed every sample, sent as image/label pairs', async () => {
    const fetchMock = vi.fn(async () => json(analysis(2)))
    vi.stubGlobal('fetch', fetchMock)
    await useWorkspaceStore.getState().addDefectSample(file('a.png'), file('a.txt'))
    expect(await useWorkspaceStore.getState().addDefectSample(file('b.png'), file('b.txt'))).toBe(true)

    const [url] = fetchMock.mock.calls[1] as unknown as [string]
    expect(url).toMatch(/\/api\/v1\/defect-samples\/analyze$/)
    expect(names(body(fetchMock, 1), 'defect_images')).toEqual(['a.png', 'b.png'])
    expect(names(body(fetchMock, 1), 'defect_labels')).toEqual(['a.txt', 'b.txt'])
    expect(body(fetchMock, 1).get('class_names')).toBeNull()
    const s = useWorkspaceStore.getState()
    expect(s.defectSamples.map((d) => d.label.name)).toEqual(['a.txt', 'b.txt'])
    expect(s.sampleAnalysis?.classes.map((c) => c.name)).toEqual(['line_mark', 'dot'])
    expect(s.samplesVersion).toBe(2)
    expect(s.isAnalyzingSamples).toBe(false)
  })

  it('keeps the list unchanged and shows the server message when a sample is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'INVALID_DEFECT_SAMPLE', message: '결함 샘플 1: 라벨 1번째 줄이 박스 형식입니다', details: {} } }, 422)))
    expect(await useWorkspaceStore.getState().addDefectSample(file('a.png'), file('a.txt'))).toBe(false)
    const s = useWorkspaceStore.getState()
    expect(s.defectSamples).toEqual([])
    expect(s.error).toMatchObject({ code: 'INVALID_DEFECT_SAMPLE' })
    expect(s.error?.message).toContain('박스')
  })

  it('a class-name file is re-checked with the samples and kept only when accepted', async () => {
    const fetchMock = vi.fn(async () => json(analysis()))
    vi.stubGlobal('fetch', fetchMock)
    await useWorkspaceStore.getState().addDefectSample(file('a.png'), file('a.txt'))
    expect(await useWorkspaceStore.getState().setClassNamesFile(file('data.yaml'))).toBe(true)
    expect((body(fetchMock, 1).get('class_names') as File).name).toBe('data.yaml')
    expect(useWorkspaceStore.getState()).toMatchObject({ samplesVersion: 2 })

    fetchMock.mockImplementationOnce(async () => json({ error: { code: 'INVALID_DEFECT_SAMPLE', message: '클래스 이름 파일: 중복', details: {} } }, 422))
    expect(await useWorkspaceStore.getState().setClassNamesFile(file('bad.txt'))).toBe(false)
    expect(useWorkspaceStore.getState().classNamesFile?.name).toBe('data.yaml')

    await useWorkspaceStore.getState().addDefectSample(file('b.png'), file('b.txt'))
    expect((body(fetchMock, 3).get('class_names') as File).name).toBe('data.yaml') // later analyses keep sending it
  })

  it('removing a sample re-analyses the rest, or clears the analysis when none are left', async () => {
    const fetchMock = vi.fn(async () => json(analysis()))
    vi.stubGlobal('fetch', fetchMock)
    await useWorkspaceStore.getState().addDefectSample(file('a.png'), file('a.txt'))
    await useWorkspaceStore.getState().addDefectSample(file('b.png'), file('b.txt'))
    const [first] = useWorkspaceStore.getState().defectSamples
    await useWorkspaceStore.getState().removeDefectSample(first.id)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(names(body(fetchMock, 2), 'defect_images')).toEqual(['b.png'])

    const [last] = useWorkspaceStore.getState().defectSamples
    await useWorkspaceStore.getState().removeDefectSample(last.id)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(useWorkspaceStore.getState()).toMatchObject({ defectSamples: [], sampleAnalysis: null })
  })

  it('fits only the measured keys of a rule-based type and switches it on', () => {
    const store = useWorkspaceStore.getState()
    store.setDefectEnabled('pinhole', false)
    store.setDefectParam('pinhole', 'rim_strength', 0.7)
    useWorkspaceStore.setState({ sampleAnalysis: analysis() })
    useWorkspaceStore.getState().applySampleFit('pinhole')
    const pinhole = useWorkspaceStore.getState().form.defects.pinhole
    expect(pinhole.enabled).toBe(true)
    expect(pinhole.params).toMatchObject({ radius_px: [4.5, 5.5], contrast: [0.5, 0.7], polarity: 'bright', rim_strength: 0.7, irregularity: 0.3 })
    expect(useWorkspaceStore.getState().toasts.at(-1)?.message).toBe('핀홀 설정을 샘플 결함 3개에 맞췄습니다: 반지름 4.5–5.5 px · 대비 0.5–0.7 · 극성 밝게')
  })

  it('describes a fit in words', () => {
    expect(describeFit({ length_px: [72, 88], contrast: [0.45, 0.6], polarity: 'dark' })).toBe('길이 72–88 px · 대비 0.45–0.6 · 극성 어둡게')
  })

  it('real defects need samples; samples and class names join the preview request and its fingerprint only while real is on', async () => {
    loadImage()
    const hashWithout = currentConfigHash(useWorkspaceStore.getState())
    useWorkspaceStore.setState({ samplesVersion: 5 })
    expect(currentConfigHash(useWorkspaceStore.getState())).toBe(hashWithout) // unused samples do not make a preview stale

    useWorkspaceStore.getState().setDefectEnabled('real', true)
    expect(blockingReason(useWorkspaceStore.getState())).toContain('결함 샘플을 먼저 추가')
    useWorkspaceStore.setState({ defectSamples: [{ id: 's1', image: file('a.png'), label: file('a.txt') }], classNamesFile: file('classes.txt') })
    expect(blockingReason(useWorkspaceStore.getState())).toBeNull()
    const hash = currentConfigHash(useWorkspaceStore.getState())
    useWorkspaceStore.setState({ samplesVersion: 6 })
    expect(currentConfigHash(useWorkspaceStore.getState())).not.toBe(hash)

    const fetchMock = vi.fn(async () => json({}))
    vi.stubGlobal('fetch', fetchMock)
    await useWorkspaceStore.getState().generatePreview()
    const sent = body(fetchMock, 0)
    expect(JSON.parse(sent.get('config') as string).defects.at(-1)).toMatchObject({ type: 'real', params: { rotation: 'free' } })
    expect(names(sent, 'defect_labels')).toEqual(['a.txt'])
    expect((sent.get('class_names') as File).name).toBe('classes.txt')

    useWorkspaceStore.getState().setDefectEnabled('real', false)
    await useWorkspaceStore.getState().generatePreview()
    expect(body(fetchMock, 1).getAll('defect_images')).toEqual([])
    expect(body(fetchMock, 1).get('class_names')).toBeNull()
  })
})
