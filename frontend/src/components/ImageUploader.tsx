import { useRef, useState, type DragEvent } from 'react'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { checkDimensions, decodeImageSize, precheckFile } from '../lib/imageFile'
import { LIMITS } from '../types/generation'
import { Section } from './ui'

const SAMPLE_URL = '/samples/brushed_metal_512x448.png'
const PART_SAMPLE_URL = '/samples/part_synthetic_640x400.png'

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

  const loadSample = async (url: string) => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      await accept(new File([blob], url.split('/').pop() ?? 'sample.png', { type: 'image/png' }))
    } catch {
      pushToast('error', '예시 이미지를 불러오지 못했습니다.')
    }
  }

  return (
    <Section
      title="이미지"
      aside={
        <span className="flex items-center gap-2 text-[11px]">
          <span className="text-faint">예시</span>
          <button type="button" className="link" onClick={() => loadSample(SAMPLE_URL)} title="절차적으로 만든 금속 표면 합성 이미지" data-testid="load-sample">
            금속
          </button>
          <button type="button" className="link" onClick={() => loadSample(PART_SAMPLE_URL)} title="절차적으로 만든 칩 부품 형태의 합성 이미지 (실제 부품 사진 아님)" data-testid="load-sample-part">
            부품
          </button>
        </span>
      }
    >
      <div
        role="button"
        tabIndex={0}
        data-testid="dropzone"
        title="클릭하거나 파일을 끌어다 놓으세요"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`-mx-1 cursor-pointer rounded-[2px] px-1 py-1 transition-colors ${dragging ? 'bg-raised outline outline-1 outline-muted' : 'hover:bg-[#2a2a2a]'} ${
          sourceFile ? '' : 'border border-dashed border-line-strong py-5 text-center'
        }`}
      >
        {loading ? (
          <span className="text-muted">이미지 확인 중…</span>
        ) : sourceFile ? (
          <div className="grid gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-ink" title={sourceFile.name} data-testid="source-name">
                {sourceFile.name}
              </span>
              <span className="shrink-0 text-[11px] text-faint">교체</span>
            </div>
            <span className="num text-[11px] text-muted" data-testid="source-meta">
              {size && `${size.width} × ${size.height} px`} · {formatBytes(sourceFile.size)}
            </span>
          </div>
        ) : (
          <>
            <span className="block text-ink">정상 이미지를 끌어다 놓거나 클릭</span>
            <span className="mt-0.5 block text-[11px] text-faint">PNG · JPEG · WebP · 최대 10 MiB · 32–2048 px</span>
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
