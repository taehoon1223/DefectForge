import { z } from 'zod'
import limits from './limits.json'

export const LIMITS = limits

export type DefectType = 'scratch' | 'pinhole' | 'contamination'
export type ViewMode = 'original' | 'generated' | 'overlay' | 'classMask'
export type Polarity = 'dark' | 'bright' | 'random'
export type Range = [number, number]
export type Point = [number, number]

export const DEFECT_TYPES: DefectType[] = ['scratch', 'pinhole', 'contamination']

export const CLASS_IDS: Record<DefectType, number> = { scratch: 1, pinhole: 2, contamination: 3 }

/** include = 결함을 넣을 곳 (없으면 이미지 전체), exclude = 그중 빼는 곳. */
export type RegionKind = 'include' | 'exclude'
export type Region = { id: string; name: string; kind: RegionKind; polygon: Point[] }
/** Direction reference for scratches (two pixel indices; direction is modulo 180°). */
export type ReferenceLine = { start: Point; end: Point }
/** random = 각도 범위에서 무작위 (config 1.0과 같음), parallel/perpendicular = 기준선 기준, absolute = 지정 각도. */
export type OrientationMode = 'random' | 'parallel' | 'perpendicular' | 'absolute'
/** fixed = 검정/흰색 쪽으로 섞기 (config 1.0과 같음), local = 원본 국소 밝기·색에 맞추기. */
export type ShadingMode = 'fixed' | 'local'

export type ScratchParams = {
  length_px: Range
  width_px: Range
  angle_deg: Range
  contrast: Range
  polarity: Polarity
  curvature: number
  orientation: { mode: OrientationMode; angle_deg: number; jitter_deg: number }
  shading: { mode: ShadingMode; window_sigma_px: number; min_texture_ratio: number }
}
export type PinholeParams = {
  radius_px: Range
  irregularity: number
  contrast: Range
  polarity: Polarity
  rim_strength: number
}
export type ContaminationParams = {
  radius_px: Range
  irregularity: number
  opacity: Range
  blur_sigma: number
  polarity: Polarity
}
export type ParamsByType = {
  scratch: ScratchParams
  pinhole: PinholeParams
  contamination: ContaminationParams
}

export type DefectSpec = { [K in DefectType]: { type: K; count: number; params: ParamsByType[K] } }[DefectType]

/**
 * API request contract (config 1.1). It is a superset of 1.0: with no regions, margin 0, orientation
 * "random" and shading "fixed" the server produces exactly the 1.0 pixels, so the UI only sends 1.1.
 */
export type GenerationConfig = {
  version: '1.1'
  seed: number
  allow_overlap: boolean
  regions: Region[]
  edge_margin_px: number
  reference_line: ReferenceLine | null
  defects: DefectSpec[]
}

/** Form state: every type keeps its settings even while disabled. */
export type DefectFormEntry<K extends DefectType> = { enabled: boolean; count: number; params: ParamsByType[K] }
export type DefectForm = { [K in DefectType]: DefectFormEntry<K> }
export type FormState = { seed: number; allowOverlap: boolean; edgeMarginPx: number; defects: DefectForm }

export type InstanceInfo = {
  id: number
  class_id: number
  type: DefectType
  bbox_xyxy: [number, number, number, number]
  center_xy: [number, number]
  changed_pixel_count: number
  attempts: number
  params: Record<string, unknown>
}

/** Response metadata (config 1.1, see backend core/generation_v11.py). Displayed, not computed on. */
export type GenerationMetadata = {
  version: string
  engine_version: string
  seed: number
  source_sha256: string
  width: number
  height: number
  class_map: Record<string, string>
  bbox_format: string
  allow_overlap: boolean
  requested_count: number
  generated_count: number
  changed_pixel_count: number
  class_pixel_counts: Record<DefectType, number>
  instances: InstanceInfo[]
  config: GenerationConfig
  area: {
    full_image: boolean
    edge_margin_px: number
    include_pixel_count: number
    excluded_pixel_count: number
    allowed_pixel_count: number
    regions: Array<{ id: string; kind: RegionKind; polygon: Point[]; pixel_count: number; mask_sha256: string }>
  }
  reference_line: { start: Point; end: Point; angle_deg: number; length_px: number } | null
  surface_analysis: Record<string, unknown> | null
  algorithm_versions: Record<string, string | null>
}

export type PreviewResponse = {
  image_png_base64: string
  class_mask_png_base64: string
  binary_mask_png_base64: string
  metadata: GenerationMetadata
  processing_ms: number
}

export const DEFECT_LABELS: Record<DefectType, string> = {
  scratch: '스크래치',
  pinhole: '핀홀',
  contamination: '오염',
}

