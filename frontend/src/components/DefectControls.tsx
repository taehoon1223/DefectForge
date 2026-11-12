import type { ReactNode } from 'react'
import { cancelDrawing, startLineDrawing } from '../lib/drawActions'
import { CLASS_COLORS, rgbCss } from '../lib/maskColors'
import { blockingReason, lineAngle, useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFECT_LABELS, DEFECT_TYPES, LIMITS, validateForm, type DefectType, type FormErrors, type ParamsByType, type Polarity } from '../types/generation'
import { Disclosure, FieldError, NumberField, RangeField, Section, SliderField, Spinner } from './ui'

const POLARITY_OPTIONS: Array<{ value: Polarity; label: string }> = [
  { value: 'dark', label: '어둡게' },
  { value: 'bright', label: '밝게' },
  { value: 'random', label: '랜덤' },
]

const DESCRIPTIONS: Record<DefectType, string> = {
  scratch: '선형 긁힘 · 길이 방향 강도 변화',
  pinhole: '미세 점 형태 (pinhole-like appearance)',
  contamination: '먼지·이물·얼룩 형태의 불규칙 blob',
}

/** Error keys shown next to always-visible controls; any other params error opens "세부 설정". */
const CORE_ERROR_KEYS = new Set(['scratch.params.polarity', 'scratch.params.orientation.mode', 'scratch.params.orientation.angle_deg', 'scratch.params.shading.mode'])

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
    <div>
      <span className="label mb-1 block">{label}</span>
      <div className="seg w-full" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className="flex-1" aria-pressed={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testId}-${o.value}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
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
  { value: 'absolute', label: '각도 지정' },
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
      <div className="flex items-center gap-2 rounded border border-line bg-bg px-2.5 py-1.5 text-[12px]" data-testid="line-status">
        <span className="flex-1 text-accent">{draft ? '두 번째 점을 클릭하세요' : '이미지에서 첫 번째 점을 클릭하세요'}</span>
        <button type="button" className="btn h-6 px-2" onClick={cancelDrawing} data-testid="line-cancel">
          취소
        </button>
      </div>
    )
  }
  if (!line || angle === null) {
    return (
      <div>
        <button type="button" className="btn h-7 w-full" disabled={!size} onClick={startLineDrawing} data-testid="line-start">
          기준선 그리기 (두 점 클릭)
        </button>
        <p className="mt-1 text-[11px] text-faint">부품의 긴 방향처럼 스크래치 방향의 기준이 되는 선입니다.</p>
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-1.5 text-[12px]"
      data-testid="line-readout"
      data-start-x={line.start[0]}
      data-start-y={line.start[1]}
      data-end-x={line.end[0]}
      data-end-y={line.end[1]}
      data-angle={angle}
    >
      <span className="num flex-1 text-ink" title={`(${line.start.join(', ')}) → (${line.end.join(', ')})`}>
        기준선 {angle.toFixed(1)}°
      </span>
      <button type="button" className="btn h-6 px-2" onClick={startLineDrawing} data-testid="line-start">
        다시 그리기
      </button>
      <button type="button" className="btn h-6 px-2" onClick={() => setReferenceLine(null)} data-testid="line-delete">
        삭제
      </button>
    </div>
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
          <div className="seg w-full" role="group" aria-label="기준선 대비 방향">
            <button type="button" className="flex-1" aria-pressed={mode === 'parallel'} onClick={() => setOrientation({ mode: 'parallel' })} data-testid="orient-parallel">
              기준선에 평행
            </button>
            <button type="button" className="flex-1" aria-pressed={mode === 'perpendicular'} onClick={() => setOrientation({ mode: 'perpendicular' })} data-testid="orient-perpendicular">
              기준선에 수직
            </button>
          </div>
        </>
      )}
      {direction === 'absolute' && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="label">각도 (0–180°, x축 기준)</span>
            <NumberField
              label="지정 각도"
              value={p.orientation.angle_deg}
              step={5}
              invalid={!!err(errors, 'scratch', 'orientation.angle_deg')}
              onChange={(v) => setOrientation({ angle_deg: v })}
              className="w-16 text-center"
              testId="scratch-angle-fixed"
            />
          </div>
          <FieldError message={err(errors, 'scratch', 'orientation.angle_deg')} />
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-2" title="원본에서 생성 영역 안 픽셀만으로 구한 국소 평균 색·밝기에 맞춰 명암을 바꿉니다. 조명·3D 형상을 복원하는 것은 아닙니다.">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-accent"
          checked={p.shading.mode === 'local'}
          onChange={(e) => setShading({ mode: e.target.checked ? 'local' : 'fixed' })}
          data-testid="surface-match"
        />
        <span>
          <span className="block text-ink">표면 밝기에 맞추기</span>
          <span className="text-[11px] text-faint">주변 표면 색의 더 어두운/밝은 톤으로 그립니다</span>
        </span>
      </label>
      <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="scratch-polarity" />
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
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label="길이" unit="px" value={p.length_px} onChange={(v) => set('length_px', v)} error={err(errors, 'scratch', 'length_px')} testId="scratch-length" />
        <RangeField label="폭" unit="px" value={p.width_px} onChange={(v) => set('width_px', v)} error={err(errors, 'scratch', 'width_px')} step={0.5} testId="scratch-width" />
        <RangeField label={local ? '대비 (명암 여유 대비)' : '대비'} value={p.contrast} onChange={(v) => set('contrast', v)} error={err(errors, 'scratch', 'contrast')} step={0.05} testId="scratch-contrast" />
        {p.orientation.mode === 'random' && (
          <RangeField label="각도 범위" unit="°" value={p.angle_deg} onChange={(v) => set('angle_deg', v)} error={err(errors, 'scratch', 'angle_deg')} step={5} testId="scratch-angle" />
        )}
      </div>
      <SliderField label="곡률" value={p.curvature} min={lim.curvature[0]} max={lim.curvature[1]} step={0.05} onChange={(v) => set('curvature', v)} error={err(errors, 'scratch', 'curvature')} />
      {p.orientation.mode !== 'random' && (
        <SliderField
          label="각도 흔들림 (±)"
          value={p.orientation.jitter_deg}
          min={SO.jitter_deg[0]}
          max={SO.jitter_deg[1]}
          step={1}
          format={(v) => `±${v.toFixed(0)}°`}
          onChange={(v) => setOrientation({ jitter_deg: v })}
          error={err(errors, 'scratch', 'orientation.jitter_deg')}
          testId="scratch-jitter"
        />
      )}
      {local && (
        <>
          <SliderField
            label="표면 통계 창 크기 (σ)"
            value={p.shading.window_sigma_px}
            min={SO.window_sigma_px[0]}
            max={SO.window_sigma_px[1]}
            step={1}
            format={(v) => `${v.toFixed(0)} px`}
            onChange={(v) => setShading({ window_sigma_px: v })}
            error={err(errors, 'scratch', 'shading.window_sigma_px')}
          />
          <SliderField
            label="최소 대비 (× 표면 결 표준편차)"
            value={p.shading.min_texture_ratio}
            min={SO.min_texture_ratio[0]}
            max={SO.min_texture_ratio[1]}
            step={0.25}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setShading({ min_texture_ratio: v })}
            error={err(errors, 'scratch', 'shading.min_texture_ratio')}
          />
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
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'pinhole', 'radius_px')} testId="pinhole-radius" />
        <RangeField label="대비" value={p.contrast} onChange={(v) => set('contrast', v)} error={err(errors, 'pinhole', 'contrast')} step={0.05} testId="pinhole-contrast" />
      </div>
      <SliderField label="불규칙도" value={p.irregularity} min={lim.irregularity[0]} max={lim.irregularity[1]} step={0.05} onChange={(v) => set('irregularity', v)} error={err(errors, 'pinhole', 'irregularity')} />
      <SliderField label="림(테두리) 강도" value={p.rim_strength} min={lim.rim_strength[0]} max={lim.rim_strength[1]} step={0.05} onChange={(v) => set('rim_strength', v)} error={err(errors, 'pinhole', 'rim_strength')} />
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
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'contamination', 'radius_px')} testId="contamination-radius" />
        <RangeField label="불투명도" value={p.opacity} onChange={(v) => set('opacity', v)} error={err(errors, 'contamination', 'opacity')} step={0.05} testId="contamination-opacity" />
      </div>
      <SliderField label="불규칙도" value={p.irregularity} min={lim.irregularity[0]} max={lim.irregularity[1]} step={0.05} onChange={(v) => set('irregularity', v)} error={err(errors, 'contamination', 'irregularity')} />
      <SliderField label="경계 흐림 (blur σ)" value={p.blur_sigma} min={lim.blur_sigma[0]} max={lim.blur_sigma[1]} step={0.25} format={(v) => `${v.toFixed(2)} px`} onChange={(v) => set('blur_sigma', v)} error={err(errors, 'contamination', 'blur_sigma')} />
    </>
  )
}

