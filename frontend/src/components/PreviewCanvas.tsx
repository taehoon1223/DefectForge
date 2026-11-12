import type Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Image as KImage, Layer, Rect, Stage } from 'react-konva'
import { clampScale, fitView, imageToScreen, isInsideImage, toPixel, zoomAt, type Vec, type ViewTransform } from '../lib/geometry'
import { useColorizedMask, useElementSize, useHtmlImage } from '../lib/hooks'
import { pngDataUrl } from '../lib/maskColors'
import { addDraftPoint, addLinePoint, closeDraft, useDrawKeyboard } from '../lib/drawActions'
import { currentConfigHash, useWorkspaceStore } from '../store/useWorkspaceStore'
import { needsReferenceLine, type ViewMode } from '../types/generation'
import { LineLayer, RegionLayer } from './AreaEditor'
import { Spinner } from './ui'

const VIEW_TABS: Array<{ mode: ViewMode; label: string }> = [
  { mode: 'original', label: '원본' },
  { mode: 'generated', label: '합성' },
  { mode: 'overlay', label: '마스크 오버레이' },
  { mode: 'classMask', label: '클래스 마스크' },
]
const ZOOM_STEP = 1.25
const DOUBLE_CLICK_MS = 350
const DOUBLE_CLICK_PX = 6
const TOUCH_CLICK_GUARD_MS = 800

