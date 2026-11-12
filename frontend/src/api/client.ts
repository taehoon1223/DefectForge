import type { GenerationConfig, PreviewResponse } from '../types/generation'

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

function formData(file: File, config: GenerationConfig): FormData {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('config', JSON.stringify(config))
  return form
}

export async function fetchHealth(signal?: AbortSignal): Promise<{ status: string; version: string }> {
  const response = await request('/api/v1/health', { signal })
  return response.json()
}

export async function requestPreview(file: File, config: GenerationConfig, signal?: AbortSignal): Promise<PreviewResponse> {
  const response = await request('/api/v1/preview', { method: 'POST', body: formData(file, config), signal })
  return response.json()
}

export async function requestExport(
  file: File,
  config: GenerationConfig,
  sampleCount: number,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const form = formData(file, config)
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