export const REGION_KIND_LABELS: Record<RegionKind, string> = {
  include: '생성 영역',
  exclude: '제외 영역',
}

const ENABLED_BY_DEFAULT: Record<DefectType, boolean> = { scratch: true, pinhole: true, contamination: true }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function defaultDefectForm(): DefectForm {
  const make = <K extends DefectType>(type: K, extra: object = {}): DefectFormEntry<K> => {
    // limits.json widens tuples to number[]; the backend contract test guarantees the shapes.
    const { count, ...params } = clone(LIMITS.defects[type].defaults) as unknown as { count: number } & ParamsByType[K]
    return { enabled: ENABLED_BY_DEFAULT[type], count, params: { ...params, ...clone(extra) } as unknown as ParamsByType[K] }
  }
  return { scratch: make('scratch', LIMITS.scratchOptions.defaults), pinhole: make('pinhole'), contamination: make('contamination') }
}

export function defaultFormState(): FormState {
  return { seed: LIMITS.seed.default, allowOverlap: false, edgeMarginPx: LIMITS.area.defaults.edge_margin_px, defects: defaultDefectForm() }
}

/** The reference line only matters for scratches oriented along/across it. */
export function needsReferenceLine(form: FormState): boolean {
  const scratch = form.defects.scratch
  return scratch.enabled && (scratch.params.orientation.mode === 'parallel' || scratch.params.orientation.mode === 'perpendicular')
}

/** Enabled defects in the fixed application order (later classes win on overlap). */
export function buildGenerationConfig(form: FormState, regions: Region[], line: ReferenceLine | null): GenerationConfig {
  const defects = DEFECT_TYPES.filter((t) => form.defects[t].enabled).map(
    (t) => ({ type: t, count: form.defects[t].count, params: clone(form.defects[t].params) }) as DefectSpec,
  )
  return {
    version: '1.1',
    seed: form.seed,
    allow_overlap: form.allowOverlap,
    regions: regions.map((r) => ({ id: r.id, name: r.name, kind: r.kind, polygon: r.polygon.map(([x, y]) => [x, y] as Point) })),
    edge_margin_px: form.edgeMarginPx,
    // An unused line would only make an unchanged result look "changed", so it is not sent.
    reference_line: line && needsReferenceLine(form) ? { start: [...line.start] as Point, end: [...line.end] as Point } : null,
    defects,
  }
}

/** What determines the generated pixels: region names are display-only and are left out. */
export function resultDeterminingConfig(config: GenerationConfig): unknown {
  return { ...config, regions: config.regions.map(({ id, kind, polygon }) => ({ id, kind, polygon })) }
}

/** Direction of start->end in image coordinates, [0, 180). Mirrors backend line_angle_deg. */
export function lineAngleDeg(start: Point, end: Point): number {
  let dx = end[0] - start[0]
  let dy = end[1] - start[1]
  if (dy < 0 || (dy === 0 && dx < 0)) {
    dx = -dx
    dy = -dy
  }
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  // Flipping dy = 0 yields -0 in JS (Python ints have no negative zero); normalise it.
  return angle >= 180 || angle === 0 ? 0 : angle
}

/** Order-stable JSON used to detect "settings changed since the last preview". */
export function fingerprint(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return JSON.stringify(normalize(value))
}

// ---------------------------------------------------------------- Zod (frontend validation)

const fmt = (n: number) => String(Number(n.toFixed(4)))
const NUMBER_ERROR = { error: '숫자를 입력하세요' }

function rangeSchema([lo, hi]: number[]) {
  return z.tuple([z.number(NUMBER_ERROR), z.number(NUMBER_ERROR)]).superRefine(([a, b], ctx) => {
    if (!(a >= lo && a <= hi && b >= lo && b <= hi)) {
      ctx.addIssue({ code: 'custom', message: `${fmt(lo)}~${fmt(hi)} 범위여야 합니다` })
    } else if (a > b) {
      ctx.addIssue({ code: 'custom', message: '최솟값이 최댓값보다 클 수 없습니다' })
    }
  })
}

function scalarSchema([lo, hi]: number[]) {
  return z
    .number(NUMBER_ERROR)
    .min(lo, { error: `${fmt(lo)} 이상이어야 합니다` })
    .max(hi, { error: `${fmt(hi)} 이하여야 합니다` })
}

function countSchema([lo, hi]: number[]) {
  return z
    .number(NUMBER_ERROR)
    .int({ error: '정수를 입력하세요' })
    .min(lo, { error: `${lo} 이상이어야 합니다` })
    .max(hi, { error: `${hi} 이하여야 합니다` })
}

