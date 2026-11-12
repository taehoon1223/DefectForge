import type { ReactNode } from 'react'
import { cancelDrawing, startLineDrawing } from '../lib/drawActions'
import { CLASS_COLORS, rgbCss } from '../lib/maskColors'
import { blockingReason, lineAngle, useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFECT_LABELS, DEFECT_TYPES, LIMITS, validateForm, type DefectType, type FormErrors, type ParamsByType, type Polarity } from '../types/generation'
import { Disclosure, FieldError, NumberField, RangeField, Row, Section, SliderField, Spinner } from './ui'

const POLARITY_OPTIONS: Array<{ value: Polarity; label: string }> = [
  { value: 'dark', label: '어둡게' },
  { value: 'bright', label: '밝게' },
  { value: 'random', label: '랜덤' },
]

const DESCRIPTIONS: Record<DefectType, string> = {
  scratch: '선형 긁힘 · 길이 방향 강도 변화',
  pinhole: '미세 점 형태 (pinhole-like appearance)',
  contamination: '먼지·이물·얼룩 형태의 불규칙 blob',
  texture: '불규칙한 모양 안에 다른 질감을 섞음 (DRAEM 방식)',
  patch: '이미지의 다른 부분을 돌려서 경계 없이 섞어 넣음 (NSA 방식)',
}

/** Error keys shown next to always-visible controls; any other params error opens "세부 설정". */
const CORE_ERROR_KEYS = new Set([
  'scratch.params.polarity',
  'scratch.params.orientation.mode',
  'scratch.params.orientation.angle_deg',
  'scratch.params.shading.mode',
  'texture.params.source',
  'patch.params.blend',
])

const SO = LIMITS.scratchOptions.limits

