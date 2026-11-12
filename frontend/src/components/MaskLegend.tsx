import { CLASS_COLORS, rgbCss } from '../lib/maskColors'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { CLASS_IDS, DEFECT_LABELS, DEFECT_TYPES } from '../types/generation'
import { Section } from './ui'

export function MaskLegend() {
  const result = useWorkspaceStore((s) => s.currentResult)
  const opacity = useWorkspaceStore((s) => s.overlayOpacity)
  const setOpacity = useWorkspaceStore((s) => s.setOverlayOpacity)
  const counts = result?.metadata.class_pixel_counts

  return (
    <Section title="마스크 클래스 범례" testId="mask-legend">
      <ul className="grid gap-1 text-[12px]">
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border border-line-strong bg-black" />
          <span className="num w-3 text-faint">0</span>
          <span className="text-muted">배경 · background</span>
        </li>
        {DEFECT_TYPES.map((type) => (
          <li key={type} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: rgbCss(CLASS_COLORS[type]) }} />
            <span className="num w-3 text-faint">{CLASS_IDS[type]}</span>
            <span className="text-ink">
              {DEFECT_LABELS[type]} <span className="text-faint">· {type}</span>
            </span>
            <span className="num ml-auto text-muted" data-testid={`legend-count-${type}`}>
              {counts ? `${counts[type].toLocaleString()} px` : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="overlay-opacity" className="label">
            오버레이 불투명도
          </label>
          <span className="num text-[11px] text-ink" data-testid="opacity-value">
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <input
          id="overlay-opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          data-testid="opacity-slider"
        />
        <p className="mt-1 text-[11px] text-faint">시각화 전용입니다. 마스크 PNG 값(0–3)과 결과 파일은 바뀌지 않습니다.</p>
      </div>
    </Section>
  )
}
