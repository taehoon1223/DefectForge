import { create } from 'zustand'
import { ApiError, isAbortError, requestExport, requestPreview, triggerDownload } from '../api/client'
import { validateRoi } from '../lib/geometry'
import {
  buildGenerationConfig,
  defaultFormState,
  fingerprint,
  LIMITS,
  lineAngleDeg,
  needsReferenceLine,
  REGION_KIND_LABELS,
  resultDeterminingConfig,
  validateForm,
  type DefectType,
  type FormState,
  type GenerationConfig,
  type ParamsByType,
  type Point,
  type PreviewResponse,
  type ReferenceLine,
  type Region,
  type RegionKind,
  type ScratchParams,
  type ViewMode,
} from '../types/generation'

/** select = pan / edit, draw = add polygon points, line = place the two reference-line points. */
export type Tool = 'select' | 'draw' | 'line'
export type ErrorInfo = { code: string; message: string; details?: Record<string, unknown> }
export type ToastKind = 'success' | 'error' | 'info'
export type ToastItem = { id: number; kind: ToastKind; message: string }
export type ImageSize = { width: number; height: number }

export type WorkspaceState = {
  sourceFile: File | null
  sourceUrl: string | null
  sourceImageSize: ImageSize | null
  /** Incremented on every image replacement; responses for older versions are discarded. */
  sourceVersion: number
  tool: Tool
  regions: Region[]
  selectedRegionId: string | null
  /** Polygon being drawn and the kind of region it will become. */
  draft: Point[] | null
  drawKind: RegionKind
  referenceLine: ReferenceLine | null
  lineDraft: Point | null
  form: FormState
  exportCount: number
  currentResult: PreviewResponse | null
  currentResultConfigHash: string | null
  viewMode: ViewMode
  overlayOpacity: number
  isGenerating: boolean
  isExporting: boolean
  error: ErrorInfo | null
  toasts: ToastItem[]

  setSource: (file: File, url: string, size: ImageSize) => void
  setTool: (tool: Tool) => void
  setDrawKind: (kind: RegionKind) => void
  setDraft: (draft: Point[] | null) => void
  addRegion: (kind: RegionKind, polygon: Point[]) => string
  renameRegion: (id: string, name: string) => void
  updateRegionPolygon: (id: string, polygon: Point[]) => void
  deleteRegion: (id: string) => void
  selectRegion: (id: string | null) => void
  setReferenceLine: (line: ReferenceLine | null) => void
  setLineDraft: (point: Point | null) => void
  setDefectEnabled: (type: DefectType, enabled: boolean) => void
  setDefectCount: (type: DefectType, count: number) => void
  setDefectParam: <K extends DefectType>(type: K, key: keyof ParamsByType[K], value: ParamsByType[K][keyof ParamsByType[K]]) => void
  setScratchOrientation: (patch: Partial<ScratchParams['orientation']>) => void
  setScratchShading: (patch: Partial<ScratchParams['shading']>) => void
  setSeed: (seed: number) => void
  randomizeSeed: () => void
  setAllowOverlap: (allow: boolean) => void
  setEdgeMargin: (px: number) => void
  resetDefaults: () => void
  setViewMode: (mode: ViewMode) => void
  setOverlayOpacity: (opacity: number) => void
  setExportCount: (count: number) => void
  setError: (error: ErrorInfo | null) => void
  pushToast: (kind: ToastKind, message: string) => void
  dismissToast: (id: number) => void
  generatePreview: () => Promise<void>
  exportDataset: () => Promise<void>
}

type ConfigState = Pick<WorkspaceState, 'form' | 'regions' | 'referenceLine'>

let previewController: AbortController | null = null
let exportController: AbortController | null = null
let toastSeq = 0
let regionSeq = 0

export function buildActiveConfig(state: ConfigState): GenerationConfig {
  return buildGenerationConfig(state.form, state.regions, state.referenceLine)
}

/** Fingerprint of everything that determines a preview: image identity + request config (minus display names). */
export function currentConfigHash(state: ConfigState & Pick<WorkspaceState, 'sourceVersion'>): string {
  return fingerprint({ source: state.sourceVersion, config: resultDeterminingConfig(buildActiveConfig(state)) })
}

