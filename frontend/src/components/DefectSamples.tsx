import { useRef, useState, type ReactNode } from 'react'
import { realClassColor, rgbCss } from '../lib/maskColors'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFECT_LABELS, FITTABLE_TYPES, LIMITS } from '../types/generation'
import { SampleLabelEditor } from './SampleLabelEditor'
import { Row, Section, Spinner } from './ui'

const IMAGE_ACCEPT = [...LIMITS.image.acceptedMimeTypes, ...LIMITS.image.acceptedExtensions].join(',')

function FilePick({
  label,
  file,
  accept,
  onPick,
  testId,
  disabled = false,
  children,
}: {
  label: string
  file: File | null
  accept: string
  onPick: (file: File) => void
  testId: string
  disabled?: boolean
  children?: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Row label={label}>
      <button type="button" className="btn h-[22px] shrink-0 px-2" disabled={disabled} onClick={() => inputRef.current?.click()} data-testid={`${testId}-pick`}>
        선택
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={file?.name} data-testid={`${testId}-name`}>
        {file?.name ?? '—'}
      </span>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked) onPick(picked)
        }}
      />
    </Row>
  )
}

/** Real-defect samples: added after the server has validated and measured them. */
export function DefectSamplesPanel() {
  const samples = useWorkspaceStore((s) => s.defectSamples)
  const classNamesFile = useWorkspaceStore((s) => s.classNamesFile)
  const analysis = useWorkspaceStore((s) => s.sampleAnalysis)
  const busy = useWorkspaceStore((s) => s.isAnalyzingSamples)
  const addDefectSample = useWorkspaceStore((s) => s.addDefectSample)
  const removeDefectSample = useWorkspaceStore((s) => s.removeDefectSample)
  const setClassNamesFile = useWorkspaceStore((s) => s.setClassNamesFile)
  const applySampleFit = useWorkspaceStore((s) => s.applySampleFit)
  const [image, setImage] = useState<File | null>(null)
  const [label, setLabel] = useState<File | null>(null)
  const [drawing, setDrawing] = useState(false)
  const max = LIMITS.defectSamples.maxCount
  const full = samples.length >= max

  const add = async () => {
    if (!image || !label) return
    if (await addDefectSample(image, label)) {
      setImage(null)
      setLabel(null)
    }
  }

  return (
    <Section
      title="결함 샘플"
      testId="defect-samples"
      defaultOpen={false}
      aside={samples.length > 0 ? <span className="num text-[11px] text-muted">{samples.length}</span> : undefined}
    >
      <p className="text-[11px] leading-relaxed text-faint" title="라벨: 한 줄에 결함 하나, '클래스 x1 y1 x2 y2 …' (0–1 정규화 좌표)">
        실제 결함 이미지에 YOLO 세그멘테이션 라벨(txt)을 고르거나 결함을 직접 그려 넣고, ‘실제 결함’에 쓰거나 규칙 결함을 맞춥니다.
      </p>
      <FilePick label="결함 이미지" file={image} accept={IMAGE_ACCEPT} onPick={setImage} testId="sample-image" />
      <FilePick label="라벨 txt" file={label} accept=".txt,text/plain" onPick={setLabel} testId="sample-label">
        <button
          type="button"
          className="btn h-[22px] shrink-0 px-2"
          disabled={!image || busy || full}
          title={image ? '결함 이미지 위에 결함을 다각형으로 그려 라벨을 만듭니다' : '결함 이미지를 먼저 고르세요'}
          onClick={() => setDrawing(true)}
          data-testid="sample-draw"
        >
          직접 그리기
        </button>
      </FilePick>
      {drawing && image && (
        <SampleLabelEditor
          image={image}
          onClose={() => setDrawing(false)}
          onAdded={() => {
            setDrawing(false)
            setImage(null)
            setLabel(null)
          }}
        />
      )}
      <Row label="">
        <button type="button" className="btn w-full" disabled={!image || !label || busy || full} onClick={() => void add()} data-testid="sample-add">
          {busy ? (
            <>
              <Spinner /> 분석 중…
            </>
          ) : full ? (
            `최대 ${max}개`
          ) : (
            '샘플 추가'
          )}
        </button>
      </Row>
      <FilePick
        label="클래스 이름"
        file={classNamesFile}
        accept=".txt,.yaml,.yml,text/plain"
        onPick={(file) => void setClassNamesFile(file)}
        testId="class-names"
        disabled={busy}
      >
        {classNamesFile && (
          <button type="button" className="btn btn-ghost h-5 px-1.5" disabled={busy} onClick={() => void setClassNamesFile(null)} data-testid="class-names-clear">
            지움
          </button>
        )}
      </FilePick>

      {samples.length > 0 && (
        <ul className="grid gap-1" data-testid="sample-list">
          {samples.map((sample, i) => (
            <li key={sample.id} className="flex items-center gap-2" data-testid="sample-item">
              <span className="num w-3 text-faint">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-ink" title={`${sample.image.name} + ${sample.label.name}`}>
                {sample.image.name}
              </span>
              <span className="num shrink-0 text-[11px] text-muted" data-testid={`sample-defects-${i}`}>
                {analysis ? `결함 ${analysis.samples[i]?.defect_count ?? '?'}` : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost h-5 px-1.5"
                disabled={busy}
                aria-label={`샘플 ${i + 1} 삭제`}
                onClick={() => void removeDefectSample(sample.id)}
                data-testid={`sample-remove-${i}`}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {analysis && (
        <>
          <ul className="grid gap-0.5 text-[11px]" data-testid="sample-classes" title="라벨 클래스 k는 클래스 마스크 값 6+k, YOLO 번호 k로 나갑니다">
            {analysis.classes.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0" style={{ background: rgbCss(realClassColor(c.id)) }} aria-hidden />
                <span className="num w-4 text-faint">{c.id}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
                <span className="num text-muted">{c.defect_count}개</span>
              </li>
            ))}
          </ul>
          <Row label="규칙 맞추기">
            <div className="flex w-full gap-1">
              {FITTABLE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="btn flex-1 px-1"
                  title={`${DEFECT_LABELS[type]}의 크기·대비·극성을 샘플 결함의 측정값으로 채우고 켭니다`}
                  onClick={() => applySampleFit(type)}
                  data-testid={`fit-${type}`}
                >
                  {DEFECT_LABELS[type]}
                </button>
              ))}
            </div>
          </Row>
          <p className="text-[11px] leading-relaxed text-faint" data-testid="sample-summary">
            길쭉한 결함은 스크래치, 나머지는 핀홀·오염에 씁니다 ({analysis.fitted_from.scratch}개 / {analysis.fitted_from.pinhole}개). 크기·대비·극성만 바뀝니다.
          </p>
        </>
      )}
    </Section>
  )
}
