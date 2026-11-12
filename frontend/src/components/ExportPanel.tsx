import { blockingReason, useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS } from '../types/generation'
import { FieldError, NumberField, Section, Spinner } from './ui'

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
    <Section title="데이터셋 내보내기 (ZIP)" testId="export-panel">
      <div className="flex items-center gap-2">
        <span className="label shrink-0">생성 장수</span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Number.isFinite(count) ? Math.min(max, Math.max(min, count)) : min}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-label="생성 장수 슬라이더"
        />
        <NumberField label="생성 장수" value={count} step={1} invalid={!!error} onChange={setCount} className="w-12 shrink-0 text-center" testId="export-count" />
      </div>
      <FieldError message={error} />
      <dl className="num mt-2.5 grid gap-1 text-[11px] text-muted">
        <div className="flex justify-between">
          <dt>Seed 규약</dt>
          <dd className="text-ink">seed + i</dd>
        </div>
        {!error && Number.isFinite(seed) && (
          <div className="flex justify-between">
            <dt>샘플 Seed 범위</dt>
            <dd className="text-ink" data-testid="export-seed-range">
              {seed} … {seed + count - 1}
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        images/ · masks/ · binary_masks/ · metadata/ 폴더에 같은 번호로 1:1 매칭되는 파일과 manifest.json, README.txt가 포함됩니다. 하단의 ‘데이터셋 다운로드’로 내려받습니다.
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
      className="btn btn-primary shrink-0"
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
