import { useEffect } from 'react'
import { validateRoi } from './geometry'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS, REGION_KIND_LABELS, type Point, type RegionKind } from '../types/generation'

const CLOSE_RADIUS_PX = 9

function store() {
  return useWorkspaceStore.getState()
}

// ---------------------------------------------------------------- actions shared by canvas + panels

/** Draw a new include/exclude polygon. */
export function startRegionDrawing(kind: RegionKind) {
  const s = store()
  s.setDraft(null)
  s.setLineDraft(null)
  s.setDrawKind(kind)
  s.setTool('draw')
}

export function startLineDrawing() {
  const s = store()
  s.setDraft(null)
  s.setLineDraft(null)
  s.setTool('line')
}

export function cancelDrawing() {
  const s = store()
  s.setDraft(null)
  s.setLineDraft(null)
  s.setTool('select')
}

export function closeDraft(): boolean {
  const { draft, sourceImageSize, drawKind, setDraft, setTool, addRegion, pushToast } = store()
  if (!draft || !sourceImageSize) return false
  const problem = validateRoi(draft, sourceImageSize, LIMITS.roiMaxPoints, REGION_KIND_LABELS[drawKind])
  if (problem) {
    pushToast('error', problem)
    return false
  }
  addRegion(drawKind, draft)
  setDraft(null)
  setTool('select')
  return true
}

/** Handle a click in draw mode. `screenDistanceToFirst` decides whether the click closes the polygon. */
export function addDraftPoint(pixel: Point, screenDistanceToFirst: number | null) {
  const { draft: current, setDraft, pushToast } = store()
  const draft = current ?? []
  if (draft.length >= 3 && screenDistanceToFirst !== null && screenDistanceToFirst <= CLOSE_RADIUS_PX) {
    closeDraft()
    return
  }
  const last = draft[draft.length - 1]
  if (last && last[0] === pixel[0] && last[1] === pixel[1]) return
  if (draft.length >= LIMITS.roiMaxPoints) {
    pushToast('error', `다각형 점은 최대 ${LIMITS.roiMaxPoints}개까지 지정할 수 있습니다.`)
    return
  }
  setDraft([...draft, pixel])
}

/** First click sets the line start, the second sets its end (both in original pixel coordinates). */
export function addLinePoint(pixel: Point) {
  const { lineDraft, setLineDraft, setReferenceLine, setTool, pushToast } = store()
  if (!lineDraft) {
    setLineDraft(pixel)
    return
  }
  const length = Math.hypot(pixel[0] - lineDraft[0], pixel[1] - lineDraft[1])
  if (length < LIMITS.area.referenceLineMinLengthPx) {
    pushToast('error', `기준선의 두 점은 ${LIMITS.area.referenceLineMinLengthPx}px 이상 떨어져야 합니다.`)
    return
  }
  setReferenceLine({ start: lineDraft, end: pixel })
  setLineDraft(null)
  setTool('select')
}

export function useDrawKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      const { tool, draft, sourceImageSize, setDraft } = store()
      if (!sourceImageSize) return
      if (tool === 'draw') {
        if (e.key === 'Enter') {
          e.preventDefault()
          closeDraft()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelDrawing()
        } else if (e.key === 'Backspace' && draft?.length) {
          e.preventDefault()
          setDraft(draft.length > 1 ? draft.slice(0, -1) : null)
        }
      }
      if (tool === 'line' && e.key === 'Escape') {
        e.preventDefault()
        cancelDrawing()
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'v' || e.key === 'V') cancelDrawing()
      if (e.key === 'p' || e.key === 'P') startRegionDrawing('include')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
