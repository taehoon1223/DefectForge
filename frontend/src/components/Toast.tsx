import { useWorkspaceStore } from '../store/useWorkspaceStore'

const TONE = {
  success: 'border-ok/50 text-ok',
  error: 'border-danger/50 text-danger',
  info: 'border-accent/50 text-accent',
} as const

export function Toast() {
  const toasts = useWorkspaceStore((s) => s.toasts)
  const dismiss = useWorkspaceStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed right-4 bottom-16 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          data-testid={`toast-${t.kind}`}
          className={`pointer-events-auto flex items-start gap-2 rounded border bg-panel-2 px-3 py-2 text-[12px] shadow-lg shadow-black/40 ${TONE[t.kind]}`}
        >
          <span className="flex-1 text-ink">{t.message}</span>
          <button type="button" className="text-muted hover:text-ink" aria-label="알림 닫기" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
