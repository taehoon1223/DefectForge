import { blockingReason, useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS } from '../types/generation'
import { FieldError, NumberField, Row, Section, Spinner } from './ui'

function countError(count: number): string | undefined {
  const { min, max } = LIMITS.exportCount
  return Number.isInteger(count) && count >= min && count <= max ? undefined : `${min}~${max} 사이의 정수를 입력하세요`
}

/** Right-panel ZIP options. */
export function ExportPanel() {
  const count = useWorkspaceStore((s) => s.exportCount)
  const setCount = useWorkspaceStore((s) => s.setExportCount)
  const seed = useWorkspaceStore((s) => s.form.seed)
  const error = countError(count)
  const { min, max } = LIMITS.exportCount

  return (
    <Section title="내보내기" testId="export-panel">
      <Row label="장수">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Number.isFinite(count) ? Math.min(max, Math.max(min, count)) : min}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-label="생성 장수 슬라이더"
        />
        <NumberField label="생성 장수" value={count} step={1} invalid={!!error} onChange={setCount} className="w-12 shrink-0 text-right" testId="export-count" />
      </Row>
      <FieldError message={error} />
      {!error && Number.isFinite(seed) && (
        <Row label="Seed">
          <span className="num text-ink" data-testid="export-seed-range">
            {seed} … {seed + count - 1}
          </span>
          <span className="text-[11px] text-faint">(seed + i)</span>
        </Row>
      )}
      <p className="text-[11px] leading-relaxed text-faint" title="images/ · masks/ · binary_masks/ · metadata/ 폴더에 같은 번호로 1:1 매칭되는 파일과 manifest.json, README.txt">
        이미지·마스크·메타데이터가 같은 번호로 묶인 ZIP을 하단 버튼으로 받습니다.
      </p>
    </Section>
  )
}

export function ExportButton() {
  const count = useWorkspaceStore((s) => s.exportCount)
  const isExporting = useWorkspaceStore((s) => s.isExporting)
  const blocked = useWorkspaceStore((s) => blockingReason(s))
  const exportDataset = useWorkspaceStore((s) => s.exportDataset)
  const invalid = !!countError(count)
  return (
    <button
      type="button"
      className="btn shrink-0"
      disabled={!!blocked || invalid || isExporting}
      title={blocked ?? undefined}
      onClick={() => void exportDataset()}
      data-testid="export-button"
    >
      {isExporting ? (
        <>
          <Spinner /> ZIP 생성 중…
        </>
      ) : (
        <>데이터셋 다운로드{invalid ? '' : ` (${count}장)`}</>
      )}
    </button>
  )
}
