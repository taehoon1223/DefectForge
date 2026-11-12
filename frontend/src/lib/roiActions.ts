import { useEffect } from 'react'
import { validateRoi } from './geometry'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { LIMITS, type Point } from '../types/generation'

const CLOSE_RADIUS_PX = 9

function store() {
  return useWorkspaceStore.getState()
}

// ---------------------------------------------------------------- actions shared by canvas + panel

export function startDrawing() {
  store().setRoiDraft(null)
  store().setTool('draw')
}

export function cancelDrawing() {
  store().setRoiDraft(null)
  store().setTool('select')
}

export function closeDraft(): boolean {
  const { roiDraft, sourceImageSize, setRoi, setRoiDraft, setTool, pushToast } = store()
  if (!roiDraft || !sourceImageSize) return false
  const problem = validateRoi(roiDraft, sourceImageSize, LIMITS.roiMaxPoints)
  if (problem) {
    pushToast('error', problem)
    return false
  }
  setRoi(roiDraft)
  setRoiDraft(null)
  setTool('select')
  return true
}

/** Handle a click in draw mode. `screenDistanceToFirst` decides whether the click closes the polygon. */
export function addDraftPoint(pixel: Point, screenDistanceToFirst: number | null) {
  const { roiDraft, setRoiDraft, pushToast } = store()
  const draft = roiDraft ?? []
  if (draft.length >= 3 && screenDistanceToFirst !== null && screenDistanceToFirst <= CLOSE_RADIUS_PX) {
    closeDraft()
    return
  }
  const last = draft[draft.length - 1]
  if (last && last[0] === pixel[0] && last[1] === pixel[1]) return
  if (draft.length >= LIMITS.roiMaxPoints) {
    pushToast('error', `ROI 점은 최대 ${LIMITS.roiMaxPoints}개까지 지정할 수 있습니다.`)
    return
  }
  setRoiDraft([...draft, pixel])
}

export function useRoiKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      const { tool, roiDraft, sourceImageSize, setRoiDraft, setTool } = store()
      if (!sourceImageSize) return
      if (tool === 'draw') {
        if (e.key === 'Enter') {
          e.preventDefault()
          closeDraft()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelDrawing()
        } else if (e.key === 'Backspace' && roiDraft?.length) {
          e.preventDefault()
          setRoiDraft(roiDraft.length > 1 ? roiDraft.slice(0, -1) : null)
        }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'v' || e.key === 'V') setTool('select')
      if (e.key === 'p' || e.key === 'P') startDrawing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
