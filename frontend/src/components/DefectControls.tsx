import type { ReactNode } from 'react'
import { CLASS_COLORS, rgbCss } from '../lib/maskColors'
import { blockingReason, useWorkspaceStore } from '../store/useWorkspaceStore'
import {
  DEFECT_LABELS,
  DEFECT_TYPES,
  LIMITS,
  validateForm,
  type DefectType,
  type FormErrors,
  type ParamsByType,
  type Polarity,
} from '../types/generation'
import { FieldError, NumberField, RangeField, Section, SliderField, Spinner } from './ui'

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

function useParam<K extends DefectType>(type: K) {
  const params = useWorkspaceStore((s) => s.form.defects[type].params) as ParamsByType[K]
  const setDefectParam = useWorkspaceStore((s) => s.setDefectParam)
  const set = <P extends keyof ParamsByType[K]>(key: P, value: ParamsByType[K][P]) => setDefectParam(type, key, value)
  return [params, set] as const
}

function PolarityField({ value, onChange, testId }: { value: Polarity; onChange: (v: Polarity) => void; testId: string }) {
  return (
    <div>
      <span className="label mb-1 block">극성</span>
      <div className="seg w-full" role="group" aria-label="극성">
        {POLARITY_OPTIONS.map((o) => (
          <button key={o.value} type="button" className="flex-1" aria-pressed={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testId}-${o.value}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const err = (errors: FormErrors, type: DefectType, key: string) => errors[`${type}.params.${key}`]

export function ScratchControls({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('scratch')
  const lim = LIMITS.defects.scratch.limits
  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label="길이" unit="px" value={p.length_px} onChange={(v) => set('length_px', v)} error={err(errors, 'scratch', 'length_px')} testId="scratch-length" />
        <RangeField label="폭" unit="px" value={p.width_px} onChange={(v) => set('width_px', v)} error={err(errors, 'scratch', 'width_px')} testId="scratch-width" />
        <RangeField label="각도" unit="°" value={p.angle_deg} onChange={(v) => set('angle_deg', v)} error={err(errors, 'scratch', 'angle_deg')} step={5} testId="scratch-angle" />
        <RangeField label="대비" value={p.contrast} onChange={(v) => set('contrast', v)} error={err(errors, 'scratch', 'contrast')} step={0.05} testId="scratch-contrast" />
      </div>
      <SliderField label="곡률" value={p.curvature} min={lim.curvature[0]} max={lim.curvature[1]} step={0.05} onChange={(v) => set('curvature', v)} error={err(errors, 'scratch', 'curvature')} />
      <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="scratch-polarity" />
    </div>
  )
}

export function PinholeControls({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('pinhole')
  const lim = LIMITS.defects.pinhole.limits
  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'pinhole', 'radius_px')} testId="pinhole-radius" />
        <RangeField label="대비" value={p.contrast} onChange={(v) => set('contrast', v)} error={err(errors, 'pinhole', 'contrast')} step={0.05} testId="pinhole-contrast" />
      </div>
      <SliderField label="불규칙도" value={p.irregularity} min={lim.irregularity[0]} max={lim.irregularity[1]} step={0.05} onChange={(v) => set('irregularity', v)} error={err(errors, 'pinhole', 'irregularity')} />
      <SliderField label="림(테두리) 강도" value={p.rim_strength} min={lim.rim_strength[0]} max={lim.rim_strength[1]} step={0.05} onChange={(v) => set('rim_strength', v)} error={err(errors, 'pinhole', 'rim_strength')} />
      <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="pinhole-polarity" />
    </div>
  )
}

export function ContaminationControls({ errors }: { errors: FormErrors }) {
  const [p, set] = useParam('contamination')
  const lim = LIMITS.defects.contamination.limits
  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label="반지름" unit="px" value={p.radius_px} onChange={(v) => set('radius_px', v)} error={err(errors, 'contamination', 'radius_px')} testId="contamination-radius" />
        <RangeField label="불투명도" value={p.opacity} onChange={(v) => set('opacity', v)} error={err(errors, 'contamination', 'opacity')} step={0.05} testId="contamination-opacity" />
      </div>
      <SliderField label="불규칙도" value={p.irregularity} min={lim.irregularity[0]} max={lim.irregularity[1]} step={0.05} onChange={(v) => set('irregularity', v)} error={err(errors, 'contamination', 'irregularity')} />
      <SliderField label="경계 흐림 (blur σ)" value={p.blur_sigma} min={lim.blur_sigma[0]} max={lim.blur_sigma[1]} step={0.25} format={(v) => `${v.toFixed(2)} px`} onChange={(v) => set('blur_sigma', v)} error={err(errors, 'contamination', 'blur_sigma')} />
      <PolarityField value={p.polarity} onChange={(v) => set('polarity', v)} testId="contamination-polarity" />
    </div>
  )
}

const CONTROLS: Record<DefectType, (props: { errors: FormErrors }) => ReactNode> = {
  scratch: ScratchControls,
  pinhole: PinholeControls,
  contamination: ContaminationControls,
}

function DefectCard({ type, errors }: { type: DefectType; errors: FormErrors }) {
  const entry = useWorkspaceStore((s) => s.form.defects[type])
  const setEnabled = useWorkspaceStore((s) => s.setDefectEnabled)
  const setCount = useWorkspaceStore((s) => s.setDefectCount)
  const [minCount, maxCount] = LIMITS.defects[type].limits.count
  const Controls = CONTROLS[type]
  return (
    <div className={`rounded border ${entry.enabled ? 'border-line-strong bg-panel-2' : 'border-line bg-transparent'}`} data-testid={`defect-${type}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={entry.enabled} onChange={(e) => setEnabled(type, e.target.checked)} data-testid={`enable-${type}`} />
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: rgbCss(CLASS_COLORS[type]) }} aria-hidden />
          <span className="font-medium text-ink">{DEFECT_LABELS[type]}</span>
          <span className="text-[11px] text-faint">{type}</span>
        </label>
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
      </div>
      {entry.enabled && (
        <div className="border-t border-line px-2.5 pt-2 pb-3">
          <p className="mb-2 text-[11px] text-faint">
            {DESCRIPTIONS[type]} · 개수 {minCount}–{maxCount}
          </p>
          <FieldError message={errors[`${type}.count`]} />
          <Controls errors={errors} />
        </div>
      )}
    </div>
  )
}

export function DefectTypeSelector({ errors }: { errors: FormErrors }) {
  return (
    <div className="grid gap-2">
      {DEFECT_TYPES.map((type) => (
        <DefectCard key={type} type={type} errors={errors} />
      ))}
      <FieldError message={errors.defects} />
    </div>
  )
}

export function DefectControls() {
  const form = useWorkspaceStore((s) => s.form)
  const resetDefaults = useWorkspaceStore((s) => s.resetDefaults)
  const errors = validateForm(form)
  return (
    <Section
      title="결함 유형 · 파라미터"
      aside={
        <button type="button" className="text-[11px] text-muted hover:text-ink" onClick={resetDefaults} data-testid="reset-defaults">
          기본값
        </button>
      }
    >
      <DefectTypeSelector errors={errors} />
    </Section>
  )
}

export function GenerationSettings() {
  const form = useWorkspaceStore((s) => s.form)
  const { seed, allowOverlap } = form
  const setSeed = useWorkspaceStore((s) => s.setSeed)
  const randomizeSeed = useWorkspaceStore((s) => s.randomizeSeed)
  const setAllowOverlap = useWorkspaceStore((s) => s.setAllowOverlap)
  const isGenerating = useWorkspaceStore((s) => s.isGenerating)
  const generatePreview = useWorkspaceStore((s) => s.generatePreview)
  const blocked = useWorkspaceStore((s) => blockingReason(s))
  const seedError = validateForm(form).seed

  return (
    <Section title="생성 설정">
      <div className="grid gap-3">
        <div>
          <span className="label mb-1 block">Seed</span>
          <div className="flex gap-1.5">
            <NumberField label="Seed" value={seed} step={1} invalid={!!seedError} onChange={setSeed} testId="seed-input" />
            <button type="button" className="btn h-7 shrink-0 px-2" onClick={randomizeSeed} title="무작위 Seed" data-testid="seed-random">
              무작위
            </button>
          </div>
          <FieldError message={seedError} />
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-2">
          <span>
            <span className="block text-ink">결함 겹침 허용</span>
            <span className="text-[11px] text-faint">끄면 결함 사이에 최소 1px 간격을 둡니다</span>
          </span>
          <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={allowOverlap} onChange={(e) => setAllowOverlap(e.target.checked)} data-testid="allow-overlap" />
        </label>
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
