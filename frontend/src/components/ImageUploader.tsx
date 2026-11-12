import { useRef, useState, type DragEvent } from 'react'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { checkDimensions, decodeImageSize, precheckFile } from '../lib/imageFile'
import { LIMITS } from '../types/generation'
import { Section } from './ui'

const SAMPLE_URL = '/samples/brushed_metal_512x448.png'

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function ImageUploader() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const sourceFile = useWorkspaceStore((s) => s.sourceFile)
  const size = useWorkspaceStore((s) => s.sourceImageSize)
  const setSource = useWorkspaceStore((s) => s.setSource)
  const setError = useWorkspaceStore((s) => s.setError)
  const pushToast = useWorkspaceStore((s) => s.pushToast)

  const accept = async (file: File) => {
    const problem = precheckFile(file)
    if (problem) {
      pushToast('error', problem)
      setError({ code: 'CLIENT_VALIDATION', message: problem })
      return
    }
    setLoading(true)
    const url = URL.createObjectURL(file)
    try {
      const dims = await decodeImageSize(url)
      const dimProblem = checkDimensions(dims.width, dims.height)
      if (dimProblem) throw new Error(dimProblem)
      setSource(file, url, dims)
    } catch (error) {
      URL.revokeObjectURL(url)
      const message = error instanceof Error && error.message !== 'decode' ? error.message : '이미지를 디코딩할 수 없습니다. 파일이 손상되었거나 이미지가 아닙니다.'
      pushToast('error', message)
      setError({ code: 'CLIENT_VALIDATION', message })
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void accept(file)
  }

  const loadSample = async () => {
    try {
      const response = await fetch(SAMPLE_URL)
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      await accept(new File([blob], 'brushed_metal_512x448.png', { type: 'image/png' }))
    } catch {
      pushToast('error', '예시 이미지를 불러오지 못했습니다.')
    }
  }

  return (
    <Section
      title="이미지"
      aside={
        <button type="button" className="text-[11px] text-accent hover:underline" onClick={loadSample} data-testid="load-sample">
          예시 이미지
        </button>
      }
    >
      <div
        role="button"
        tabIndex={0}
        data-testid="dropzone"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed px-3 text-center transition-colors ${
          sourceFile ? 'py-2.5' : 'py-6'
        } ${dragging ? 'border-accent bg-accent/10' : 'border-line-strong bg-bg hover:border-faint'}`}
      >
        {loading ? (
          <span className="text-muted">이미지 확인 중…</span>
        ) : sourceFile ? (
          <>
            <span className="max-w-full truncate font-medium text-ink" title={sourceFile.name} data-testid="source-name">
              {sourceFile.name}
            </span>
            <span className="num text-[11px] text-muted" data-testid="source-meta">
              {size && `${size.width} × ${size.height} px`} · {formatBytes(sourceFile.size)}
            </span>
            <span className="text-[11px] text-faint">클릭 또는 드롭하여 교체</span>
          </>
        ) : (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-faint" aria-hidden>
              <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <span className="font-medium text-ink">정상 이미지를 드롭하거나 클릭</span>
            <span className="text-[11px] text-muted">PNG · JPEG · WebP · 최대 10 MiB · 32–2048 px</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={[...LIMITS.image.acceptedMimeTypes, ...LIMITS.image.acceptedExtensions].join(',')}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void accept(file)
        }}
      />
    </Section>
  )
}
