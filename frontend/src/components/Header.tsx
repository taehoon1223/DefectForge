import { useEffect, useState } from 'react'
import { API_BASE_URL, fetchHealth } from '../api/client'

type Health = { state: 'checking' } | { state: 'ok'; version: string } | { state: 'down' }

export function Header() {
  const [health, setHealth] = useState<Health>({ state: 'checking' })

  useEffect(() => {
    const controller = new AbortController()
    const check = () =>
      fetchHealth(controller.signal)
        .then((h) => setHealth({ state: 'ok', version: h.version }))
        .catch(() => !controller.signal.aborted && setHealth({ state: 'down' }))
    void check()
    const timer = setInterval(check, 15000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="shrink-0">
        <rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="none" stroke="#4f8cff" strokeWidth="1.5" />
        <path d="M6 15.5 10.5 8l3 5 2-3 2.5 5.5" fill="none" stroke="#dce3eb" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="16.5" cy="7.5" r="1.6" fill="#ffd60a" />
      </svg>
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">DefectForge</h1>
        <p className="hidden truncate text-[12px] text-muted md:block">정상 표면 이미지에 합성 결함을 넣고 픽셀 단위로 정합된 GT 마스크를 생성하는 검사 데이터 워크벤치</p>
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px]">
        <span className="hidden text-faint sm:inline">GitHub: 공개 예정</span>
        <span
          className="flex items-center gap-1.5 rounded border border-line bg-bg px-2 py-1"
          title={API_BASE_URL}
          data-testid="api-status"
          data-state={health.state}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${health.state === 'ok' ? 'bg-ok' : health.state === 'down' ? 'bg-danger' : 'bg-faint'}`} />
          {health.state === 'ok' ? `API 연결됨 · v${health.version}` : health.state === 'down' ? 'API 연결 안 됨' : 'API 확인 중'}
        </span>
      </div>
    </header>
  )
}