const CONTROLS: Record<DefectType, { Core: (props: { errors: FormErrors }) => ReactNode; Details: (props: { errors: FormErrors }) => ReactNode }> = {
  scratch: { Core: ScratchCore, Details: ScratchDetails },
  pinhole: { Core: PinholeCore, Details: PinholeDetails },
  contamination: { Core: ContaminationCore, Details: ContaminationDetails },
}

function DefectCard({ type, errors }: { type: DefectType; errors: FormErrors }) {
  const entry = useWorkspaceStore((s) => s.form.defects[type])
  const setEnabled = useWorkspaceStore((s) => s.setDefectEnabled)
  const setCount = useWorkspaceStore((s) => s.setDefectCount)
  const { Core, Details } = CONTROLS[type]
  const detailError = Object.keys(errors).some((k) => k.startsWith(`${type}.params.`) && !CORE_ERROR_KEYS.has(k))
  return (
    <div className={`rounded border ${entry.enabled ? 'border-line-strong bg-panel-2' : 'border-line bg-transparent'}`} data-testid={`defect-${type}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2" title={DESCRIPTIONS[type]}>
          <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={entry.enabled} onChange={(e) => setEnabled(type, e.target.checked)} data-testid={`enable-${type}`} />
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: rgbCss(CLASS_COLORS[type]) }} aria-hidden />
          <span className="font-medium text-ink">{DEFECT_LABELS[type]}</span>
        </label>
        {entry.enabled && (
          <div className="flex items-center gap-1.5">
            <span className="label">개수</span>
            <NumberField
              label={`${DEFECT_LABELS[type]} 개수`}
              value={entry.count}
              step={1}
              invalid={!!errors[`${type}.count`]}
              onChange={(v) => setCount(type, v)}
              className="w-12 text-center"
              testId={`count-${type}`}
            />
          </div>
        )}
      </div>
      {entry.enabled && (
        <div className="grid gap-2.5 border-t border-line px-2.5 pt-2 pb-2.5">
          <FieldError message={errors[`${type}.count`]} />
          <Core errors={errors} />
          <Disclosure title="세부 설정" forceOpen={detailError} testId={`details-${type}`}>
            <Details errors={errors} />
          </Disclosure>
        </div>
      )}
    </div>
  )
}

export function DefectControls() {
  const form = useWorkspaceStore((s) => s.form)
  const resetDefaults = useWorkspaceStore((s) => s.resetDefaults)
  const errors = validateForm(form)
  return (
    <Section
      title="결함"
      aside={
        <button type="button" className="text-[11px] text-muted hover:text-ink" onClick={resetDefaults} data-testid="reset-defaults">
          기본값
        </button>
      }
    >
      <div className="grid gap-2">
        {DEFECT_TYPES.map((type) => (
          <DefectCard key={type} type={type} errors={errors} />
        ))}
        <FieldError message={errors.defects} />
      </div>
    </Section>
  )
}

export function GenerationSettings() {
  const form = useWorkspaceStore((s) => s.form)
  const { seed, allowOverlap, edgeMarginPx } = form
  const setSeed = useWorkspaceStore((s) => s.setSeed)
  const randomizeSeed = useWorkspaceStore((s) => s.randomizeSeed)
  const setAllowOverlap = useWorkspaceStore((s) => s.setAllowOverlap)
  const setEdgeMargin = useWorkspaceStore((s) => s.setEdgeMargin)
  const isGenerating = useWorkspaceStore((s) => s.isGenerating)
  const generatePreview = useWorkspaceStore((s) => s.generatePreview)
  const blocked = useWorkspaceStore((s) => blockingReason(s))
  const errors = validateForm(form)
  const margin = LIMITS.area.limits.edge_margin_px

  return (
    <Section title="생성">
      <div className="grid gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="label w-10 shrink-0">Seed</span>
            <NumberField label="Seed" value={seed} step={1} invalid={!!errors.seed} onChange={setSeed} testId="seed-input" />
            <button type="button" className="btn h-7 shrink-0 px-2" onClick={randomizeSeed} title="무작위 Seed" data-testid="seed-random">
              무작위
            </button>
          </div>
          <FieldError message={errors.seed} />
          <Disclosure title="고급 설정" forceOpen={!!errors.edgeMarginPx} testId="advanced-settings">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span>
                <span className="block text-ink">결함 겹침 허용</span>
                <span className="text-[11px] text-faint">끄면 결함 사이에 최소 1px 간격을 둡니다</span>
              </span>
              <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={allowOverlap} onChange={(e) => setAllowOverlap(e.target.checked)} data-testid="allow-overlap" />
            </label>
            <div>
              <SliderField
                label="경계 여유 거리"
                value={edgeMarginPx}
                min={margin[0]}
                max={margin[1]}
                step={0.5}
                format={(v) => `${v.toFixed(1)} px`}
                onChange={setEdgeMargin}
                error={errors.edgeMarginPx}
                testId="edge-margin"
              />
              <p className="mt-1 text-[11px] text-faint">결함을 영역(또는 이미지) 경계에서 이만큼 떨어뜨립니다.</p>
            </div>
          </Disclosure>
        </div>
        <button type="button" className="btn btn-primary h-9 w-full text-[13px]" disabled={!!blocked || isGenerating} onClick={() => void generatePreview()} data-testid="generate">
          {isGenerating ? (
            <>
              <Spinner /> 생성 중…
            </>
          ) : (
            '생성 미리보기'
          )}
        </button>
        {blocked && (
          <p className="text-[11px] leading-relaxed text-muted" data-testid="blocked-reason">
            {blocked}
          </p>
        )}
      </div>
    </Section>
  )
}
