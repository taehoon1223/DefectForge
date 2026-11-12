import { CLASS_COLORS, rgbCss } from '../lib/maskColors'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { CLASS_IDS, DEFECT_LABELS, DEFECT_TYPES } from '../types/generation'
import { Row, Section } from './ui'

export function MaskLegend() {
  const result = useWorkspaceStore((s) => s.currentResult)
  const opacity = useWorkspaceStore((s) => s.overlayOpacity)
  const setOpacity = useWorkspaceStore((s) => s.setOverlayOpacity)
  const counts = result?.metadata.class_pixel_counts

  return (
    <Section title="마스크" testId="mask-legend">
      <ul className="grid gap-1">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 border border-line-strong bg-black" />
          <span className="num w-3 text-faint">0</span>
          <span className="text-muted">배경</span>
        </li>
        {DEFECT_TYPES.map((type) => (
          <li key={type} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5" style={{ background: rgbCss(CLASS_COLORS[type]) }} />
            <span className="num w-3 text-faint">{CLASS_IDS[type]}</span>
            <span className="text-ink" title={type}>
              {DEFECT_LABELS[type]}
            </span>
            <span className="num ml-auto text-muted" data-testid={`legend-count-${type}`}>
              {counts?.[type] !== undefined ? `${counts[type].toLocaleString()} px` : ''}
            </span>
          </li>
        ))}
      </ul>
      <Row label="오버레이">
        <input
          id="overlay-opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          aria-label="오버레이 불투명도"
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          data-testid="opacity-slider"
        />
        <span className="num w-10 shrink-0 text-right text-ink" data-testid="opacity-value">
          {Math.round(opacity * 100)}%
        </span>
      </Row>
      <p className="text-[11px] text-faint">표시용입니다. 결과 파일은 바뀌지 않습니다.</p>
    </Section>
  )
}