/** Reason generation/export is blocked, or null when ready. */
export function blockingReason(
  state: ConfigState & Pick<WorkspaceState, 'sourceFile' | 'sourceImageSize' | 'draft' | 'drawKind' | 'lineDraft'>,
): string | null {
  const size = state.sourceImageSize
  if (!state.sourceFile || !size) return '이미지를 먼저 업로드하세요.'
  if (state.draft) return `${REGION_KIND_LABELS[state.drawKind]} 그리기를 완료(Enter / 첫 점 클릭)하거나 취소(Esc)하세요.`
  if (state.lineDraft) return '기준선의 두 번째 점을 찍거나 Esc로 취소하세요.'
  for (const region of state.regions) {
    if (!region.name.trim()) return '영역 이름을 입력하세요.'
    const problem = validateRoi(region.polygon, size, LIMITS.roiMaxPoints, `영역 '${region.name}'`)
    if (problem) return problem
  }
  const first = Object.values(validateForm(state.form))[0]
  if (first) return `설정 오류: ${first}`
  if (needsReferenceLine(state.form) && !state.referenceLine) {
    return '스크래치 방향 ‘기준선’에는 기준선이 필요합니다. ‘기준선 그리기’로 두 점을 찍거나 다른 방향을 고르세요.'
  }
  return null
}

export function nextRegionName(kind: RegionKind, regions: Region[]): string {
  const taken = new Set(regions.map((r) => r.name))
  const base = kind === 'include' ? '영역' : '제외'
  for (let i = 1; ; i++) {
    if (!taken.has(`${base} ${i}`)) return `${base} ${i}`
  }
}

export function lineAngle(line: ReferenceLine | null): number | null {
  return line ? lineAngleDeg(line.start, line.end) : null
}

function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ApiError) return { code: error.code, message: error.message, details: error.details }
  return { code: 'CLIENT_ERROR', message: '알 수 없는 오류가 발생했습니다.' }
}

function updateDefect<K extends DefectType>(form: FormState, type: K, patch: Partial<FormState['defects'][K]>): FormState {
  return { ...form, defects: { ...form.defects, [type]: { ...form.defects[type], ...patch } } }
}

