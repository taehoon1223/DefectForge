import { create } from 'zustand'
import { ApiError, isAbortError, requestExport, requestPreview, triggerDownload } from '../api/client'
import { validateRoi } from '../lib/geometry'
import {
  buildGenerationConfig,
  defaultFormState,
  fingerprint,
  LIMITS,
  validateForm,
  type DefectType,
  type FormState,
  type ParamsByType,
  type Point,
  type PreviewResponse,
  type ViewMode,
} from '../types/generation'

export type Tool = 'select' | 'draw'
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
  roi: Point[] | null
  roiDraft: Point[] | null
  tool: Tool
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
  setRoi: (roi: Point[] | null) => void
  setRoiDraft: (draft: Point[] | null) => void
  setDefectEnabled: (type: DefectType, enabled: boolean) => void
  setDefectCount: (type: DefectType, count: number) => void
  setDefectParam: <K extends DefectType>(type: K, key: keyof ParamsByType[K], value: ParamsByType[K][keyof ParamsByType[K]]) => void
  setSeed: (seed: number) => void
  randomizeSeed: () => void
  setAllowOverlap: (allow: boolean) => void
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

let previewController: AbortController | null = null
let exportController: AbortController | null = null
let toastSeq = 0

/** Fingerprint of everything that determines a preview: image identity + request config. */
export function currentConfigHash(state: Pick<WorkspaceState, 'form' | 'roi' | 'sourceVersion'>): string {
  return fingerprint({ source: state.sourceVersion, config: buildGenerationConfig(state.form, state.roi) })
}

/** Reason generation/export is blocked, or null when ready. */
export function blockingReason(state: Pick<WorkspaceState, 'sourceFile' | 'sourceImageSize' | 'form' | 'roi' | 'roiDraft'>): string | null {
  if (!state.sourceFile || !state.sourceImageSize) return '이미지를 먼저 업로드하세요.'
  if (state.roiDraft) return 'ROI 그리기를 완료(Enter / 첫 점 클릭)하거나 취소(Esc)하세요.'
  if (state.roi) {
    const roiError = validateRoi(state.roi, state.sourceImageSize, LIMITS.roiMaxPoints)
    if (roiError) return roiError
  }
  const errors = validateForm(state.form)
  const first = Object.values(errors)[0]
  return first ? `설정 오류: ${first}` : null
}

function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ApiError) return { code: error.code, message: error.message, details: error.details }
  return { code: 'CLIENT_ERROR', message: '알 수 없는 오류가 발생했습니다.' }
}

function updateDefect<K extends DefectType>(form: FormState, type: K, patch: Partial<FormState['defects'][K]>): FormState {
  return { ...form, defects: { ...form.defects, [type]: { ...form.defects[type], ...patch } } }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  sourceFile: null,
  sourceUrl: null,
  sourceImageSize: null,
  sourceVersion: 0,
  roi: null,
  roiDraft: null,
  tool: 'select',
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
      roi: null,
      roiDraft: null,
      tool: 'select',
      currentResult: null,
      currentResultConfigHash: null,
      viewMode: 'original',
      isGenerating: false,
      isExporting: false,
      error: null,
    }))
  },
  setTool: (tool) => set({ tool }),
  setRoi: (roi) => set({ roi }),
  setRoiDraft: (roiDraft) => set({ roiDraft }),
  setDefectEnabled: (type, enabled) => set((s) => ({ form: updateDefect(s.form, type, { enabled }) })),
  setDefectCount: (type, count) => set((s) => ({ form: updateDefect(s.form, type, { count }) })),
  setDefectParam: (type, key, value) =>
    set((s) => {
      const entry = s.form.defects[type]
      const next = { ...entry, params: { ...entry.params, [key]: value } } as typeof entry
      return { form: { ...s.form, defects: { ...s.form.defects, [type]: next } } }
    }),
  setSeed: (seed) => set((s) => ({ form: { ...s.form, seed } })),
  randomizeSeed: () => set((s) => ({ form: { ...s.form, seed: Math.floor(Math.random() * 1_000_000) } })),
  setAllowOverlap: (allowOverlap) => set((s) => ({ form: { ...s.form, allowOverlap } })),
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
    const config = buildGenerationConfig(state.form, state.roi)
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
    const config = buildGenerationConfig(state.form, state.roi)
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
