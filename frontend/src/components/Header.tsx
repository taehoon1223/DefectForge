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
    <header className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <h1 className="text-[13px] font-semibold text-ink">DefectForge</h1>
      <span className="hidden text-faint md:inline">합성 결함 · 정답 마스크</span>
      <span
        className={`ml-auto text-[11px] ${health.state === 'down' ? 'text-danger' : 'text-faint'}`}
        title={API_BASE_URL}
        data-testid="api-status"
        data-state={health.state}
      >
        {health.state === 'ok' ? `API v${health.version}` : health.state === 'down' ? 'API 연결 안 됨' : 'API 확인 중…'}
      </span>
    </header>
  )
}
