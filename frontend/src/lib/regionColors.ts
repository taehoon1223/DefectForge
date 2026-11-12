import type { Region, RegionKind } from '../types/generation'

// Display only. Chosen to stay distinct from the mask palette (red/yellow/cyan).
const INCLUDE_COLORS = ['#4f8cff', '#c084fc', '#f472b6', '#fb923c', '#a3e635']
const EXCLUDE_COLOR = '#cbd5e1'

export function regionColor(region: Pick<Region, 'id' | 'kind'>, regions: Region[]): string {
  if (region.kind === 'exclude') return EXCLUDE_COLOR
  const index = regions.filter((r) => r.kind === 'include').findIndex((r) => r.id === region.id)
  return INCLUDE_COLORS[Math.max(0, index) % INCLUDE_COLORS.length]
}

export function draftColor(kind: RegionKind, regions: Region[]): string {
  if (kind === 'exclude') return EXCLUDE_COLOR
  return INCLUDE_COLORS[regions.filter((r) => r.kind === 'include').length % INCLUDE_COLORS.length]
}
