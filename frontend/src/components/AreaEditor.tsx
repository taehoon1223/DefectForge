import type Konva from 'konva'
import { Arrow, Circle, Group, Label, Line, Rect, Tag, Text } from 'react-konva'
import { flatCenters, pixelCenter, toPixel, validateRoi, type Size, type Vec } from '../lib/geometry'
import { cancelDrawing, closeDraft, startRegionDrawing } from '../lib/drawActions'
import { draftColor, regionColor } from '../lib/regionColors'
import { lineAngle, useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS, REGION_KIND_LABELS, type Point, type RegionKind } from '../types/generation'
import { Section } from './ui'

const LINE_COLOR = '#22c55e'
const FRAME_COLOR = '#8a8a8a'

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// ---------------------------------------------------------------- left panel

const ADD_BUTTONS: Array<{ kind: RegionKind; label: string; hint?: string }> = [
  { kind: 'include', label: '+ 생성 영역', hint: 'P' },
  { kind: 'exclude', label: '+ 제외 영역' },
]

export function AreaPanel() {
  const size = useWorkspaceStore((s) => s.sourceImageSize)
  const regions = useWorkspaceStore((s) => s.regions)
  const selectedId = useWorkspaceStore((s) => s.selectedRegionId)
  const tool = useWorkspaceStore((s) => s.tool)
  const drawKind = useWorkspaceStore((s) => s.drawKind)
  const draft = useWorkspaceStore((s) => s.draft)
  const selectRegion = useWorkspaceStore((s) => s.selectRegion)
  const renameRegion = useWorkspaceStore((s) => s.renameRegion)
  const deleteRegion = useWorkspaceStore((s) => s.deleteRegion)
  const drawing = tool === 'draw' ? drawKind : null
  const selected = regions.find((r) => r.id === selectedId) ?? null
  const includes = regions.filter((r) => r.kind === 'include').length

  return (
    <Section title="영역" testId="area-panel">
      <p className="text-muted" data-testid="area-status">
        {includes === 0 ? '이미지 전체에 생성합니다.' : `생성 영역 ${includes}개 안에만 생성합니다.`}
        {regions.length > includes && ` 제외 영역 ${regions.length - includes}개는 뺍니다.`}
      </p>
      <div className="flex gap-1.5">
        {ADD_BUTTONS.map(({ kind, label, hint }) => (
          <button
            key={kind}
            type="button"
            className="btn flex-1 px-1.5"
            disabled={!size}
            aria-pressed={drawing === kind}
            onClick={() => startRegionDrawing(kind)}
            title={hint ? `단축키 ${hint}` : undefined}
            data-testid={`add-${kind}`}
          >
            {label}
          </button>
        ))}
      </div>

      {drawing && (
        <div className="grid gap-1.5" data-testid="region-draw-status">
          <p>
            <span className="text-accent">
              {REGION_KIND_LABELS[drawing]} 그리는 중 · {draft?.length ?? 0}점
            </span>
            <span className="block text-[11px] text-faint">클릭: 점 추가 · 첫 점/더블클릭/Enter: 닫기 · Backspace: 되돌리기 · Esc: 취소</span>
          </p>
          <div className="flex gap-1.5">
            <button type="button" className="btn flex-1" onClick={() => closeDraft()} disabled={!draft || draft.length < 3} data-testid="region-close">
              그리기 완료
            </button>
            <button type="button" className="btn btn-ghost flex-1" onClick={cancelDrawing} data-testid="region-cancel">
              취소
            </button>
          </div>
        </div>
      )}

      {regions.length > 0 && (
        <ul className="-mx-3" data-testid="region-list">
          {regions.map((region) => {
            const color = regionColor(region, regions)
            const problem = size ? validateRoi(region.polygon, size, LIMITS.roiMaxPoints, `영역 '${region.name}'`) : null
            const isSelected = region.id === selectedId
            return (
              <li
                key={region.id}
                className={`group px-3 py-0.5 ${isSelected ? 'bg-panel-2' : 'hover:bg-[#2a2a2a]'}`}
                data-testid={`region-row-${region.id}`}
                data-region-kind={region.kind}
                onClick={() => selectRegion(region.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0"
                    style={region.kind === 'exclude' ? { border: `1px dashed ${color}` } : { background: color }}
                    aria-hidden
                  />
                  <input
                    className="input min-w-0 flex-1 bg-transparent px-1 group-hover:bg-field focus:bg-field"
                    aria-label="영역 이름"
                    maxLength={40}
                    value={region.name}
                    aria-invalid={!region.name.trim() || undefined}
                    onChange={(e) => renameRegion(region.id, e.target.value)}
                    data-testid="region-name"
                  />
                  <span className="shrink-0 text-[11px] text-faint">{region.kind === 'include' ? '생성' : '제외'}</span>
                  <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 items-center justify-center text-faint hover:text-danger"
                    aria-label={`${region.name} 삭제`}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteRegion(region.id)
                    }}
                    data-testid="region-delete"
                  >
                    ×
                  </button>
                </div>
                {problem && <p className="pb-1 pl-[18px] text-[11px] text-danger">{problem}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {selected && tool === 'select' && (
        <div>
          <p className="text-[11px] text-faint">꼭짓점 드래그: 이동 · 변 중앙 □: 점 추가 · 꼭짓점 우클릭: 삭제</p>
          <PointList points={selected.polygon} testId="region-points" title={`좌표 · ${selected.name}`} />
        </div>
      )}
    </Section>
  )
}

export function PointList({ points, testId, title }: { points: Point[]; testId: string; title: string }) {
  return (
    <details className="mt-1 text-[11px]">
      <summary className="cursor-pointer text-muted select-none hover:text-ink">
        {title} ({points.length})
      </summary>
      <ol className="num mt-1 max-h-28 overflow-y-auto bg-field px-2 py-1 text-muted" data-testid={testId}>
        {points.map(([x, y], i) => (
          <li key={i} data-x={x} data-y={y}>
            <span className="inline-block w-6 text-faint">{i + 1}</span>
            {x}, {y}
          </li>
        ))}
      </ol>
    </details>
  )
}

// ---------------------------------------------------------------- canvas: polygon editing

/** Draggable vertices (snapped to pixel centres), midpoint □ handles to insert, right-click to delete. */
export function PolygonHandles({
  points,
  color,
  scale,
  imageSize,
  onChange,
}: {
  points: Point[]
  color: string
  scale: number
  imageSize: Size
  onChange: (points: Point[]) => void
}) {
  const pushToast = useWorkspaceStore((s) => s.pushToast)
  const r = 5.5 / scale

  const moveVertex = (index: number, e: Konva.KonvaEventObject<DragEvent>) => {
    const pixel = toPixel(e.target.position(), imageSize)
    e.target.position({ x: pixel[0] + 0.5, y: pixel[1] + 0.5 }) // snap to pixel centre
    const next = points.slice()
    next[index] = pixel
    onChange(next)
  }

  return (
    <>
      {points.map((p, i) => {
        const q = points[(i + 1) % points.length]
        const [mx, my] = [(p[0] + q[0]) / 2 + 0.5, (p[1] + q[1]) / 2 + 0.5]
        return (
          <Rect
            key={`mid-${i}`}
            x={mx - r * 0.6}
            y={my - r * 0.6}
            width={r * 1.2}
            height={r * 1.2}
            fill="#1c1c1c"
            stroke={color}
            strokeWidth={1}
            strokeScaleEnabled={false}
            opacity={0.85}
            onMouseDown={(e) => (e.cancelBubble = true)}
            onClick={(e) => {
              e.cancelBubble = true
              if (points.length >= LIMITS.roiMaxPoints) return
              const next = points.slice()
              next.splice(i + 1, 0, toPixel({ x: mx - 0.5, y: my - 0.5 }, imageSize))
              onChange(next)
            }}
          />
        )
      })}
      {points.map((p, i) => {
        const [cx, cy] = pixelCenter(p)
        return (
          <Circle
            key={`v-${i}`}
            x={cx}
            y={cy}
            radius={r}
            fill={color}
            stroke="#111111"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
            draggable
            onMouseDown={(e) => (e.cancelBubble = true)}
            onDragStart={(e) => (e.cancelBubble = true)}
            onDragMove={(e) => {
              e.cancelBubble = true
              moveVertex(i, e)
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true
              moveVertex(i, e)
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault()
              e.cancelBubble = true
              if (points.length <= 3) {
                pushToast('info', '영역 다각형은 최소 3개의 점이 필요합니다. 영역을 지우려면 목록에서 ×를 누르세요.')
                return
              }
              onChange(points.filter((_, j) => j !== i))
            }}
          />
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------- canvas layers

/** Regions (outline only unless selected, so the result stays readable), the draft polygon and,
 *  when no include region exists, a dashed frame showing that the whole image is used. */
export function RegionLayer({ scale, imageSize, hover, showRegions }: { scale: number; imageSize: Size; hover: Vec | null; showRegions: boolean }) {
  const regions = useWorkspaceStore((s) => s.regions)
  const selectedId = useWorkspaceStore((s) => s.selectedRegionId)
  const draft = useWorkspaceStore((s) => s.draft)
  const drawKind = useWorkspaceStore((s) => s.drawKind)
  const tool = useWorkspaceStore((s) => s.tool)
  const selectRegion = useWorkspaceStore((s) => s.selectRegion)
  const updateRegionPolygon = useWorkspaceStore((s) => s.updateRegionPolygon)
  const selected = regions.find((r) => r.id === selectedId) ?? null
  const font = 11 / scale
  const r = 5.5 / scale
  const draftStroke = draftColor(drawKind, regions)
  const fullImage = !regions.some((region) => region.kind === 'include') && !(draft && drawKind === 'include')

  return (
    <Group>
      {showRegions && fullImage && (
        <Rect width={imageSize.width} height={imageSize.height} stroke={FRAME_COLOR} strokeWidth={1} dash={[6, 4]} strokeScaleEnabled={false} opacity={0.55} listening={false} />
      )}
      {showRegions &&
        regions.map((region) => {
          const color = regionColor(region, regions)
          const isSelected = region.id === selectedId
          const excluded = region.kind === 'exclude'
          const top = region.polygon.reduce((best, p) => (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0]) ? p : best), region.polygon[0])
          const [lx, ly] = pixelCenter(top)
          return (
            <Group key={region.id}>
              <Line
                points={flatCenters(region.polygon)}
                closed
                stroke={color}
                strokeWidth={isSelected ? 2 : 1.25}
                strokeScaleEnabled={false}
                dash={excluded ? [5, 4] : undefined}
                // The transparent fill still makes the interior clickable for selection.
                fill={excluded ? 'rgba(17,17,17,0.35)' : isSelected ? withAlpha(color, 0.1) : 'rgba(0,0,0,0)'}
                hitStrokeWidth={8}
                listening={tool === 'select'}
                onClick={() => selectRegion(region.id)}
                onTap={() => selectRegion(region.id)}
              />
              <Label x={lx} y={ly - font * 2} listening={false}>
                <Tag fill="rgba(20,20,20,0.85)" cornerRadius={2 / scale} />
                <Text text={region.name} fontSize={font} padding={3 / scale} fill={color} />
              </Label>
            </Group>
          )
        })}
      {showRegions && selected && tool === 'select' && (
        <PolygonHandles
          points={selected.polygon}
          color={regionColor(selected, regions)}
          scale={scale}
          imageSize={imageSize}
          onChange={(points) => updateRegionPolygon(selected.id, points)}
        />
      )}

      {draft && draft.length > 0 && (
        <>
          <Line points={flatCenters(draft)} stroke={draftStroke} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          {hover && (
            <Line
              points={[...pixelCenter(draft[draft.length - 1]), ...pixelCenter(toPixel(hover, imageSize))]}
              stroke={draftStroke}
              strokeWidth={1}
              dash={[4, 4]}
              strokeScaleEnabled={false}
              listening={false}
            />
          )}
          {draft.map((p, i) => (
            <Circle
              key={`d-${i}`}
              x={pixelCenter(p)[0]}
              y={pixelCenter(p)[1]}
              radius={i === 0 ? r * 1.35 : r * 0.8}
              fill={i === 0 ? '#111111' : draftStroke}
              stroke={draftStroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              listening={false}
            />
          ))}
        </>
      )}
    </Group>
  )
}

/** Scratch direction reference: arrow with draggable endpoints, plus the half-placed draft. */
export function LineLayer({ scale, imageSize, hover }: { scale: number; imageSize: Size; hover: Vec | null }) {
  const line = useWorkspaceStore((s) => s.referenceLine)
  const draft = useWorkspaceStore((s) => s.lineDraft)
  const tool = useWorkspaceStore((s) => s.tool)
  const setReferenceLine = useWorkspaceStore((s) => s.setReferenceLine)
  const r = 5 / scale
  const angle = lineAngle(line)

  const moveEnd = (which: 'start' | 'end', x: number, y: number): Point | null => {
    if (!line) return null
    const pixel = toPixel({ x, y }, imageSize)
    const other = which === 'start' ? line.end : line.start
    if (Math.hypot(pixel[0] - other[0], pixel[1] - other[1]) < LIMITS.area.referenceLineMinLengthPx) return null
    setReferenceLine({ ...line, [which]: pixel })
    return pixel
  }

  return (
    <Group>
      {line && (
        <>
          <Arrow
            points={[...pixelCenter(line.start), ...pixelCenter(line.end)]}
            stroke={LINE_COLOR}
            fill={LINE_COLOR}
            strokeWidth={2}
            strokeScaleEnabled={false}
            pointerLength={10 / scale}
            pointerWidth={8 / scale}
            listening={false}
          />
          {(['start', 'end'] as const).map((which) => (
            <Circle
              key={which}
              x={pixelCenter(line[which])[0]}
              y={pixelCenter(line[which])[1]}
              radius={r}
              fill={which === 'start' ? '#111111' : LINE_COLOR}
              stroke={LINE_COLOR}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              draggable={tool === 'select'}
              onMouseDown={(e) => (e.cancelBubble = true)}
              onDragStart={(e) => (e.cancelBubble = true)}
              onDragMove={(e) => {
                e.cancelBubble = true
                const p = moveEnd(which, e.target.x(), e.target.y())
                const snapped = pixelCenter(p ?? line[which])
                e.target.position({ x: snapped[0], y: snapped[1] })
              }}
            />
          ))}
          <Label x={pixelCenter(line.end)[0] + 8 / scale} y={pixelCenter(line.end)[1]} listening={false}>
            <Tag fill="rgba(20,20,20,0.85)" cornerRadius={2 / scale} />
            <Text text={`기준선 ${angle?.toFixed(1)}°`} fontSize={11 / scale} padding={3 / scale} fill={LINE_COLOR} />
          </Label>
        </>
      )}
      {draft && (
        <>
          <Circle x={pixelCenter(draft)[0]} y={pixelCenter(draft)[1]} radius={r} fill="#111111" stroke={LINE_COLOR} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          {hover && (
            <Line
              points={[...pixelCenter(draft), ...pixelCenter(toPixel(hover, imageSize))]}
              stroke={LINE_COLOR}
              strokeWidth={1.5}
              dash={[5, 4]}
              strokeScaleEnabled={false}
              listening={false}
            />
          )}
        </>
      )}
    </Group>
  )
}
