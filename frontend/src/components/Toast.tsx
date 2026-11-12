import { useWorkspaceStore } from '../store/useWorkspaceStore'

const TONE = {
  success: 'text-ink',
  error: 'text-danger',
  info: 'text-ink',
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
          className="pointer-events-auto flex items-start gap-2 rounded-[2px] bg-[#3a3a3a] px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
        >
          <span className={`flex-1 ${TONE[t.kind]}`}>{t.message}</span>
          <button type="button" className="text-muted hover:text-ink" aria-label="알림 닫기" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