function updateScratchParams(form: FormState, patch: Partial<ScratchParams>): FormState {
  const scratch = form.defects.scratch
  return updateDefect(form, 'scratch', { params: { ...scratch.params, ...patch } })
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  sourceFile: null,
  sourceUrl: null,
  sourceImageSize: null,
  sourceVersion: 0,
  tool: 'select',
  regions: [],
  selectedRegionId: null,
  draft: null,
  drawKind: 'include',
  referenceLine: null,
  lineDraft: null,
  form: defaultFormState(),
  exportCount: LIMITS.exportCount.default,
  currentResult: null,
  currentResultConfigHash: null,
  viewMode: 'original',
  overlayOpacity: 0.6,
  isGenerating: false,
  isExporting: false,
  error: null,
  toasts: [],

  setSource: (file, url, size) => {
    // A new image invalidates everything tied to the old one, including in-flight requests.
    previewController?.abort()
    exportController?.abort()
    const previousUrl = get().sourceUrl
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    set((s) => ({
      sourceFile: file,
      sourceUrl: url,
      sourceImageSize: size,
      sourceVersion: s.sourceVersion + 1,
      tool: 'select',
      regions: [],
      selectedRegionId: null,
      draft: null,
      referenceLine: null,
      lineDraft: null,
      currentResult: null,
      currentResultConfigHash: null,
      viewMode: 'original',
      isGenerating: false,
      isExporting: false,
      error: null,
    }))
  },
  setTool: (tool) => set({ tool }),
  setDrawKind: (drawKind) => set({ drawKind }),
  setDraft: (draft) => set({ draft }),
  addRegion: (kind, polygon) => {
    const id = `region-${++regionSeq}`
    set((s) => ({ regions: [...s.regions, { id, name: nextRegionName(kind, s.regions), kind, polygon }], selectedRegionId: id }))
    return id
  },
  renameRegion: (id, name) => set((s) => ({ regions: s.regions.map((r) => (r.id === id ? { ...r, name } : r)) })),
  updateRegionPolygon: (id, polygon) => set((s) => ({ regions: s.regions.map((r) => (r.id === id ? { ...r, polygon } : r)) })),
  deleteRegion: (id) =>
    set((s) => ({ regions: s.regions.filter((r) => r.id !== id), selectedRegionId: s.selectedRegionId === id ? null : s.selectedRegionId })),
  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setReferenceLine: (referenceLine) => set({ referenceLine }),
  setLineDraft: (lineDraft) => set({ lineDraft }),
  setDefectEnabled: (type, enabled) => set((s) => ({ form: updateDefect(s.form, type, { enabled }) })),
  setDefectCount: (type, count) => set((s) => ({ form: updateDefect(s.form, type, { count }) })),
  setDefectParam: (type, key, value) =>
    set((s) => {
      const entry = s.form.defects[type]
      const next = { ...entry, params: { ...entry.params, [key]: value } } as typeof entry
      return { form: { ...s.form, defects: { ...s.form.defects, [type]: next } } }
    }),
  setScratchOrientation: (patch) =>
    set((s) => ({ form: updateScratchParams(s.form, { orientation: { ...s.form.defects.scratch.params.orientation, ...patch } }) })),
  setScratchShading: (patch) => set((s) => ({ form: updateScratchParams(s.form, { shading: { ...s.form.defects.scratch.params.shading, ...patch } }) })),
  setSeed: (seed) => set((s) => ({ form: { ...s.form, seed } })),
  randomizeSeed: () => set((s) => ({ form: { ...s.form, seed: Math.floor(Math.random() * 1_000_000) } })),
  setAllowOverlap: (allowOverlap) => set((s) => ({ form: { ...s.form, allowOverlap } })),
  setEdgeMargin: (edgeMarginPx) => set((s) => ({ form: { ...s.form, edgeMarginPx } })),
  resetDefaults: () => set((s) => ({ form: { ...defaultFormState(), seed: s.form.seed } })),
  setViewMode: (viewMode) => set({ viewMode }),
  setOverlayOpacity: (overlayOpacity) => set({ overlayOpacity: Math.min(1, Math.max(0, overlayOpacity)) }),
  setExportCount: (exportCount) => set({ exportCount }),
  setError: (error) => set({ error }),
  pushToast: (kind, message) => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  generatePreview: async () => {
    const state = get()
    const blocked = blockingReason(state)
    if (blocked || !state.sourceFile || state.isGenerating) {
      if (blocked) set({ error: { code: 'CLIENT_VALIDATION', message: blocked } })
      return
    }
    const version = state.sourceVersion
    const config = buildActiveConfig(state)
    const hash = currentConfigHash(state)
    previewController?.abort()
    const controller = new AbortController()
    previewController = controller
    set({ isGenerating: true, error: null })
    try {
      const result = await requestPreview(state.sourceFile, config, controller.signal)
      if (get().sourceVersion !== version) return // image replaced meanwhile: drop stale result
      set((s) => ({
        currentResult: result,
        currentResultConfigHash: hash,
        viewMode: s.viewMode === 'original' ? 'overlay' : s.viewMode,
      }))
    } catch (error) {
      if (isAbortError(error) || get().sourceVersion !== version) return
      set({ error: toErrorInfo(error) }) // settings are untouched, so the user can fix and retry
    } finally {
      if (previewController === controller) {
        previewController = null
        if (get().sourceVersion === version) set({ isGenerating: false })
      }
    }
  },

  exportDataset: async () => {
    const state = get()
    const blocked = blockingReason(state)
    const count = state.exportCount
    if (!Number.isInteger(count) || count < LIMITS.exportCount.min || count > LIMITS.exportCount.max) {
      set({ error: { code: 'CLIENT_VALIDATION', message: `생성 장수는 ${LIMITS.exportCount.min}~${LIMITS.exportCount.max} 사이의 정수여야 합니다.` } })
      return
    }
    if (blocked || !state.sourceFile || state.isExporting) {
      if (blocked) set({ error: { code: 'CLIENT_VALIDATION', message: blocked } })
      return
    }
    const version = state.sourceVersion
    const config = buildActiveConfig(state)
    exportController?.abort()
    const controller = new AbortController()
    exportController = controller
    set({ isExporting: true, error: null })
    try {
      const { blob, filename } = await requestExport(state.sourceFile, config, count, controller.signal)
      if (get().sourceVersion !== version) return
      triggerDownload(blob, filename)
      get().pushToast('success', `데이터셋 ${count}장을 ZIP으로 내려받았습니다 (${(blob.size / 1024 / 1024).toFixed(2)} MB).`)
    } catch (error) {
      if (isAbortError(error) || get().sourceVersion !== version) return
      set({ error: toErrorInfo(error) })
    } finally {
      if (exportController === controller) {
        exportController = null
        if (get().sourceVersion === version) set({ isExporting: false })
      }
    }
  },
}))
