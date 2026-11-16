import type Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Circle, Group, Image as KImage, Label, Layer, Line, Rect, Stage, Tag, Text } from 'react-konva'
import { clampScale, fitView, flatCenters, imageToScreen, isInsideImage, pixelCenter, toPixel, validateRoi, zoomAt, type Size, type Vec, type ViewTransform } from '../lib/geometry'
import { useElementSize } from '../lib/hooks'
import { realClassColor } from '../lib/maskColors'
import { labelFileName, toYoloLabel, type DrawnDefect } from '../lib/yoloLabel'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS, type Point } from '../types/generation'
import { PolygonHandles } from './AreaEditor'
import { NumberField, Spinner } from './ui'

const ZOOM_STEP = 1.25
const CLOSE_RADIUS_PX = 9
const DOUBLE_CLICK_MS = 350
const DOUBLE_CLICK_PX = 6
const TOUCH_CLICK_GUARD_MS = 800
const NO_CLASS_COLOR: [number, number, number] = [138, 138, 138]

type Defect = DrawnDefect & { id: number }
type Mode = 'draw' | 'select'

const isClass = (k: number) => Number.isInteger(k) && k >= 0 && k < LIMITS.defectSamples.maxClasses
const classColor = (k: number) => (isClass(k) ? realClassColor(k) : NO_CLASS_COLOR)
const rgba = ([r, g, b]: [number, number, number], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`

function sizeProblem({ width, height }: Size): string | null {
  const min = LIMITS.defectSamples.minDim
  const max = LIMITS.image.maxDim
  if (width < min || height < min || width > max || height > max) {
    return `이미지 크기 ${width}×${height}px는 지원 범위를 벗어났습니다. 결함 샘플은 가로·세로 모두 ${min}~${max}px이어야 합니다.`
  }
  return null
}

function defectProblem(defect: Defect, index: number, size: Size): string | null {
  if (!isClass(defect.classId)) return `결함 ${index + 1}: 클래스는 0~${LIMITS.defectSamples.maxClasses - 1} 사이의 정수여야 합니다.`
  return validateRoi(defect.points, size, LIMITS.roiMaxPoints, `결함 ${index + 1}`)
}

/**
 * Draw the defects of a sample image as polygons (one label class each) instead of picking a YOLO label
 * file. The polygons become an ordinary YOLO label txt (lib/yoloLabel.ts) and go through the same
 * analyse-then-add path as an uploaded one, so the server handles both the same way.
 */
export function SampleLabelEditor({ image, onClose, onAdded }: { image: File; onClose: () => void; onAdded: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const viewport = useElementSize(containerRef)
  const [loaded, setLoaded] = useState<{ img: HTMLImageElement; size: Size } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  const [mode, setMode] = useState<Mode>('draw')
  const [defects, setDefects] = useState<Defect[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Point[] | null>(null)
  const [nextClass, setNextClass] = useState(0)
  const [hover, setHover] = useState<Vec | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const fitted = useRef(false)
  const seq = useRef(0)
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastTouch = useRef(Number.NEGATIVE_INFINITY)

  const busy = useWorkspaceStore((s) => s.isAnalyzingSamples)
  const full = useWorkspaceStore((s) => s.defectSamples.length >= LIMITS.defectSamples.maxCount)
  const error = useWorkspaceStore((s) => s.error)
  const addDefectSample = useWorkspaceStore((s) => s.addDefectSample)
  const pushToast = useWorkspaceStore((s) => s.pushToast)
  const size = loaded?.size ?? null

  useEffect(() => {
    const url = URL.createObjectURL(image)
    const img = new Image()
    img.onload = () => {
      const decoded = { width: img.naturalWidth, height: img.naturalHeight }
      const problem = sizeProblem(decoded)
      if (problem) setLoadError(problem)
      else setLoaded({ img, size: decoded })
    }
    img.onerror = () => setLoadError('이미지를 디코딩할 수 없습니다. 파일이 손상되었거나 이미지가 아닙니다.')
    img.src = url
    return () => {
      img.onload = null
      img.onerror = null
      URL.revokeObjectURL(url)
    }
  }, [image])

  useEffect(() => dialogRef.current?.focus(), [])

  useEffect(() => {
    if (!size || fitted.current || viewport.width === 0 || viewport.height === 0) return
    fitted.current = true
    setView(fitView(size, viewport))
  }, [size, viewport])

  const closeDraft = () => {
    if (!draft || !size) return
    if (!isClass(nextClass)) {
      pushToast('error', `클래스는 0~${LIMITS.defectSamples.maxClasses - 1} 사이의 정수여야 합니다.`)
      return
    }
    const problem = validateRoi(draft, size, LIMITS.roiMaxPoints, `결함 ${defects.length + 1}`)
    if (problem) {
      pushToast('error', problem)
      return
    }
    setDefects([...defects, { id: ++seq.current, classId: nextClass, points: draft }])
    setDraft(null)
  }

  // Capture phase + stopPropagation: the workspace shortcuts behind the dialog (P, V, Space, Enter…) stay quiet.
  // Re-registered every render so the handler always sees the current draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      e.stopPropagation()
      if (e.code === 'Space') {
        if (tag !== 'BUTTON') {
          e.preventDefault()
          setSpaceHeld(true)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (draft) setDraft(null)
        else if (mode === 'draw') setMode('select')
        else setSelectedId(null)
      } else if (e.key === 'Enter' && draft) {
        e.preventDefault()
        closeDraft()
      } else if (e.key === 'Backspace' && draft) {
        e.preventDefault()
        setDraft(draft.length > 1 ? draft.slice(0, -1) : null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    window.addEventListener('keyup', up)
    return () => window.removeEventListener('keyup', up)
  }, [])

  const pointerInImage = (): Vec | null => {
    const stage = stageRef.current
    const pos = stage?.getPointerPosition()
    if (!stage || !pos) return null
    return stage.getAbsoluteTransform().copy().invert().point(pos)
  }

  /** Same click rules as the workspace canvas: point per click, first point / double-click closes. */
  const handleDrawClick = (evt: MouseEvent | TouchEvent) => {
    if (mode !== 'draw' || spaceHeld || !size || ('button' in evt && evt.button !== 0)) return
    if (!('button' in evt)) lastTouch.current = evt.timeStamp
    else if (evt.timeStamp - lastTouch.current < TOUCH_CLICK_GUARD_MS) return
    const p = pointerInImage()
    const pointer = stageRef.current?.getPointerPosition()
    if (!p || !pointer) return
    const prev = lastClick.current
    lastClick.current = { t: evt.timeStamp, x: pointer.x, y: pointer.y }
    if (prev && evt.timeStamp - prev.t < DOUBLE_CLICK_MS && Math.hypot(pointer.x - prev.x, pointer.y - prev.y) <= DOUBLE_CLICK_PX) {
      lastClick.current = null
      closeDraft()
      return
    }
    const points = draft ?? []
    if (points.length >= 3) {
      const first = imageToScreen({ x: points[0][0] + 0.5, y: points[0][1] + 0.5 }, view)
      if (Math.hypot(first.x - pointer.x, first.y - pointer.y) <= CLOSE_RADIUS_PX) {
        closeDraft()
        return
      }
    }
    const pixel = toPixel(p, size)
    const last = points[points.length - 1]
    if (last && last[0] === pixel[0] && last[1] === pixel[1]) return
    if (points.length >= LIMITS.roiMaxPoints) {
      pushToast('error', `다각형 점은 최대 ${LIMITS.roiMaxPoints}개까지 지정할 수 있습니다.`)
      return
    }
    setDraft([...points, pixel])
  }

  const zoomBy = (factor: number, anchor?: Vec) => {
    setView((v) => zoomAt(v, anchor ?? { x: viewport.width / 2, y: viewport.height / 2 }, clampScale(v.scale * factor)))
  }

  const switchMode = (next: Mode) => {
    setDraft(null)
    setSelectedId(null)
    setMode(next)
  }

  const updateDefect = (id: number, patch: Partial<DrawnDefect>) => setDefects((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  const removeDefect = (id: number) => {
    setDefects((list) => list.filter((d) => d.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const problems = size ? defects.map((d, i) => defectProblem(d, i, size)) : []
  const blocked = !size
    ? '이미지를 불러오는 중입니다.'
    : draft
      ? '그리던 다각형을 닫거나(Enter) 취소(Esc)하세요.'
      : defects.length === 0
        ? '결함을 하나 이상 그리세요.'
        : problems.find((p) => p !== null) ?? (full ? `결함 샘플은 최대 ${LIMITS.defectSamples.maxCount}개까지 추가할 수 있습니다.` : null)

  const add = async () => {
    if (!size || blocked || busy) return
    setSubmitted(true)
    const label = new File([toYoloLabel(defects, size)], labelFileName(image.name), { type: 'text/plain' })
    if (await addDefectSample(image, label)) onAdded()
  }

  const panning = mode === 'select' || spaceHeld
  const selected = defects.find((d) => d.id === selectedId) ?? null
  const hoverPixel = hover && size && isInsideImage(hover, size) ? toPixel(hover, size) : null
  const draftColor = rgba(classColor(nextClass))
  const font = 11 / view.scale
  const r = 5.5 / view.scale

  return createPortal(
    <div className="fixed inset-0 z-[45] flex bg-[rgba(0,0,0,0.6)] lg:p-6" data-testid="sample-editor">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="결함 그리기"
        tabIndex={-1}
        className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-col border border-line bg-panel outline-none"
      >
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3">
          <h2 className="text-[12px] font-semibold text-ink">결함 그리기</h2>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={image.name}>
            {image.name}
            {size && ` · ${size.width} × ${size.height} px`}
          </span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="축소" disabled={!size} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            −
          </button>
          <span className="num w-12 text-center text-muted">{Math.round(view.scale * 100)}%</span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="확대" disabled={!size} onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </button>
          <button type="button" className="btn btn-ghost px-2" disabled={!size} onClick={() => size && setView(fitView(size, viewport))}>
            맞춤
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-[300px] flex-1 flex-col">
            <div
              ref={containerRef}
              className="relative min-h-0 flex-1 overflow-hidden bg-bg"
              style={{ cursor: !size ? 'default' : panning ? 'grab' : 'crosshair' }}
              data-testid="sample-canvas"
              data-scale={view.scale}
              data-offset-x={view.x}
              data-offset-y={view.y}
              onContextMenu={(e) => e.preventDefault()}
            >
              {loaded && viewport.width > 0 && (
                <Stage
                  ref={stageRef}
                  width={viewport.width}
                  height={viewport.height}
                  scaleX={view.scale}
                  scaleY={view.scale}
                  x={view.x}
                  y={view.y}
                  draggable={panning}
                  onDragMove={(e) => {
                    if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))
                  }}
                  onDragEnd={(e) => {
                    if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))
                  }}
                  onWheel={(e) => {
                    e.evt.preventDefault()
                    zoomBy(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, stageRef.current?.getPointerPosition() ?? undefined)
                  }}
                  onMouseMove={() => setHover(pointerInImage())}
                  onMouseLeave={() => setHover(null)}
                  onTap={(e) => handleDrawClick(e.evt)}
                  onClick={(e) => {
                    if (mode === 'select' && e.target === e.target.getStage()) setSelectedId(null)
                    handleDrawClick(e.evt)
                  }}
                >
                  <Layer imageSmoothingEnabled={false} listening={false}>
                    <KImage image={loaded.img} width={loaded.size.width} height={loaded.size.height} />
                    <Rect width={loaded.size.width} height={loaded.size.height} stroke="#3a3a3a" strokeWidth={1} strokeScaleEnabled={false} />
                  </Layer>
                  <Layer>
                    {defects.map((d, i) => {
                      const color = classColor(d.classId)
                      const isSelected = d.id === selectedId
                      const top = d.points.reduce((best, p) => (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0]) ? p : best), d.points[0])
                      const [lx, ly] = pixelCenter(top)
                      return (
                        <Group key={d.id}>
                          <Line
                            points={flatCenters(d.points)}
                            closed
                            stroke={rgba(color)}
                            strokeWidth={isSelected ? 2 : 1.25}
                            strokeScaleEnabled={false}
                            fill={rgba(color, isSelected ? 0.3 : 0.15)}
                            hitStrokeWidth={8}
                            listening={mode === 'select'}
                            onClick={() => setSelectedId(d.id)}
                            onTap={() => setSelectedId(d.id)}
                          />
                          <Label x={lx} y={ly - font * 2} listening={false}>
                            <Tag fill="rgba(20,20,20,0.85)" cornerRadius={2 / view.scale} />
                            <Text text={`${i + 1}`} fontSize={font} padding={3 / view.scale} fill={rgba(color)} />
                          </Label>
                        </Group>
                      )
                    })}
                    {selected && mode === 'select' && (
                      <PolygonHandles
                        points={selected.points}
                        color={rgba(classColor(selected.classId))}
                        scale={view.scale}
                        imageSize={loaded.size}
                        onChange={(points) => updateDefect(selected.id, { points })}
                        minPointsMessage="결함 다각형은 최소 3개의 점이 필요합니다. 결함을 지우려면 목록에서 ×를 누르세요."
                      />
                    )}
                    {draft && draft.length > 0 && (
                      <>
                        <Line points={flatCenters(draft)} stroke={draftColor} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
                        {hover && (
                          <Line
                            points={[...pixelCenter(draft[draft.length - 1]), ...pixelCenter(toPixel(hover, loaded.size))]}
                            stroke={draftColor}
                            strokeWidth={1}
                            dash={[4, 4]}
                            strokeScaleEnabled={false}
                            listening={false}
                          />
                        )}
                        {draft.map((p, i) => (
                          <Circle
                            key={i}
                            x={pixelCenter(p)[0]}
                            y={pixelCenter(p)[1]}
                            radius={i === 0 ? r * 1.35 : r * 0.8}
                            fill={i === 0 ? '#111111' : draftColor}
                            stroke={draftColor}
                            strokeWidth={1.5}
                            strokeScaleEnabled={false}
                            listening={false}
                          />
                        ))}
                      </>
                    )}
                  </Layer>
                </Stage>
              )}
              {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center" data-testid="sample-editor-load">
                  {loadError ? <p className="text-danger">{loadError}</p> : <p className="text-muted">이미지를 불러오는 중…</p>}
                </div>
              )}
            </div>
            <div className="num flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-faint">
              <span>{hoverPixel ? `x ${hoverPixel[0]}  y ${hoverPixel[1]}` : 'x —  y —'}</span>
              <span className="ml-auto hidden sm:inline">휠: 확대/축소 · {mode === 'select' ? '드래그' : 'Space+드래그'}: 이동</span>
            </div>
          </div>

          <div className="grid max-h-[40vh] shrink-0 content-start gap-2 overflow-y-auto border-t border-line px-3 py-2.5 lg:max-h-none lg:w-[300px] lg:border-t-0 lg:border-l">
            <p className="text-[11px] leading-relaxed text-faint">
              결함마다 다각형을 꼭 맞게 그리세요. 다각형 안은 결함, 바깥은 표면으로 씁니다. 결함 주변의 표면이 보이도록 이미지의 절반 이하만 그려야 합니다.
            </p>
            <div className="seg" role="group" aria-label="도구">
              <button type="button" aria-pressed={mode === 'draw'} onClick={() => switchMode('draw')} data-testid="sample-tool-draw">
                그리기
              </button>
              <button type="button" aria-pressed={mode === 'select'} onClick={() => switchMode('select')} data-testid="sample-tool-select">
                선택·이동
              </button>
            </div>
            <div className="grid min-h-[22px] grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
              <span className="label truncate">클래스</span>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0" style={{ background: draftColor }} aria-hidden />
                <NumberField
                  value={nextClass}
                  onChange={setNextClass}
                  label="새 결함의 클래스"
                  invalid={!isClass(nextClass)}
                  step={1}
                  testId="sample-class"
                  className="w-14"
                />
                <span className="truncate text-[11px] text-faint">새로 그릴 결함</span>
              </div>
            </div>

            {mode === 'draw' && (
              <div className="grid gap-1.5" data-testid="sample-draw-status">
                <p>
                  <span className="text-accent">결함 {defects.length + 1} 그리는 중 · {draft?.length ?? 0}점</span>
                  <span className="block text-[11px] text-faint">클릭: 점 추가 · 첫 점/더블클릭/Enter: 닫기 · Backspace: 되돌리기 · Esc: 취소</span>
                </p>
                {draft && (
                  <div className="flex gap-1.5">
                    <button type="button" className="btn flex-1" onClick={closeDraft} disabled={draft.length < 3} data-testid="sample-draft-close">
                      그리기 완료
                    </button>
                    <button type="button" className="btn btn-ghost flex-1" onClick={() => setDraft(null)}>
                      취소
                    </button>
                  </div>
                )}
              </div>
            )}

            {defects.length > 0 && (
              <ul className="-mx-3" data-testid="sample-defect-list">
                {defects.map((d, i) => (
                  <li
                    key={d.id}
                    className={`px-3 py-0.5 ${d.id === selectedId ? 'bg-panel-2' : 'hover:bg-[#2a2a2a]'}`}
                    onClick={() => {
                      if (mode !== 'select') switchMode('select')
                      setSelectedId(d.id)
                    }}
                    data-testid="sample-defect"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0" style={{ background: rgba(classColor(d.classId)) }} aria-hidden />
                      <span className="w-12 shrink-0 text-ink">결함 {i + 1}</span>
                      <span className="text-[11px] text-faint">클래스</span>
                      <NumberField
                        value={d.classId}
                        onChange={(classId) => updateDefect(d.id, { classId })}
                        label={`결함 ${i + 1}의 클래스`}
                        invalid={!isClass(d.classId)}
                        step={1}
                        testId={`sample-defect-class-${i}`}
                        className="w-12"
                      />
                      <span className="num flex-1 text-right text-[11px] text-faint">{d.points.length}점</span>
                      <button
                        type="button"
                        className="flex h-5 w-5 shrink-0 items-center justify-center text-faint hover:text-danger"
                        aria-label={`결함 ${i + 1} 삭제`}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeDefect(d.id)
                        }}
                        data-testid={`sample-defect-delete-${i}`}
                      >
                        ×
                      </button>
                    </div>
                    {problems[i] && <p className="pb-1 text-[11px] text-danger">{problems[i]}</p>}
                  </li>
                ))}
              </ul>
            )}
            {mode === 'select' && selected && <p className="text-[11px] text-faint">꼭짓점 드래그: 이동 · 변 중앙 □: 점 추가 · 꼭짓점 우클릭: 삭제</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2">
          <p className="min-w-0 flex-1 text-[11px]" role={submitted && error ? 'alert' : undefined} data-testid="sample-editor-message">
            {submitted && error ? <span className="text-danger">{error.message}</span> : <span className="text-faint">{blocked ?? `결함 ${defects.length}개를 라벨 txt로 만들어 샘플로 추가합니다.`}</span>}
          </p>
          <button type="button" className="btn btn-ghost px-3" onClick={onClose} disabled={busy} data-testid="sample-editor-cancel">
            취소
          </button>
          <button type="button" className="btn px-3" onClick={() => void add()} disabled={!!blocked || busy} data-testid="sample-editor-add">
            {busy ? (
              <>
                <Spinner /> 분석 중…
              </>
            ) : (
              '샘플 추가'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
