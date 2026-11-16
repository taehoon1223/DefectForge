import { CLASS_COLORS, realClassColor, rgbCss } from '../lib/maskColors'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { CLASS_IDS, DEFECT_LABELS, DEFECT_TYPES, REAL_CLASS_OFFSET } from '../types/generation'
import { Row, Section } from './ui'

function LegendRow({ color, id, label, title, count, testId }: { color: string; id: number | string; label: string; title: string; count?: number; testId: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0" style={{ background: color }} />
      <span className="num w-3 text-faint">{id}</span>
      <span className="min-w-0 truncate text-ink" title={title}>
        {label}
      </span>
      <span className="num ml-auto shrink-0 text-muted" data-testid={testId}>
        {count !== undefined ? `${count.toLocaleString()} px` : ''}
      </span>
    </li>
  )
}

export function MaskLegend() {
  const result = useWorkspaceStore((s) => s.currentResult)
  const opacity = useWorkspaceStore((s) => s.overlayOpacity)
  const setOpacity = useWorkspaceStore((s) => s.setOverlayOpacity)
  const counts = result?.metadata.class_pixel_counts
  // Real defects have one class per label class (mask value 6 + k), named "real:<name>" in class_map.
  const realClasses = Object.entries(result?.metadata.class_map ?? {})
    .map(([id, name]) => ({ id: Number(id), name }))
    .filter((c) => c.id >= REAL_CLASS_OFFSET)

  return (
    <Section title="마스크" testId="mask-legend">
      <ul className="grid gap-1">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 border border-line-strong bg-black" />
          <span className="num w-3 text-faint">0</span>
          <span className="text-muted">배경</span>
        </li>
        {DEFECT_TYPES.filter((type) => type !== 'real').map((type) => (
          <LegendRow
            key={type}
            color={rgbCss(CLASS_COLORS[type])}
            id={CLASS_IDS[type]}
            label={DEFECT_LABELS[type]}
            title={type}
            count={counts?.[type]}
            testId={`legend-count-${type}`}
          />
        ))}
        {realClasses.length === 0 ? (
          <LegendRow color={rgbCss(CLASS_COLORS.real)} id={`${REAL_CLASS_OFFSET}+`} label={DEFECT_LABELS.real} title="라벨 클래스 k = 6 + k" testId="legend-count-real" />
        ) : (
          realClasses.map(({ id, name }) => (
            <LegendRow
              key={id}
              color={rgbCss(realClassColor(id - REAL_CLASS_OFFSET))}
              id={id}
              label={`${DEFECT_LABELS.real} · ${name.replace(/^real:/, '')}`}
              title={name}
              count={counts?.[name]}
              testId={`legend-count-real-${id - REAL_CLASS_OFFSET}`}
            />
          ))
        )}
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
