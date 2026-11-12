import { useState } from 'react'
import { currentConfigHash, useWorkspaceStore, type ErrorInfo } from '../store/useWorkspaceStore'
import { ExportButton } from './ExportPanel'
import { Spinner } from './ui'

function detailLines(error: ErrorInfo): string[] {
  const d = error.details ?? {}
  if (Array.isArray(d.errors)) {
    return (d.errors as Array<{ field: string; message: string }>).map((e) => `${e.field}: ${e.message}`)
  }
  if (d.rejections && typeof d.rejections === 'object') {
    const labels: Record<string, string> = { out_of_image: '이미지 경계', outside_roi: 'ROI 밖', overlap: '겹침', no_visible_change: '변화 없음' }
    return [
      `거절 사유(${d.attempts}회 시도): ` +
        Object.entries(d.rejections as Record<string, number>)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${labels[k] ?? k} ${n}`)
          .join(' · '),
    ]
  }
  return []
}

export function StatusBar() {
  const [showDetails, setShowDetails] = useState(false)
  const hasImage = useWorkspaceStore((s) => !!s.sourceFile)
  const isGenerating = useWorkspaceStore((s) => s.isGenerating)
  const isExporting = useWorkspaceStore((s) => s.isExporting)
  const exportCount = useWorkspaceStore((s) => s.exportCount)
  const result = useWorkspaceStore((s) => s.currentResult)
  const stale = useWorkspaceStore((s) => s.currentResult !== null && s.currentResultConfigHash !== currentConfigHash(s))
  const error = useWorkspaceStore((s) => s.error)
  const setError = useWorkspaceStore((s) => s.setError)
  const lines = error ? detailLines(error) : []

  let tone = 'bg-faint'
  let text = '이미지를 업로드하세요'
  if (isExporting) {
    tone = 'bg-accent animate-pulse'
    text = `데이터셋 ${exportCount}장 생성·압축 중…`
  } else if (isGenerating) {
    tone = 'bg-accent animate-pulse'
    text = '합성 이미지와 마스크 생성 중…'
  } else if (result && stale) {
    tone = 'bg-warn'
    text = '설정이 변경되었습니다 · 다시 생성하세요'
  } else if (result) {
    const m = result.metadata
    tone = 'bg-ok'
    text = `미리보기 완료 · 결함 ${m.generated_count}/${m.requested_count} · ${result.processing_ms.toFixed(0)} ms`
  } else if (hasImage) {
    tone = 'bg-accent'
    text = '준비됨 · ‘생성 미리보기’를 누르세요'
  }

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-panel px-4 py-2" data-testid="status-bar">
      <div className="flex min-w-0 items-center gap-2 text-[12px]" role="status" data-testid="status-text">
        {isGenerating || isExporting ? <Spinner className="text-accent" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />}
        <span className={stale && !isGenerating ? 'text-warn' : 'text-ink'}>{text}</span>
      </div>

      {error && (
        <div className="flex min-w-0 flex-1 items-start gap-2 rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px]" role="alert" data-testid="error-message">
          <span className="font-semibold text-danger">오류</span>
          <div className="min-w-0 flex-1">
            <p className="text-ink">{error.message}</p>
            {showDetails && lines.length > 0 && (
              <ul className="num mt-1 text-[11px] text-muted">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
          <span className="num shrink-0 text-[10px] text-faint" data-testid="error-code">
            {error.code}
          </span>
          {lines.length > 0 && (
            <button type="button" className="shrink-0 text-[11px] text-muted hover:text-ink" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? '접기' : '자세히'}
            </button>
          )}
          <button type="button" className="shrink-0 text-muted hover:text-ink" aria-label="오류 닫기" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="ml-auto">
        <ExportButton />
      </div>
    </footer>
  )
}
