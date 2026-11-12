import { useId, useState, type ReactNode } from 'react'
import type { Range } from '../types/generation'

function Triangle({ open }: { open: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={`shrink-0 fill-current transition-transform ${open ? '' : '-rotate-90'}`}>
      <path d="M0.5 2h7L4 6.5z" />
    </svg>
  )
}

/**
 * Collapsible side-panel section with a title bar (photo-tool style).
 * `leading` sits before the title (e.g. an on/off checkbox); `aside` sits before the triangle.
 */
export function Section({
  title,
  aside,
  leading,
  children,
  testId,
  dimmed = false,
}: {
  title: string
  aside?: ReactNode
  leading?: ReactNode
  children?: ReactNode
  testId?: string
  dimmed?: boolean
}) {
  const [open, setOpen] = useState(true)
  const bodyId = useId()
  const hasBody = children !== undefined && children !== null && children !== false
  return (
    <section className="border-b border-line" data-testid={testId}>
      <div className={`flex h-7 items-center gap-2 bg-panel-2 px-3 ${dimmed ? 'text-faint' : 'text-ink'}`}>
        {leading}
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold">{title}</h2>
        {aside}
        {hasBody && (
          <button
            type="button"
            className="-mr-1 flex h-6 w-6 items-center justify-center text-faint hover:text-ink"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${title} ${open ? '접기' : '펼치기'}`}
            onClick={() => setOpen((v) => !v)}
          >
            <Triangle open={open} />
          </button>
        )}
      </div>
      {hasBody && open && (
        <div id={bodyId} className="grid gap-2 px-3 pt-2.5 pb-3">
          {children}
        </div>
      )}
    </section>
  )
}

/** Label on the left, control(s) on the right — the basic inspector row. */
export function Row({ label, children, htmlFor, testId }: { label: ReactNode; children: ReactNode; htmlFor?: string; testId?: string }) {
  return (
    <div className="grid min-h-[22px] grid-cols-[72px_minmax(0,1fr)] items-center gap-2" data-testid={testId}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="label truncate">
          {label}
        </label>
      ) : (
        <span className="label truncate">{label}</span>
      )}
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

/** Folded block inside a section. `forceOpen` (e.g. a field error inside) opens it and keeps it open. */
export function Disclosure({ title, children, forceOpen = false, testId }: { title: string; children: ReactNode; forceOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(false)
  if (forceOpen && !open) setOpen(true)
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 py-0.5 text-[12px] text-muted select-none hover:text-ink"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
      >
        <Triangle open={open} />
        {title}
      </button>
      {open && <div className="mt-1.5 grid gap-2 border-l border-line-strong pl-2.5">{children}</div>}
    </div>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-[11px] text-danger">
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
      <Row label={label}>
        <NumberField label={`${label} 최소`} value={value[0]} step={step} invalid={!!error} testId={testId && `${testId}-min`} onChange={(v) => onChange([v, value[1]])} className="text-right" />
        <span className="text-faint">–</span>
        <NumberField label={`${label} 최대`} value={value[1]} step={step} invalid={!!error} testId={testId && `${testId}-max`} onChange={(v) => onChange([value[0], v])} className="text-right" />
        <span className="w-4 shrink-0 text-[11px] text-faint">{unit}</span>
      </Row>
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
      <Row label={label} htmlFor={id}>
        <input id={id} type="range" min={min} max={max} step={step} value={value} data-testid={testId} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="num w-12 shrink-0 text-right text-ink">{Number.isFinite(value) ? format(value) : '—'}</span>
      </Row>
      <FieldError message={error} />
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`} />
}
