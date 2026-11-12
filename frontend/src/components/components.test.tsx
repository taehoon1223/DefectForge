import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { DefectControls, GenerateBar, GenerationSettings } from './DefectControls'
import { ExportButton, ExportPanel } from './ExportPanel'
import { MaskLegend } from './MaskLegend'
import { StatusBar } from './StatusBar'

const initial = useWorkspaceStore.getState()

function loadImage() {
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: vi.fn() }))
  useWorkspaceStore.getState().setSource(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }), 'blob:a', { width: 512, height: 448 })
}

beforeEach(() => useWorkspaceStore.setState(initial, true))

describe('DefectControls', () => {
  it('toggles a defect type and hides its parameters', async () => {
    render(<DefectControls />)
    expect(screen.getByTestId('pinhole-polarity-bright')).toBeInTheDocument()
    expect(screen.queryByTestId('pinhole-radius-min')).not.toBeInTheDocument() // folded by default
    await userEvent.click(screen.getByTestId('details-pinhole'))
    expect(screen.getByTestId('pinhole-radius-min')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('enable-pinhole'))
    expect(useWorkspaceStore.getState().form.defects.pinhole.enabled).toBe(false)
    expect(screen.queryByTestId('pinhole-radius-min')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pinhole-polarity-bright')).not.toBeInTheDocument()
  })

  it('shows a Korean error under an out-of-range field and writes the value to the store', async () => {
    render(<DefectControls />)
    await userEvent.click(screen.getByTestId('details-scratch'))
    const min = screen.getByTestId('scratch-length-min')
    await userEvent.clear(min)
    await userEvent.type(min, '600')
    expect(useWorkspaceStore.getState().form.defects.scratch.params.length_px[0]).toBe(600)
    expect(screen.getByText(/8~512 범위여야 합니다/)).toBeInTheDocument()
  })

  it('keeps partial decimal input while typing', async () => {
    render(<DefectControls />)
    await userEvent.click(screen.getByTestId('details-scratch'))
    const contrast = screen.getByTestId('scratch-contrast-max')
    await userEvent.clear(contrast)
    await userEvent.type(contrast, '0.')
    expect(contrast).toHaveValue('0.')
    await userEvent.type(contrast, '7')
    expect(useWorkspaceStore.getState().form.defects.scratch.params.contrast[1]).toBe(0.7)
  })

  it('opens folded details by itself when a value inside is invalid', () => {
    useWorkspaceStore.getState().setDefectParam('pinhole', 'radius_px', [50, 40])
    render(<DefectControls />)
    expect(screen.getByTestId('pinhole-radius-min')).toBeInTheDocument()
    expect(screen.getByText(/1~30 범위여야 합니다/)).toBeInTheDocument()
  })

  it('scratch direction "line" asks for a reference line and switches parallel/perpendicular', async () => {
    render(<DefectControls />)
    expect(screen.queryByTestId('line-start')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('orient-line'))
    expect(useWorkspaceStore.getState().form.defects.scratch.params.orientation.mode).toBe('parallel')
    expect(screen.getByTestId('line-start')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('orient-perpendicular'))
    expect(useWorkspaceStore.getState().form.defects.scratch.params.orientation.mode).toBe('perpendicular')
    await userEvent.click(screen.getByTestId('surface-match'))
    expect(useWorkspaceStore.getState().form.defects.scratch.params.shading.mode).toBe('local')
  })

  it('polarity buttons update the store', async () => {
    render(<DefectControls />)
    await userEvent.click(screen.getByTestId('contamination-polarity-bright'))
    expect(useWorkspaceStore.getState().form.defects.contamination.params.polarity).toBe('bright')
  })
})

describe('GenerationSettings', () => {
  it('disables generation until an image is loaded', () => {
    const { rerender } = render(
      <>
        <GenerationSettings />
        <GenerateBar />
      </>,
    )
    expect(screen.getByTestId('generate')).toBeDisabled()
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent('이미지를 먼저 업로드하세요')
    loadImage()
    rerender(
      <>
        <GenerationSettings />
        <GenerateBar />
      </>,
    )
    expect(screen.getByTestId('generate')).toBeEnabled()
  })

  it('validates the seed', async () => {
    loadImage()
    render(
      <>
        <GenerationSettings />
        <GenerateBar />
      </>,
    )
    const seed = screen.getByTestId('seed-input')
    await userEvent.clear(seed)
    await userEvent.type(seed, '-3')
    expect(screen.getByRole('alert')).toHaveTextContent('0 이상이어야')
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent('Seed는 0 이상이어야')
    expect(screen.getByTestId('generate')).toBeDisabled()
  })
})

describe('Export', () => {
  it('rejects counts outside 1..20 and disables the download button', async () => {
    loadImage()
    render(
      <>
        <ExportPanel />
        <ExportButton />
      </>,
    )
    expect(screen.getByTestId('export-button')).toHaveTextContent('10장')
    const input = screen.getByTestId('export-count')
    await userEvent.clear(input)
    await userEvent.type(input, '25')
    expect(screen.getByText(/1~20 사이의 정수/)).toBeInTheDocument()
    expect(screen.getByTestId('export-button')).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '3')
    expect(screen.getByTestId('export-seed-range')).toHaveTextContent('42 … 44')
    expect(screen.getByTestId('export-button')).toBeEnabled()
  })
})

describe('MaskLegend', () => {
  it('T13: the opacity slider changes only the view state', () => {
    const result = { metadata: { class_pixel_counts: { scratch: 1, pinhole: 2, contamination: 3 } }, image_png_base64: 'IMG' }
    useWorkspaceStore.setState({ currentResult: result as never })
    render(<MaskLegend />)
    fireEvent.change(screen.getByTestId('opacity-slider'), { target: { value: '25' } })
    expect(screen.getByTestId('opacity-value')).toHaveTextContent('25%')
    expect(useWorkspaceStore.getState().overlayOpacity).toBe(0.25)
    expect(useWorkspaceStore.getState().currentResult).toBe(result)
  })
})

describe('StatusBar', () => {
  it('shows the server error with code and expandable field details', async () => {
    useWorkspaceStore.setState({
      error: {
        code: 'INVALID_CONFIG',
        message: '설정값이 올바르지 않습니다',
        details: { errors: [{ field: 'defects[0].scratch.count', message: '20 이하여야 합니다' }] },
      },
    })
    render(<StatusBar />)
    expect(screen.getByTestId('error-message')).toHaveTextContent('설정값이 올바르지 않습니다')
    expect(screen.getByTestId('error-code')).toHaveTextContent('INVALID_CONFIG')
    await userEvent.click(screen.getByText('자세히'))
    expect(screen.getByText('defects[0].scratch.count: 20 이하여야 합니다')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('오류 닫기'))
    expect(useWorkspaceStore.getState().error).toBeNull()
  })
})
