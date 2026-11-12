import type Konva from 'konva'
import { Circle, Group, Line, Rect } from 'react-konva'
import { toPixel, validateRoi, type Size, type Vec } from '../lib/geometry'
import { cancelDrawing, closeDraft, startDrawing } from '../lib/roiActions'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS, type Point } from '../types/generation'
import { Section } from './ui'

const ACCENT = '#4f8cff'
const DANGER = '#f87171'

const center = ([x, y]: Point): [number, number] => [x + 0.5, y + 0.5]
const flat = (points: Point[]) => points.flatMap(center)

// ---------------------------------------------------------------- left panel

export function RoiPanel() {
  const size = useWorkspaceStore((s) => s.sourceImageSize)
  const roi = useWorkspaceStore((s) => s.roi)
  const draft = useWorkspaceStore((s) => s.roiDraft)
  const tool = useWorkspaceStore((s) => s.tool)
  const setTool = useWorkspaceStore((s) => s.setTool)
  const setRoi = useWorkspaceStore((s) => s.setRoi)
  const disabled = !size
  const roiError = roi && size ? validateRoi(roi, size, LIMITS.roiMaxPoints) : null
  const shown = draft ?? roi

  return (
    <Section title="ROI (검사 영역)" testId="roi-panel">
      <div className="seg w-full" role="group" aria-label="ROI 도구">
        <button type="button" className="flex-1" aria-pressed={tool === 'select'} disabled={disabled} onClick={() => setTool('select')} data-testid="tool-select">
          선택·이동 <kbd className="ml-1 text-[10px] text-faint">V</kbd>
        </button>
        <button type="button" className="flex-1" aria-pressed={tool === 'draw'} disabled={disabled} onClick={startDrawing} data-testid="tool-draw">
          다각형 그리기 <kbd className="ml-1 text-[10px] text-faint">P</kbd>
        </button>
      </div>

      <div className="mt-2.5 rounded border border-line bg-bg px-2.5 py-2 text-[12px]" data-testid="roi-status">
        {draft ? (
          <span className="text-accent">그리는 중 · {draft.length}점</span>
        ) : roi ? (
          <span className={roiError ? 'text-danger' : 'text-ink'}>
            다각형 ROI · {roi.length}점 {roiError ? '· 유효하지 않음' : ''}
          </span>
        ) : (
          <span className="text-muted">ROI 없음 → 전체 이미지 사용</span>
        )}
        {roiError && <p className="mt-1 text-[11px] text-danger">{roiError}</p>}
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          {tool === 'draw'
            ? '클릭: 점 추가 · 첫 점 클릭/더블클릭/Enter: 닫기 · Backspace: 마지막 점 삭제 · Esc: 취소 · Space+드래그: 이동'
            : '꼭짓점 드래그: 이동 · 변 중앙 □ 클릭: 점 추가 · 꼭짓점 우클릭: 삭제 · 휠: 확대/축소'}
        </p>
      </div>

      <div className="mt-2 flex gap-1.5">
        {tool === 'draw' ? (
          <>
            <button type="button" className="btn flex-1" onClick={() => closeDraft()} disabled={!draft || draft.length < 3} data-testid="roi-close">
              그리기 완료
            </button>
            <button type="button" className="btn flex-1" onClick={cancelDrawing} data-testid="roi-cancel">
              취소
            </button>
          </>
        ) : (
          <button type="button" className="btn flex-1" onClick={() => setRoi(null)} disabled={!roi} data-testid="roi-delete">
            ROI 삭제 (전체 이미지)
          </button>
        )}
      </div>

      {shown && shown.length > 0 && (
        <details className="mt-2 text-[11px]" open>
          <summary className="cursor-pointer text-muted select-none">원본 픽셀 좌표 ({shown.length})</summary>
          <ol className="num mt-1 max-h-28 overflow-y-auto rounded border border-line bg-bg px-2 py-1 text-muted" data-testid="roi-points">
            {shown.map(([x, y], i) => (
              <li key={i} data-x={x} data-y={y}>
                <span className="inline-block w-6 text-faint">{i + 1}</span>
                {x}, {y}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- canvas layer

export function RoiLayer({ scale, imageSize, hover }: { scale: number; imageSize: Size; hover: Vec | null }) {
  const roi = useWorkspaceStore((s) => s.roi)
  const draft = useWorkspaceStore((s) => s.roiDraft)
  const tool = useWorkspaceStore((s) => s.tool)
  const setRoi = useWorkspaceStore((s) => s.setRoi)
  const pushToast = useWorkspaceStore((s) => s.pushToast)
  const r = 5.5 / scale
  const invalid = roi ? validateRoi(roi, imageSize, LIMITS.roiMaxPoints) !== null : false
  const color = invalid ? DANGER : ACCENT
  const editable = tool === 'select' && !!roi

  const moveVertex = (index: number, e: Konva.KonvaEventObject<DragEvent>) => {
    if (!roi) return
    const pixel = toPixel(e.target.position(), imageSize)
    e.target.position({ x: pixel[0] + 0.5, y: pixel[1] + 0.5 }) // snap to pixel centre
    const next = roi.slice()
    next[index] = pixel
    setRoi(next)
  }

  return (
    <Group>
      {!roi && !draft && (
        <Rect width={imageSize.width} height={imageSize.height} stroke={ACCENT} strokeWidth={1} dash={[6, 4]} strokeScaleEnabled={false} opacity={0.55} listening={false} />
      )}

      {roi && (
        <Line points={flat(roi)} closed stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} fill={invalid ? 'rgba(248,113,113,0.10)' : 'rgba(79,140,255,0.10)'} listening={false} opacity={draft ? 0.35 : 1} />
      )}

      {editable &&
        roi.map((p, i) => {
          const q = roi[(i + 1) % roi.length]
          const [mx, my] = [(p[0] + q[0]) / 2 + 0.5, (p[1] + q[1]) / 2 + 0.5]
          return (
            <Rect
              key={`mid-${i}`}
              x={mx - r * 0.6}
              y={my - r * 0.6}
              width={r * 1.2}
              height={r * 1.2}
              fill="#0f141b"
              stroke={color}
              strokeWidth={1}
              strokeScaleEnabled={false}
              opacity={0.85}
              onMouseDown={(e) => (e.cancelBubble = true)}
              onClick={(e) => {
                e.cancelBubble = true
                if (roi.length >= LIMITS.roiMaxPoints) return
                const next = roi.slice()
                next.splice(i + 1, 0, toPixel({ x: mx - 0.5, y: my - 0.5 }, imageSize))
                setRoi(next)
              }}
            />
          )
        })}

      {editable &&
        roi.map((p, i) => {
          const [cx, cy] = center(p)
          return (
            <Circle
              key={`v-${i}`}
              x={cx}
              y={cy}
              radius={r}
              fill={color}
              stroke="#0a0d12"
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
                if (roi.length <= 3) {
                  pushToast('info', '다각형은 최소 3개의 점이 필요합니다. ROI 전체를 지우려면 ‘ROI 삭제’를 누르세요.')
                  return
                }
                setRoi(roi.filter((_, j) => j !== i))
              }}
            />
          )
        })}

      {draft && draft.length > 0 && (
        <>
          <Line points={flat(draft)} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          {hover && (
            <Line
              points={[...center(draft[draft.length - 1]), ...center(toPixel(hover, imageSize))]}
              stroke={ACCENT}
              strokeWidth={1}
              dash={[4, 4]}
              strokeScaleEnabled={false}
              listening={false}
            />
          )}
          {draft.map((p, i) => (
            <Circle key={`d-${i}`} x={center(p)[0]} y={center(p)[1]} radius={i === 0 ? r * 1.35 : r * 0.8} fill={i === 0 ? '#0a0d12' : ACCENT} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          ))}
        </>
      )}
    </Group>
  )
}