const polaritySchema = z.enum(['dark', 'bright', 'random'], { error: 'dark/bright/random 중 하나여야 합니다' })
const L = LIMITS.defects
const SO = LIMITS.scratchOptions.limits

export const defectSchemas = {
  scratch: z.object({
    type: z.literal('scratch'),
    count: countSchema(L.scratch.limits.count),
    params: z.strictObject({
      length_px: rangeSchema(L.scratch.limits.length_px),
      width_px: rangeSchema(L.scratch.limits.width_px),
      angle_deg: rangeSchema(L.scratch.limits.angle_deg),
      contrast: rangeSchema(L.scratch.limits.contrast),
      polarity: polaritySchema,
      curvature: scalarSchema(L.scratch.limits.curvature),
      orientation: z.strictObject({
        mode: z.enum(['random', 'parallel', 'perpendicular', 'absolute'], { error: '방향을 선택하세요' }),
        angle_deg: scalarSchema(SO.angle_deg),
        jitter_deg: scalarSchema(SO.jitter_deg),
      }),
      shading: z.strictObject({
        mode: z.enum(['fixed', 'local'], { error: '명암 방식을 선택하세요' }),
        window_sigma_px: scalarSchema(SO.window_sigma_px),
        min_texture_ratio: scalarSchema(SO.min_texture_ratio),
      }),
    }),
  }),
  pinhole: z.object({
    type: z.literal('pinhole'),
    count: countSchema(L.pinhole.limits.count),
    params: z.strictObject({
      radius_px: rangeSchema(L.pinhole.limits.radius_px),
      irregularity: scalarSchema(L.pinhole.limits.irregularity),
      contrast: rangeSchema(L.pinhole.limits.contrast),
      polarity: polaritySchema,
      rim_strength: scalarSchema(L.pinhole.limits.rim_strength),
    }),
  }),
  contamination: z.object({
    type: z.literal('contamination'),
    count: countSchema(L.contamination.limits.count),
    params: z.strictObject({
      radius_px: rangeSchema(L.contamination.limits.radius_px),
      irregularity: scalarSchema(L.contamination.limits.irregularity),
      opacity: rangeSchema(L.contamination.limits.opacity),
      blur_sigma: scalarSchema(L.contamination.limits.blur_sigma),
      polarity: polaritySchema,
    }),
  }),
} as const

export const seedSchema = z
  .number(NUMBER_ERROR)
  .int({ error: 'Seed는 정수여야 합니다' })
  .min(LIMITS.seed.min, { error: `Seed는 ${LIMITS.seed.min} 이상이어야 합니다` })
  .max(LIMITS.seed.max, { error: `Seed는 ${LIMITS.seed.max} 이하여야 합니다` })

const edgeMarginSchema = scalarSchema(LIMITS.area.limits.edge_margin_px)
const pointSchema = z.tuple([z.number().int(), z.number().int()])

export const generationConfigSchema = z.strictObject({
  version: z.literal('1.1'),
  seed: seedSchema,
  allow_overlap: z.boolean(),
  regions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[A-Za-z0-9_-]+$/),
        name: z.string().min(1).max(40),
        kind: z.enum(['include', 'exclude']),
        polygon: z.array(pointSchema).max(LIMITS.roiMaxPoints),
      }),
    )
    .max(LIMITS.area.regionMaxCount),
  edge_margin_px: edgeMarginSchema,
  reference_line: z.strictObject({ start: pointSchema, end: pointSchema }).nullable(),
  defects: z
    .array(z.discriminatedUnion('type', [defectSchemas.scratch, defectSchemas.pinhole, defectSchemas.contamination]))
    .min(1, { error: '결함 유형을 하나 이상 선택하세요' })
    .max(3),
})

/** Field errors keyed like "scratch.params.length_px", "scratch.params.orientation.jitter_deg", "scratch.count", "seed", "edgeMarginPx", "defects". */
export type FormErrors = Record<string, string>

export function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {}
  const seed = seedSchema.safeParse(form.seed)
  if (!seed.success) errors.seed = seed.error.issues[0].message
  const margin = edgeMarginSchema.safeParse(form.edgeMarginPx)
  if (!margin.success) errors.edgeMarginPx = margin.error.issues[0].message
  const enabled = DEFECT_TYPES.filter((t) => form.defects[t].enabled)
  if (enabled.length === 0) errors.defects = '결함 유형을 하나 이상 선택하세요'
  for (const type of enabled) {
    const entry = form.defects[type]
    const result = defectSchemas[type].safeParse({ type, count: entry.count, params: entry.params })
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = [type, ...issue.path.filter((p) => typeof p === 'string')].join('.')
        errors[key] ??= issue.message
      }
    }
  }
  return errors
}
