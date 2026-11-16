import type { DefectSample, DefectSampleAnalysis, GenerationConfig, PreviewResponse } from '../types/generation'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

const STATUS_MESSAGES: Record<number, string> = {
  400: '요청 형식이 올바르지 않습니다.',
  413: '업로드 파일이 너무 큽니다.',
  422: '입력값을 처리할 수 없습니다.',
  429: '서버가 바쁩니다. 잠시 후 다시 시도하세요.',
  500: '서버 내부 오류가 발생했습니다.',
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError('NETWORK_ERROR', `백엔드 서버(${API_BASE_URL})에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.`, 0)
  }
  if (response.ok) return response

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // non-JSON error body
  }
  const err = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error
  throw new ApiError(
    err?.code ?? `HTTP_${response.status}`,
    err?.message ?? STATUS_MESSAGES[response.status] ?? `요청이 실패했습니다 (HTTP ${response.status}).`,
    response.status,
    err?.details ?? {},
  )
}

/** Real-defect samples (image + YOLO label txt) and the optional classes.txt / data.yaml. */
export type DefectSampleUpload = { samples: DefectSample[]; classNames: File | null }

function formData(file: File, config: GenerationConfig, upload: DefectSampleUpload): FormData {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('config', JSON.stringify(config))
  // Real-defect samples travel with the request only when the config uses them.
  if (config.defects.some((d) => d.type === 'real')) appendDefectSamples(form, upload)
  return form
}

function appendDefectSamples(form: FormData, { samples, classNames }: DefectSampleUpload): void {
  for (const sample of samples) {
    form.append('defect_images', sample.image, sample.image.name)
    form.append('defect_labels', sample.label, sample.label.name)
  }
  if (classNames) form.append('class_names', classNames, classNames.name)
}

export async function fetchHealth(signal?: AbortSignal): Promise<{ status: string; version: string }> {
  const response = await request('/api/v1/health', { signal })
  return response.json()
}

export async function requestPreview(file: File, config: GenerationConfig, upload: DefectSampleUpload, signal?: AbortSignal): Promise<PreviewResponse> {
  const response = await request('/api/v1/preview', { method: 'POST', body: formData(file, config, upload), signal })
  return response.json()
}

/** Measures every defect in the samples and suggests rule-based parameters (backend core/samples.py). */
export async function requestSampleAnalysis(upload: DefectSampleUpload, signal?: AbortSignal): Promise<DefectSampleAnalysis> {
  const form = new FormData()
  appendDefectSamples(form, upload)
  const response = await request('/api/v1/defect-samples/analyze', { method: 'POST', body: form, signal })
  return response.json()
}

export async function requestExport(
  file: File,
  config: GenerationConfig,
  sampleCount: number,
  upload: DefectSampleUpload,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const form = formData(file, config, upload)
  form.append('sample_count', String(sampleCount))
  const response = await request('/api/v1/export', { method: 'POST', body: form, signal })
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'defectforge_dataset.zip'
  return { blob: await response.blob(), filename }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
