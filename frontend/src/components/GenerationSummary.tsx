import type { ReactNode } from 'react'
import { CLASS_COLORS, rgbCss } from '../lib/maskColors'
import { currentConfigHash, useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFECT_LABELS } from '../types/generation'
import { Section } from './ui'

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="num truncate text-right text-ink" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}

export function GenerationSummary() {
  const size = useWorkspaceStore((s) => s.sourceImageSize)
  const result = useWorkspaceStore((s) => s.currentResult)
  const stale = useWorkspaceStore((s) => s.currentResult !== null && s.currentResultConfigHash !== currentConfigHash(s))
  const meta = result?.metadata
  const sameSize = !!meta && !!size && meta.width === size.width && meta.height === size.height

  return (
    <Section
      title="생성 결과"
      testId="generation-summary"
      aside={stale ? <span className="text-[11px] font-medium text-warn">설정 변경됨</span> : undefined}
    >
      <dl className={`text-[12px] ${stale ? 'opacity-60' : ''}`}>
        <Row label="원본 크기" testId="source-size">
          {size ? `${size.width} × ${size.height} px` : '—'}
        </Row>
        <Row label="출력 크기" testId="output-size">
          {meta ? (
            <>
              {meta.width} × {meta.height} px {sameSize && <span className="text-ok">· 동일</span>}
            </>
          ) : (
            '—'
          )}
        </Row>
        {meta && result ? (
          <>
            <Row label="생성 결함 / 요청" testId="generated-count">
              <span className={meta.generated_count === meta.requested_count ? 'text-ink' : 'text-danger'}>
                {meta.generated_count} / {meta.requested_count}
              </span>
            </Row>
            <Row label="Seed" testId="result-seed">
              {meta.seed}
            </Row>
            <Row label="ROI">{meta.roi ? `다각형 ${meta.roi.length}점 · ${meta.roi_pixel_count.toLocaleString()} px` : '전체 이미지'}</Row>
            <Row label="변경 픽셀" testId="changed-pixels">
              {meta.changed_pixel_count.toLocaleString()} ({((meta.changed_pixel_count / (meta.width * meta.height)) * 100).toFixed(2)}%)
            </Row>
            <Row label="서버 처리 시간">{result.processing_ms.toFixed(0)} ms</Row>
            <Row label="원본 SHA-256">
              <span title={meta.source_sha256}>{meta.source_sha256.slice(0, 12)}…</span>
            </Row>
          </>
        ) : (
          <p className="mt-2 text-[12px] text-faint">아직 생성된 결과가 없습니다. 왼쪽에서 ‘생성 미리보기’를 누르세요.</p>
        )}
      </dl>

      {meta && meta.instances.length > 0 && (
        <details className="mt-2.5 text-[11px]">
          <summary className="cursor-pointer text-muted select-none">결함 인스턴스 ({meta.instances.length})</summary>
          <table className="num mt-1.5 w-full text-left" data-testid="instance-table">
            <thead className="text-faint">
              <tr>
                <th className="py-0.5 font-normal">#</th>
                <th className="font-normal">유형</th>
                <th className="font-normal">bbox (x0,y0,x1,y1)</th>
                <th className="text-right font-normal">px</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {meta.instances.map((inst) => (
                <tr key={inst.id} className="border-t border-line">
                  <td className="py-0.5">{inst.id}</td>
                  <td>
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: rgbCss(CLASS_COLORS[inst.type]) }} />
                    {DEFECT_LABELS[inst.type]}
                  </td>
                  <td>{inst.bbox_xyxy.join(',')}</td>
                  <td className="text-right">{inst.changed_pixel_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Section>
  )
}
