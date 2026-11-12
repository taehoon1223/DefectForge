import { AreaPanel } from './components/AreaEditor'
import { DefectControls, GenerationSettings } from './components/DefectControls'
import { ExportPanel } from './components/ExportPanel'
import { GenerationSummary } from './components/GenerationSummary'
import { Header } from './components/Header'
import { ImageUploader } from './components/ImageUploader'
import { MaskLegend } from './components/MaskLegend'
import { PreviewCanvas } from './components/PreviewCanvas'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'

export default function App() {
  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <Header />
      <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[clamp(280px,24vw,340px)_minmax(0,1fr)_clamp(260px,22vw,310px)]">
        <aside className="border-line bg-panel lg:min-h-0 lg:overflow-y-auto lg:border-r" aria-label="입력 설정" data-testid="left-panel">
          <ImageUploader />
          <AreaPanel />
          <DefectControls />
          <GenerationSettings />
        </aside>
        <section className="flex h-[70vh] min-h-[420px] flex-col lg:h-auto lg:min-h-0" aria-label="작업 영역">
          <PreviewCanvas />
        </section>
        <aside className="border-line bg-panel lg:min-h-0 lg:overflow-y-auto lg:border-l" aria-label="생성 결과" data-testid="right-panel">
          <GenerationSummary />
          <MaskLegend />
          <ExportPanel />
        </aside>
      </main>
      <div className="sticky bottom-0 z-40 lg:static">
        <StatusBar />
      </div>
      <Toast />
    </div>
  )
}