export function PreviewCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const viewport = useElementSize(containerRef)
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<Vec | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [hideRegions, setHideRegions] = useState(false)
  const fittedVersion = useRef(-1)
  const lastClick = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastTouch = useRef(Number.NEGATIVE_INFINITY)

  const sourceUrl = useWorkspaceStore((s) => s.sourceUrl)
  const size = useWorkspaceStore((s) => s.sourceImageSize)
  const sourceVersion = useWorkspaceStore((s) => s.sourceVersion)
  const result = useWorkspaceStore((s) => s.currentResult)
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const opacity = useWorkspaceStore((s) => s.overlayOpacity)
  const tool = useWorkspaceStore((s) => s.tool)
  const hasOverlays = useWorkspaceStore((s) => s.regions.length > 0 || (s.referenceLine !== null && needsReferenceLine(s.form)))
  const showLine = useWorkspaceStore((s) => needsReferenceLine(s.form) || s.tool === 'line')
  const selectRegion = useWorkspaceStore((s) => s.selectRegion)
  const draft = useWorkspaceStore((s) => s.draft)
  const isGenerating = useWorkspaceStore((s) => s.isGenerating)
  const stale = useWorkspaceStore((s) => s.currentResult !== null && s.currentResultConfigHash !== currentConfigHash(s))

  const sourceImg = useHtmlImage(sourceUrl)
  const resultImg = useHtmlImage(result ? pngDataUrl(result.image_png_base64) : null)
  const maskCanvas = useColorizedMask(result?.class_mask_png_base64 ?? null)

  useDrawKeyboard()

  // Fit each newly loaded image once the viewport has a size.
  useEffect(() => {
    if (!size || viewport.width === 0 || viewport.height === 0 || fittedVersion.current === sourceVersion) return
    fittedVersion.current = sourceVersion
    setView(fitView(size, viewport))
  }, [size, viewport, sourceVersion])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        setSpaceHeld(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  /** Pointer -> original-image coordinates via the inverse of the stage's absolute transform. */
  const pointerInImage = (): Vec | null => {
    const stage = stageRef.current
    const pos = stage?.getPointerPosition()
    if (!stage || !pos) return null
    return stage.getAbsoluteTransform().copy().invert().point(pos)
  }

  /** Add a polygon vertex (draw tool) or a reference-line point (line tool) — mouse click or touch tap. */
  const handleDrawClick = (evt: MouseEvent | TouchEvent) => {
    if ((tool !== 'draw' && tool !== 'line') || spaceHeld || !size || ('button' in evt && evt.button !== 0)) return
    // Browsers follow a tap with a compatibility mouse click; handle each physical tap once.
    if (!('button' in evt)) lastTouch.current = evt.timeStamp
    else if (evt.timeStamp - lastTouch.current < TOUCH_CLICK_GUARD_MS) return
    const p = pointerInImage()
    const pointer = stageRef.current?.getPointerPosition()
    if (!p || !pointer) return
    if (tool === 'line') {
      addLinePoint(toPixel(p, size))
      return
    }
    // Own double-click test: Konva's dblclick ignores distance, so two quick clicks at
    // different spots would close the polygon by accident.
    const prev = lastClick.current
    lastClick.current = { t: evt.timeStamp, x: pointer.x, y: pointer.y }
    if (prev && evt.timeStamp - prev.t < DOUBLE_CLICK_MS && Math.hypot(pointer.x - prev.x, pointer.y - prev.y) <= DOUBLE_CLICK_PX) {
      lastClick.current = null
      closeDraft()
      return
    }
    const first = draft?.[0]
    const screenFirst = first ? imageToScreen({ x: first[0] + 0.5, y: first[1] + 0.5 }, view) : null
    const dist = screenFirst ? Math.hypot(screenFirst.x - pointer.x, screenFirst.y - pointer.y) : null
    addDraftPoint(toPixel(p, size), dist)
  }

  const zoomBy = (factor: number, anchor?: Vec) => {
    setView((v) => zoomAt(v, anchor ?? { x: viewport.width / 2, y: viewport.height / 2 }, clampScale(v.scale * factor)))
  }

  const panning = tool === 'select' || spaceHeld
  // View-only toggle; overlays always show while drawing so the user sees what they draw.
  const showOverlays = !hideRegions || tool !== 'select'
  const hoverPixel = hover && size && isInsideImage(hover, size) ? toPixel(hover, size) : null
  const hasResult = !!result
  const effectiveMode: ViewMode = hasResult ? viewMode : 'original'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex min-h-8 flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <div className="seg" role="tablist" aria-label="보기 모드">
          {VIEW_TABS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={effectiveMode === mode}
              disabled={mode !== 'original' && !hasResult}
              onClick={() => setViewMode(mode)}
              data-testid={`view-${mode}`}
              className="disabled:opacity-35"
            >
              {label}
            </button>
          ))}
        </div>
        {stale && hasResult && (
          <span className="text-[11px] text-warn" data-testid="stale-badge">
            설정 변경됨 · 표시 결과는 이전 설정 기준
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {hasOverlays && (
            <button
              type="button"
              className="btn btn-ghost px-2"
              aria-pressed={hideRegions}
              onClick={() => setHideRegions((v) => !v)}
              data-testid="toggle-regions"
            >
              {hideRegions ? '영역 표시' : '영역 숨기기'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-icon" aria-label="축소" disabled={!size} onClick={() => zoomBy(1 / ZOOM_STEP)} data-testid="zoom-out">
            −
          </button>
          <span className="num w-12 text-center text-muted" data-testid="zoom-level">
            {Math.round(view.scale * 100)}%
          </span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="확대" disabled={!size} onClick={() => zoomBy(ZOOM_STEP)} data-testid="zoom-in">
            +
          </button>
          <button type="button" className="btn btn-ghost px-2" disabled={!size} onClick={() => size && setView(fitView(size, viewport))} data-testid="zoom-fit">
            맞춤
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2"
            disabled={!size}
            onClick={() => setView((v) => zoomAt(v, { x: viewport.width / 2, y: viewport.height / 2 }, 1))}
            data-testid="zoom-100"
          >
            1:1
          </button>
        </div>
      </div>

      {/* stage */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-bg"
        style={{ cursor: !size ? 'default' : panning ? 'grab' : 'crosshair' }}
        data-testid="canvas-container"
        data-scale={view.scale}
        data-offset-x={view.x}
        data-offset-y={view.y}
        onContextMenu={(e) => e.preventDefault()}
      >
        {size && viewport.width > 0 && (
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
              const anchor = stageRef.current?.getPointerPosition() ?? undefined
              zoomBy(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, anchor)
            }}
            onMouseMove={() => setHover(pointerInImage())}
            onMouseLeave={() => setHover(null)}
            onTap={(e) => handleDrawClick(e.evt)}
            onClick={(e) => {
              // A click on empty canvas in select mode clears the region selection.
              if (tool === 'select' && e.target === e.target.getStage()) selectRegion(null)
              handleDrawClick(e.evt)
            }}
          >
            <Layer imageSmoothingEnabled={false} listening={false}>
              {(effectiveMode === 'original' || !resultImg) && (
                <>
                  <Rect width={size.width} height={size.height} fill="#ffffff" />
                  {sourceImg && <KImage image={sourceImg} width={size.width} height={size.height} />}
                </>
              )}
              {(effectiveMode === 'generated' || effectiveMode === 'overlay') && resultImg && <KImage image={resultImg} width={size.width} height={size.height} />}
              {effectiveMode === 'overlay' && maskCanvas && <KImage image={maskCanvas} width={size.width} height={size.height} opacity={opacity} />}
              {effectiveMode === 'classMask' && (
                <>
                  <Rect width={size.width} height={size.height} fill="#000000" />
                  {maskCanvas && <KImage image={maskCanvas} width={size.width} height={size.height} />}
                </>
              )}
              <Rect width={size.width} height={size.height} stroke="#3a3a3a" strokeWidth={1} strokeScaleEnabled={false} />
            </Layer>
            <Layer>
              <RegionLayer scale={view.scale} imageSize={size} hover={hover} showRegions={showOverlays} />
            </Layer>
            {showOverlays && showLine && (
              <Layer>
                <LineLayer scale={view.scale} imageSize={size} hover={hover} />
              </Layer>
            )}
          </Stage>
        )}

        {!size && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-[13px] text-ink">정상 이미지를 업로드하세요</p>
            <p className="max-w-sm leading-relaxed text-faint">
              왼쪽 패널에서 PNG/JPEG/WebP 파일을 올리면 여기에서 영역을 그리고 합성 결과와 마스크를 확인할 수 있습니다.
            </p>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-2 rounded-[2px] bg-[rgba(30,30,30,0.85)] px-2.5 py-1 text-ink">
            <Spinner className="text-muted" /> 생성 중…
          </div>
        )}
      </div>

      {/* footer readout */}
      <div className="num flex h-6 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-faint">
        <span data-testid="cursor-readout">{hoverPixel ? `x ${hoverPixel[0]}  y ${hoverPixel[1]}` : 'x —  y —'}</span>
        {size && (
          <span>
            원본 {size.width} × {size.height} px
          </span>
        )}
        <span className="ml-auto hidden sm:inline">휠: 확대/축소 · {tool === 'select' ? '드래그' : 'Space+드래그'}: 이동</span>
      </div>
    </div>
  )
}
