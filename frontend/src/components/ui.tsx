import { useId, useState, type ReactNode } from 'react'
import type { Range } from '../types/generation'

export function Section({ title, aside, children, testId }: { title: string; aside?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="border-b border-line px-4 py-3.5" data-testid={testId}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1 text-[11px] text-danger">
      {message}
    </p>
  )
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

/** Text-backed numeric input: keeps partial input like "0." while typing; emits NaN when not a number. */
export function NumberField({
  value,
  onChange,
  label,
  invalid,
  step,
  testId,
  className = '',
}: {
  value: number
  onChange: (value: number) => void
  label: string
  invalid?: boolean
  step?: number
  testId?: string
  className?: string
}) {
  const [text, setText] = useState(formatNumber(value))
  const [syncedValue, setSyncedValue] = useState(value)
  // External value change (reset, slider, arrow keys): resync the text unless it already says the same number.
  if (!Object.is(value, syncedValue)) {
    setSyncedValue(value)
    if (!(text.trim() !== '' && Number(text) === value)) setText(formatNumber(value))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-testid={testId}
      className={`input ${className}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const trimmed = e.target.value.trim()
        onChange(trimmed === '' ? Number.NaN : Number(trimmed))
      }}
      onKeyDown={(e) => {
        if (!step || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !Number.isFinite(value)) return
        e.preventDefault()
        const next = Number((value + (e.key === 'ArrowUp' ? step : -step)).toFixed(4))
        onChange(next)
      }}
    />
  )
}

export function RangeField({
  label,
  unit,
  value,
  onChange,
  error,
  step = 1,
  testId,
}: {
  label: string
  unit?: string
  value: Range
  onChange: (value: Range) => void
  error?: string
  step?: number
  testId?: string
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">{label}</span>
        {unit && <span className="text-[10px] text-faint">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <NumberField label={`${label} 최소`} value={value[0]} step={step} invalid={!!error} testId={testId && `${testId}-min`} onChange={(v) => onChange([v, value[1]])} />
        <span className="text-faint">–</span>
        <NumberField label={`${label} 최대`} value={value[1]} step={step} invalid={!!error} testId={testId && `${testId}-max`} onChange={(v) => onChange([value[0], v])} />
      </div>
      <FieldError message={error} />
    </div>
  )
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  error,
  format = (v) => v.toFixed(2),
  testId,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  error?: string
  format?: (value: number) => string
  testId?: string
}) {
  const id = useId()
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="num text-[11px] text-ink">{Number.isFinite(value) ? format(value) : '—'}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} data-testid={testId} onChange={(e) => onChange(Number(e.target.value))} />
      <FieldError message={error} />
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
}