function useParam<K extends DefectType>(type: K) {
  const params = useWorkspaceStore((s) => s.form.defects[type].params) as ParamsByType[K]
  const setDefectParam = useWorkspaceStore((s) => s.setDefectParam)
  const set = <P extends keyof ParamsByType[K]>(key: P, value: ParamsByType[K][P]) => setDefectParam(type, key, value)
  return [params, set] as const
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  testId: string
}) {
  return (
    <Row label={label}>
      <div className="seg w-full" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className="flex-1" aria-pressed={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testId}-${o.value}`}>
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  )
}

export function PolarityField({ value, onChange, testId }: { value: Polarity; onChange: (v: Polarity) => void; testId: string }) {
  return <Segmented label="극성" options={POLARITY_OPTIONS} value={value} onChange={onChange} testId={testId} />
}

const err = (errors: FormErrors, type: DefectType, key: string) => errors[`${type}.params.${key}`]

// ---------------------------------------------------------------- scratch

type Direction = 'random' | 'line' | 'absolute'
const DIRECTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'random', label: '무작위' },
  { value: 'line', label: '기준선' },
  { value: 'absolute', label: '각도' },
]

function ReferenceLineControl() {
  const line = useWorkspaceStore((s) => s.referenceLine)
  const draft = useWorkspaceStore((s) => s.lineDraft)
  const tool = useWorkspaceStore((s) => s.tool)
  const size = useWorkspaceStore((s) => s.sourceImageSize)
  const setReferenceLine = useWorkspaceStore((s) => s.setReferenceLine)
  const angle = lineAngle(line)

  if (tool === 'line') {
    return (
      <Row label="기준선" testId="line-status">
        <span className="flex-1 text-accent">{draft ? '두 번째 점을 클릭' : '이미지에서 첫 점을 클릭'}</span>
        <button type="button" className="btn btn-ghost h-5 px-1.5" onClick={cancelDrawing} data-testid="line-cancel">
          취소
        </button>
      </Row>
    )
  }
  if (!line || angle === null) {
    return (
      <Row label="기준선">
        <button
          type="button"
          className="btn w-full"
          disabled={!size}
          onClick={startLineDrawing}
          title="부품의 긴 방향처럼 스크래치 방향의 기준이 되는 선을 두 점으로 찍습니다"
          data-testid="line-start"
        >
          두 점 찍어 그리기
        </button>
      </Row>
    )
  }
  return (
    <Row label="기준선">
      <span
        className="num flex-1 text-ink"
        title={`(${line.start.join(', ')}) → (${line.end.join(', ')})`}
        data-testid="line-readout"
        data-start-x={line.start[0]}
        data-start-y={line.start[1]}
        data-end-x={line.end[0]}
        data-end-y={line.end[1]}
        data-angle={angle}
      >
        {angle.toFixed(1)}°
      </span>
      <button type="button" className="btn btn-ghost h-5 px-1.5" onClick={startLineDrawing} data-testid="line-start">
        다시
      </button>
      <button type="button" className="btn btn-ghost h-5 px-1.5" onClick={() => setReferenceLine(null)} data-testid="line-delete">
        삭제
      </button>
    </Row>
  )
}

function ScratchCore({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('scratch')
  const setOrientation = useWorkspaceStore((s) => s.setScratchOrientation)
  const setShading = useWorkspaceStore((s) => s.setScratchShading)
  const mode = p.orientation.mode
  const direction: Direction = mode === 'parallel' || mode === 'perpendicular' ? 'line' : mode
  return (
    <>
      <Segmented
        label="방향"
        options={DIRECTIONS}
        value={direction}
        onChange={(d) => setOrientation({ mode: d === 'line' ? (direction === 'line' ? mode : 'parallel') : d })}
        testId="orient"
      />
      {direction === 'line' && (
        <>
          <ReferenceLineControl />
          <Row label="">
            <div className="seg w-full" role="group" aria-label="기준선 대비 방향">
              <button type="button" className="flex-1" aria-pressed={mode === 'parallel'} onClick={() => setOrientation({ mode: 'parallel' })} data-testid="orient-parallel">
                평행
              </button>
              <button type="button" className="flex-1" aria-pressed={mode === 'perpendicular'} onClick={() => setOrientation({ mode: 'perpendicular' })} data-testid="orient-perpendicular">
                수직
              </button>
            </div>
          </Row>
        </>
      )}
      {direction === 'absolute' && (
        <div>
          <Row label="각도">
            <NumberField
              label="지정 각도"
              value={p.orientation.angle_deg}
              step={5}
              invalid={!!err(errors, 'scratch', 'orientation.angle_deg')}
              onChange={(v) => setOrientation({ angle_deg: v })}
              className="w-16 text-right"
              testId="scratch-angle-fixed"
            />
            <span className="text-[11px] text-faint">° (0–180, x축 기준)</span>
          </Row>
          <FieldError message={err(errors, 'scratch', 'orientation.angle_deg')} />
        </div>
      )}
      <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="scratch-polarity" />
      <Row label="표면 맞춤">
        <label
          className="flex cursor-pointer items-center gap-2 text-ink"
          title="원본에서 생성 영역 안 픽셀만으로 구한 국소 평균 색·밝기에 맞춰, 주변 표면 색의 더 어두운/밝은 톤으로 그립니다. 조명·3D 형상을 복원하는 것은 아닙니다."
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={p.shading.mode === 'local'}
            onChange={(e) => setShading({ mode: e.target.checked ? 'local' : 'fixed' })}
            data-testid="surface-match"
          />
          표면 밝기에 맞추기
        </label>
      </Row>
    </>
  )
}

function ScratchDetails({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('scratch')
  const setOrientation = useWorkspaceStore((s) => s.setScratchOrientation)
  const setShading = useWorkspaceStore((s) => s.setScratchShading)
  const lim = LIMITS.defects.scratch.limits
  const local = p.shading.mode === 'local'
  return (
    <>
      <RangeField label="길이" unit="px" value={p.length_px} onChange={(v) => set('length_px', v)} error={err(errors, 'scratch', 'length_px')} testId="scratch-length" />
      <RangeField label="폭" unit="px" value={p.width_px} onChange={(v) => set('width_px', v)} error={err(errors, 'scratch', 'width_px')} step={0.5} testId="scratch-width" />
      <RangeField label="대비" value={p.contrast} onChange={(v) => set('contrast', v)} error={err(errors, 'scratch', 'contrast')} step={0.05} testId="scratch-contrast" />
      {p.orientation.mode === 'random' && (
        <RangeField label="각도 범위" unit="°" value={p.angle_deg} onChange={(v) => set('angle_deg', v)} error={err(errors, 'scratch', 'angle_deg')} step={5} testId="scratch-angle" />
      )}
      <SliderField label="곡률" value={p.curvature} min={lim.curvature[0]} max={lim.curvature[1]} step={0.05} onChange={(v) => set('curvature', v)} error={err(errors, 'scratch', 'curvature')} />
      {p.orientation.mode !== 'random' && (
        <SliderField
          label="흔들림 ±"
          value={p.orientation.jitter_deg}
          min={SO.jitter_deg[0]}
          max={SO.jitter_deg[1]}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          onChange={(v) => setOrientation({ jitter_deg: v })}
          error={err(errors, 'scratch', 'orientation.jitter_deg')}
          testId="scratch-jitter"
        />
      )}
      {local && (
        <>
          <SliderField
            label="통계 창 σ"
            value={p.shading.window_sigma_px}
            min={SO.window_sigma_px[0]}
            max={SO.window_sigma_px[1]}
            step={1}
            format={(v) => `${v.toFixed(0)} px`}
            onChange={(v) => setShading({ window_sigma_px: v })}
            error={err(errors, 'scratch', 'shading.window_sigma_px')}
          />
          <SliderField
            label="최소 대비"
            value={p.shading.min_texture_ratio}
            min={SO.min_texture_ratio[0]}
            max={SO.min_texture_ratio[1]}
            step={0.25}
            format={(v) => `${v.toFixed(2)}σ`}
            onChange={(v) => setShading({ min_texture_ratio: v })}
            error={err(errors, 'scratch', 'shading.min_texture_ratio')}
          />
          <p className="text-[11px] leading-relaxed text-faint">표면 맞춤에서 대비는 주변 밝기의 여유 대비 비율, 최소 대비는 표면 결 표준편차의 배수입니다.</p>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- pinhole / contamination

function PinholeCore() {
  const [p, set] = useParam('pinhole')
  return <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="pinhole-polarity" />
}

function PinholeDetails({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('pinhole')
  const lim = LIMITS.defects.pinhole.limits
  return (
    <>
      <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'pinhole', 'radius_px')} testId="pinhole-radius" />
      <RangeField label="대비" value={p.contrast} onChange={(v) => set('contrast', v)} error={err(errors, 'pinhole', 'contrast')} step={0.05} testId="pinhole-contrast" />
      <SliderField label="불규칙도" value={p.irregularity} min={lim.irregularity[0]} max={lim.irregularity[1]} step={0.05} onChange={(v) => set('irregularity', v)} error={err(errors, 'pinhole', 'irregularity')} />
      <SliderField label="테두리" value={p.rim_strength} min={lim.rim_strength[0]} max={lim.rim_strength[1]} step={0.05} onChange={(v) => set('rim_strength', v)} error={err(errors, 'pinhole', 'rim_strength')} />
    </>
  )
}

function ContaminationCore() {
  const [p, set] = useParam('contamination')
  return <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="contamination-polarity" />
}

function ContaminationDetails({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('contamination')
  const lim = LIMITS.defects.contamination.limits
  return (
    <>
      <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'contamination', 'radius_px')} testId="contamination-radius" />
      <RangeField label="불투명도" value={p.opacity} onChange={(v) => set('opacity', v)} error={err(errors, 'contamination', 'opacity')} step={0.05} testId="contamination-opacity" />
      <SliderField label="불규칙도" value={p.irregularity} min={lim.irregularity[0]} max={lim.irregularity[1]} step={0.05} onChange={(v) => set('irregularity', v)} error={err(errors, 'contamination', 'irregularity')} />
      <SliderField label="흐림 σ" value={p.blur_sigma} min={lim.blur_sigma[0]} max={lim.blur_sigma[1]} step={0.25} format={(v) => `${v.toFixed(2)}`} onChange={(v) => set('blur_sigma', v)} error={err(errors, 'contamination', 'blur_sigma')} />
    </>
  )
}

// ---------------------------------------------------------------- texture / patch (config 1.1)

function TextureCore() {
  const [p, set] = useParam('texture')
  return (
    <Segmented
      label="질감"
      options={[
        { value: 'self', label: '이미지에서' },
        { value: 'noise', label: '노이즈' },
      ]}
      value={p.source}
      onChange={(v) => set('source', v)}
      testId="texture-source"
    />
  )
}

function TextureDetails({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('texture')
  const lim = LIMITS.defects.texture.limits
  return (
    <>
      <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'texture', 'radius_px')} testId="texture-radius" />
      <RangeField label="불투명도" value={p.opacity} onChange={(v) => set('opacity', v)} error={err(errors, 'texture', 'opacity')} step={0.05} testId="texture-opacity" />
      <SliderField label="거칠기" value={p.roughness} min={lim.roughness[0]} max={lim.roughness[1]} step={0.05} onChange={(v) => set('roughness', v)} error={err(errors, 'texture', 'roughness')} />
      <p className="text-[11px] leading-relaxed text-faint">‘이미지에서’는 같은 이미지의 다른 곳을 돌리고 밝기를 바꿔 채우고, ‘노이즈’는 주변 색에 노이즈 무늬를 입힙니다.</p>
    </>
  )
}

function PatchCore() {
  const [p, set] = useParam('patch')
  return (
    <Segmented
      label="섞기"
      options={[
        { value: 'source', label: '패치 결 유지' },
        { value: 'mixed', label: '표면과 섞기' },
      ]}
      value={p.blend}
      onChange={(v) => set('blend', v)}
      testId="patch-blend"
    />
  )
}

function PatchDetails({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('patch')
  return (
    <>
      <RangeField label="크기" unit="px" value={p.size_px} onChange={(v) => set('size_px', v)} error={err(errors, 'patch', 'size_px')} testId="patch-size" />
      <RangeField label="배율" value={p.scale} onChange={(v) => set('scale', v)} error={err(errors, 'patch', 'scale')} step={0.05} testId="patch-scale" />
      <p className="text-[11px] leading-relaxed text-faint">
        같은 이미지의 다른 곳을 90°/270° 돌려 포아송 블렌딩으로 붙입니다. 결이 있는 표면에서 잘 보이고, ‘표면과 섞기’는 더 은은합니다.
      </p>
    </>
  )
}

const CONTROLS: Record<DefectType, { Core: (props: { errors: FormErrors }) => ReactNode; Details: (props: { errors: FormErrors }) => ReactNode }> = {
  scratch: { Core: ScratchCore, Details: ScratchDetails },
  pinhole: { Core: PinholeCore, Details: PinholeDetails },
  contamination: { Core: ContaminationCore, Details: ContaminationDetails },
  texture: { Core: TextureCore, Details: TextureDetails },
  patch: { Core: PatchCore, Details: PatchDetails },
}

/** One panel per defect type; the title-bar checkbox turns it on/off (like a darktable module). */
function DefectPanel({ type, errors }: { type: DefectType; errors: FormErrors }) {
  const entry = useWorkspaceStore((s) => s.form.defects[type])
  const setEnabled = useWorkspaceStore((s) => s.setDefectEnabled)
  const setCount = useWorkspaceStore((s) => s.setDefectCount)
  const { Core, Details } = CONTROLS[type]
  const detailError = Object.keys(errors).some((k) => k.startsWith(`${type}.params.`) && !CORE_ERROR_KEYS.has(k))
  return (
    <Section
      title={DEFECT_LABELS[type]}
      testId={`defect-${type}`}
      dimmed={!entry.enabled}
      leading={
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          aria-label={`${DEFECT_LABELS[type]} 사용`}
          title={DESCRIPTIONS[type]}
          checked={entry.enabled}
          onChange={(e) => setEnabled(type, e.target.checked)}
          data-testid={`enable-${type}`}
        />
      }
      aside={<span className="h-2 w-2 shrink-0" style={{ background: rgbCss(CLASS_COLORS[type]) }} title="마스크 색" aria-hidden />}
    >
      {entry.enabled && (
        <>
          <div>
            <Row label="개수">
              <NumberField
                label={`${DEFECT_LABELS[type]} 개수`}
                value={entry.count}
                step={1}
                invalid={!!errors[`${type}.count`]}
                onChange={(v) => setCount(type, v)}
                className="w-14 text-right"
                testId={`count-${type}`}
              />
            </Row>
            <FieldError message={errors[`${type}.count`]} />
          </div>
          <Core errors={errors} />
          <Disclosure title="세부 설정" forceOpen={detailError} testId={`details-${type}`}>
            <Details errors={errors} />
          </Disclosure>
        </>
      )}
    </Section>
  )
}

export function DefectControls() {
  const form = useWorkspaceStore((s) => s.form)
  const errors = validateForm(form)
  return (
    <>
      {DEFECT_TYPES.map((type) => (
        <DefectPanel key={type} type={type} errors={errors} />
      ))}
      {errors.defects && (
        <div className="border-b border-line px-3 py-2">
          <FieldError message={errors.defects} />
        </div>
      )}
    </>
  )
}

export function GenerationSettings() {
  const form = useWorkspaceStore((s) => s.form)
  const { seed, allowOverlap, edgeMarginPx } = form
  const setSeed = useWorkspaceStore((s) => s.setSeed)
  const randomizeSeed = useWorkspaceStore((s) => s.randomizeSeed)
  const setAllowOverlap = useWorkspaceStore((s) => s.setAllowOverlap)
  const setEdgeMargin = useWorkspaceStore((s) => s.setEdgeMargin)
  const errors = validateForm(form)
  const margin = LIMITS.area.limits.edge_margin_px

  return (
    <Section title="생성">
      <div>
        <Row label="Seed">
          <NumberField label="Seed" value={seed} step={1} invalid={!!errors.seed} onChange={setSeed} className="text-right" testId="seed-input" />
          <button type="button" className="btn h-[22px] shrink-0 px-2" onClick={randomizeSeed} title="무작위 Seed" data-testid="seed-random">
            무작위
          </button>
        </Row>
        <FieldError message={errors.seed} />
      </div>
      <Disclosure title="고급 설정" forceOpen={!!errors.edgeMarginPx} testId="advanced-settings">
        <Row label="겹침 허용">
          <label className="flex cursor-pointer items-center gap-2 text-ink" title="끄면 결함 사이에 최소 1px 간격을 둡니다">
            <input type="checkbox" className="h-3.5 w-3.5" checked={allowOverlap} onChange={(e) => setAllowOverlap(e.target.checked)} data-testid="allow-overlap" />
            결함끼리 겹쳐도 됨
          </label>
        </Row>
        <SliderField
          label="경계 여유"
          value={edgeMarginPx}
          min={margin[0]}
          max={margin[1]}
          step={0.5}
          format={(v) => `${v.toFixed(1)} px`}
          onChange={setEdgeMargin}
          error={errors.edgeMarginPx}
          testId="edge-margin"
        />
        <p className="text-[11px] text-faint">결함을 영역(또는 이미지) 경계에서 이만큼 떨어뜨립니다.</p>
      </Disclosure>
    </Section>
  )
}

/** Pinned to the bottom of the left panel: reset + preview, with the reason when blocked. */
export function GenerateBar() {
  const isGenerating = useWorkspaceStore((s) => s.isGenerating)
  const generatePreview = useWorkspaceStore((s) => s.generatePreview)
  const resetDefaults = useWorkspaceStore((s) => s.resetDefaults)
  const blocked = useWorkspaceStore((s) => blockingReason(s))
  return (
    <div className="border-t border-line bg-panel px-3 py-2.5 lg:sticky lg:bottom-0 lg:z-10">
      <div className="flex gap-1.5">
        <button type="button" className="btn shrink-0" onClick={resetDefaults} title="결함·생성 설정을 기본값으로 (Seed는 유지)" data-testid="reset-defaults">
          기본값
        </button>
        <button type="button" className="btn btn-primary flex-1" disabled={!!blocked || isGenerating} onClick={() => void generatePreview()} data-testid="generate">
          {isGenerating ? (
            <>
              <Spinner /> 생성 중…
            </>
          ) : (
            '생성 미리보기'
          )}
        </button>
      </div>
      {blocked && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted" data-testid="blocked-reason">
          {blocked}
        </p>
      )}
    </div>
  )
}
