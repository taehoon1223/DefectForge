import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'

const SAMPLE = path.resolve(import.meta.dirname, '../public/samples/brushed_metal_512x448.png')
// Synthetic labelled sample: a crop of the sample above with a drawn dark scratch (class 0, 80×3 px, 30°) and a
// bright spot (class 1, r 5), labelled as YOLO segmentation polygons; classes.txt names them line_mark / dot.
const DEFECT_IMAGE = path.resolve(import.meta.dirname, 'fixtures/defect_sample.png')
const DEFECT_LABEL = path.resolve(import.meta.dirname, 'fixtures/defect_sample.txt')
const CLASS_NAMES = path.resolve(import.meta.dirname, 'fixtures/classes.txt')

async function upload(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('api-status')).toHaveAttribute('data-state', 'ok')
  await page.getByTestId('file-input').setInputFiles(SAMPLE)
  await expect(page.getByTestId('source-meta')).toContainText('512 × 448 px')
}

async function generate(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/preview')),
    page.getByTestId('generate').click(),
  ])
  return response
}

/** Current view transform as exposed by the canvas container. */
async function viewState(page: Page, canvasTestId = 'canvas-container') {
  const el = page.getByTestId(canvasTestId)
  const box = (await el.boundingBox())!
  const num = async (name: string) => Number(await el.getAttribute(name))
  return { box, scale: await num('data-scale'), x: await num('data-offset-x'), y: await num('data-offset-y') }
}

/** Page coordinates of the centre of image pixel (px, py) under the current zoom/pan. */
async function pixelToPage(page: Page, px: number, py: number, canvasTestId = 'canvas-container') {
  const v = await viewState(page, canvasTestId)
  return { x: v.box.x + v.x + (px + 0.5) * v.scale, y: v.box.y + v.y + (py + 0.5) * v.scale }
}

async function regionPoints(page: Page): Promise<number[][]> {
  return page
    .getByTestId('region-points')
    .locator('li')
    .evaluateAll((items) => items.map((li) => [Number((li as HTMLElement).dataset.x), Number((li as HTMLElement).dataset.y)]))
}

function pngHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), bitDepth: bytes[24], colorType: bytes[25] }
}

async function download(page: Page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-button').click()])
  return { name: dl.suggestedFilename(), files: unzipSync(fs.readFileSync(await dl.path())) }
}

test('업로드 → 생성 미리보기 → 보기 모드 전환 → 원본 크기 결과', async ({ page }) => {
  await upload(page)
  await expect(page.getByTestId('area-status')).toContainText('이미지 전체')
  const response = await generate(page)
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.image_png_base64.startsWith('data:')).toBe(false)

  await expect(page.getByTestId('generated-count')).toHaveText('7 / 7')
  await expect(page.getByTestId('output-size')).toContainText('512 × 448 px')
  await expect(page.getByTestId('output-size')).toContainText('동일')
  await expect(page.getByTestId('status-text')).toContainText('미리보기 완료')
  await expect(page.getByTestId('view-overlay')).toHaveAttribute('aria-selected', 'true')
  for (const mode of ['original', 'generated', 'classMask', 'overlay']) {
    await page.getByTestId(`view-${mode}`).click()
    await expect(page.getByTestId(`view-${mode}`)).toHaveAttribute('aria-selected', 'true')
  }
  for (const type of ['scratch', 'pinhole', 'contamination']) {
    await expect(page.getByTestId(`legend-count-${type}`)).toContainText('px')
  }
})

test('T13: 오버레이 불투명도를 바꿔도 결과 파일은 미리보기와 바이트 단위로 동일', async ({ page }) => {
  await upload(page)
  const preview = await (await generate(page)).json()
  const slider = page.getByTestId('opacity-slider')
  await slider.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('opacity-value')).toHaveText('55%')

  await page.getByTestId('export-count').fill('1')
  const { files } = await download(page)
  const same = (name: string, b64: string) => Buffer.from(files[name]).equals(Buffer.from(b64, 'base64'))
  expect(same('images/image_0001.png', preview.image_png_base64)).toBe(true)
  expect(same('masks/mask_0001.png', preview.class_mask_png_base64)).toBe(true)
  expect(same('binary_masks/binary_0001.png', preview.binary_mask_png_base64)).toBe(true)
})

test('T14: 확대·팬 이후 클릭한 영역 꼭짓점이 원본 픽셀 좌표와 1px 이내로 일치', async ({ page }) => {
  await upload(page)
  await page.getByTestId('zoom-in').click()
  await page.getByTestId('zoom-in').click()
  let v = await viewState(page)
  const cx = v.box.x + v.box.width / 2
  const cy = v.box.y + v.box.height / 2
  await page.mouse.move(cx, cy) // pan (select tool)
  await page.mouse.down()
  await page.mouse.move(cx + 90, cy + 50, { steps: 6 })
  await page.mouse.up()
  await page.mouse.wheel(0, -120) // zoom at the cursor
  await expect.poll(async () => (await viewState(page)).scale).toBeGreaterThan(v.scale)
  v = await viewState(page)
  expect(v.scale).toBeGreaterThan(2)

  // Choose targets inside the visible part of the image.
  const left = Math.max(0, (0 - v.x) / v.scale)
  const top = Math.max(0, (0 - v.y) / v.scale)
  const right = Math.min(511, (v.box.width - v.x) / v.scale)
  const bottom = Math.min(447, (v.box.height - v.y) / v.scale)
  const at = (fx: number, fy: number) => [Math.floor(left + (right - left) * fx), Math.floor(top + (bottom - top) * fy)]
  const targets = [at(0.2, 0.2), at(0.8, 0.25), at(0.75, 0.8), at(0.25, 0.75)]

  await page.getByTestId('add-include').click()
  for (const [px, py] of targets) {
    const p = await pixelToPage(page, px, py)
    expect(p.x).toBeGreaterThan(v.box.x)
    expect(p.x).toBeLessThan(v.box.x + v.box.width)
    await page.mouse.click(p.x, p.y)
  }
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('area-status')).toContainText('생성 영역 1개')
  const points = await regionPoints(page)
  expect(points).toHaveLength(4)
  targets.forEach(([tx, ty], i) => {
    expect(Math.abs(points[i][0] - tx)).toBeLessThanOrEqual(1)
    expect(Math.abs(points[i][1] - ty)).toBeLessThanOrEqual(1)
  })

  // Edit: drag the first vertex by +12 image px in x.
  const from = await pixelToPage(page, points[0][0], points[0][1])
  const to = await pixelToPage(page, points[0][0] + 12, points[0][1])
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  const moved = await regionPoints(page)
  expect(Math.abs(moved[0][0] - (points[0][0] + 12))).toBeLessThanOrEqual(1)
  expect(Math.abs(moved[0][1] - points[0][1])).toBeLessThanOrEqual(1)

  // The server echoes the region it received (config.regions / area.regions) and keeps every defect inside it.
  const response = await generate(page)
  const meta = (await response.json()).metadata
  expect(meta.config.regions[0].polygon).toEqual(moved)
  expect(meta.area.regions[0].polygon).toEqual(moved)
  const xs = moved.map((p) => p[0])
  const ys = moved.map((p) => p[1])
  for (const inst of meta.instances) {
    expect(inst.bbox_xyxy[0]).toBeGreaterThanOrEqual(Math.min(...xs))
    expect(inst.bbox_xyxy[2]).toBeLessThanOrEqual(Math.max(...xs))
    expect(inst.bbox_xyxy[1]).toBeGreaterThanOrEqual(Math.min(...ys))
    expect(inst.bbox_xyxy[3]).toBeLessThanOrEqual(Math.max(...ys))
  }
})

test('텍스처 결함·패치 이식을 켜면 클래스 4·5로 함께 생성된다', async ({ page }) => {
  await upload(page)
  await page.getByTestId('enable-texture').check()
  await page.getByTestId('enable-patch').check()
  await page.getByTestId('texture-source-noise').click()
  await page.getByTestId('patch-blend-mixed').click()
  const response = await generate(page)
  expect(response.status()).toBe(200)
  const meta = (await response.json()).metadata
  expect(meta.class_map).toMatchObject({ '4': 'texture', '5': 'patch' })
  expect(meta.instances.filter((i: { type: string }) => i.type === 'texture')).toHaveLength(2)
  expect(meta.instances.filter((i: { type: string }) => i.type === 'patch')).toHaveLength(2)
  expect(meta.config.defects.map((d: { type: string }) => d.type)).toEqual(['scratch', 'pinhole', 'contamination', 'texture', 'patch'])
  await expect(page.getByTestId('generated-count')).toHaveText('11 / 11')
  await expect(page.getByTestId('legend-count-texture')).toHaveText(`${meta.class_pixel_counts.texture.toLocaleString('en-US')} px`)
})

test('YOLO 라벨 샘플로 스크래치 크기·대비를 맞추고, 실제 결함을 라벨 클래스별(6, 7)로 옮겨 붙인다', async ({ page }) => {
  await upload(page)
  await page.getByTestId('enable-real').check()
  await expect(page.getByTestId('real-sample-status')).toContainText('없음')
  await expect(page.getByTestId('generate')).toBeDisabled()

  await page.getByRole('button', { name: '결함 샘플 펼치기' }).click()
  await page.getByTestId('class-names-input').setInputFiles(CLASS_NAMES)
  await expect(page.getByTestId('class-names-name')).toHaveText('classes.txt')
  await page.getByTestId('sample-image-input').setInputFiles(DEFECT_IMAGE)
  await page.getByTestId('sample-label-input').setInputFiles(DEFECT_LABEL)
  const [analyzed] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/defect-samples/analyze')),
    page.getByTestId('sample-add').click(),
  ])
  expect(analyzed.status()).toBe(200)
  const { suggestions } = await analyzed.json()
  await expect(page.getByTestId('sample-item')).toHaveCount(1)
  await expect(page.getByTestId('sample-defects-0')).toHaveText('결함 2')
  await expect(page.getByTestId('sample-classes')).toContainText('line_mark')
  await expect(page.getByTestId('real-sample-status')).toHaveText('1개 · 결함 2개 · 클래스 2개')

  await page.getByTestId('fit-scratch').click()
  await page.getByTestId('details-scratch').click()
  await expect(page.getByTestId('scratch-length-min')).toHaveValue(String(suggestions.scratch.length_px[0]))
  await expect(page.getByTestId('scratch-width-max')).toHaveValue(String(suggestions.scratch.width_px[1]))
  await expect(page.getByTestId('scratch-polarity-dark')).toHaveAttribute('aria-pressed', 'true') // fitted to the dark scratch only, not the bright spot
  await expect(page.getByTestId('sample-summary')).toContainText('(1개 / 1개)')

  await page.getByTestId('count-real').fill('6')
  const response = await generate(page)
  expect(response.status()).toBe(200)
  const meta = (await response.json()).metadata
  expect(meta.class_map).toMatchObject({ '6': 'real:line_mark', '7': 'real:dot' })
  const real = meta.instances.filter((i: { type: string }) => i.type === 'real')
  expect(real).toHaveLength(6)
  for (const inst of real) expect(inst.class_id).toBe(6 + inst.params.label_class)
  expect(meta.real_samples.class_names).toEqual(['line_mark', 'dot'])
  await expect(page.getByTestId('legend-count-real-1')).toHaveText(`${meta.class_pixel_counts['real:dot'].toLocaleString('en-US')} px`)

  // The dataset carries YOLO labels with the sample's own class numbers first.
  const { files } = await download(page)
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  expect(manifest.yolo.names).toMatchObject({ '0': 'line_mark', '1': 'dot', '2': 'scratch' })
  expect(strFromU8(files['data.yaml'])).toContain('0: "line_mark"')
  const labelClasses = new Set(strFromU8(files['labels/image_0001.txt']).trim().split('\n').map((l) => l.split(' ')[0]))
  expect([...labelClasses].every((c) => ['0', '1', '2', '3', '4'].includes(c))).toBe(true)
})

test('라벨 파일 없이 결함 이미지 위에 결함을 직접 그려 샘플로 추가하고, 그린 클래스별로 옮겨 붙인다', async ({ page }) => {
  await upload(page)
  await page.getByRole('button', { name: '결함 샘플 펼치기' }).click()
  await expect(page.getByTestId('sample-draw')).toBeDisabled()
  await page.getByTestId('sample-image-input').setInputFiles(DEFECT_IMAGE)
  await page.getByTestId('sample-draw').click()
  const editor = page.getByTestId('sample-editor')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('sample-canvas')).not.toHaveAttribute('data-scale', '1') // fitted to the 200×160 image

  const clickPixels = async (points: number[][]) => {
    for (const [px, py] of points) {
      const p = await pixelToPage(page, px, py, 'sample-canvas')
      await page.mouse.click(p.x, p.y)
    }
  }
  // The fixture's dark scratch (class 0), closed with Enter; then its bright spot as class 1, closed on the first point.
  const scratch = [[44, 46], [118, 88], [115, 94], [41, 52]]
  await clickPixels(scratch)
  await page.keyboard.press('Enter')
  await page.getByTestId('sample-class').fill('1')
  const spot = [[158, 113], [172, 113], [172, 127], [158, 127]]
  await clickPixels([...spot, spot[0]])
  await expect(page.getByTestId('sample-defect')).toHaveCount(2)
  await expect(page.getByTestId('sample-defect-class-0')).toHaveValue('0')
  await expect(page.getByTestId('sample-defect-class-1')).toHaveValue('1')

  const [analyzed] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/v1/defect-samples/analyze')),
    page.getByTestId('sample-editor-add').click(),
  ])
  expect(analyzed.status()).toBe(200)
  const { defects } = await analyzed.json()
  // The server's defect pixels are exactly the drawn polygons (vertices included).
  expect(defects.map((d: { class_id: number; bbox_xyxy: number[] }) => [d.class_id, d.bbox_xyxy])).toEqual([
    [0, [41, 46, 118, 94]],
    [1, [158, 113, 172, 127]],
  ])
  await expect(editor).toHaveCount(0)
  await expect(page.getByTestId('sample-item')).toHaveCount(1)
  await expect(page.getByTestId('sample-defects-0')).toHaveText('결함 2')
  await expect(page.getByTestId('sample-image-name')).toHaveText('—')

  await page.getByTestId('enable-real').check()
  await expect(page.getByTestId('real-sample-status')).toHaveText('1개 · 결함 2개 · 클래스 2개')
  await page.getByTestId('count-real').fill('4')
  const response = await generate(page)
  expect(response.status()).toBe(200)
  const meta = (await response.json()).metadata
  expect(meta.class_map).toMatchObject({ '6': 'real:class_0', '7': 'real:class_1' })
  expect(meta.instances.filter((i: { type: string }) => i.type === 'real')).toHaveLength(4)
})

test('데이터셋 ZIP N=10: 이미지·클래스 마스크·바이너리 마스크·메타데이터가 1:1로 대응', async ({ page }) => {
  await upload(page)
  await page.getByTestId('seed-input').fill('100')
  await page.getByTestId('export-count').fill('10')
  await expect(page.getByTestId('export-seed-range')).toHaveText('100 … 109')
  const { name, files } = await download(page)
  expect(name).toBe('defectforge_dataset.zip')

  const names = Object.keys(files).filter((n) => !n.endsWith('/'))
  const folder = (prefix: string) => names.filter((n) => n.startsWith(prefix)).sort()
  const expected = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(4, '0'))
  expect(folder('images/')).toEqual(expected.map((n) => `images/image_${n}.png`))
  expect(folder('masks/')).toEqual(expected.map((n) => `masks/mask_${n}.png`))
  expect(folder('binary_masks/')).toEqual(expected.map((n) => `binary_masks/binary_${n}.png`))
  expect(folder('metadata/')).toEqual(expected.map((n) => `metadata/image_${n}.json`))
  expect(folder('labels/')).toEqual(expected.map((n) => `labels/image_${n}.txt`)) // YOLO segmentation labels
  expect(names).toContain('manifest.json')
  expect(names).toContain('README.txt')
  expect(names).toContain('data.yaml')

  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  expect(manifest.sample_count).toBe(10)
  expect(manifest.files.map((f: { seed: number }) => f.seed)).toEqual(expected.map((_, i) => 100 + i))
  for (const n of expected) {
    const image = pngHeader(files[`images/image_${n}.png`])
    const mask = pngHeader(files[`masks/mask_${n}.png`])
    const binary = pngHeader(files[`binary_masks/binary_${n}.png`])
    expect(image).toEqual({ width: 512, height: 448, bitDepth: 8, colorType: 2 }) // RGB
    expect(mask).toEqual({ width: 512, height: 448, bitDepth: 8, colorType: 0 }) // grayscale, not palette
    expect(binary).toEqual({ width: 512, height: 448, bitDepth: 8, colorType: 0 })
    const meta = JSON.parse(strFromU8(files[`metadata/image_${n}.json`]))
    expect(meta.generated_count).toBe(meta.requested_count)
  }
  await expect(page.getByTestId('toast-success')).toContainText('10장')
})

test('잘못된 파일·파라미터·불가능한 배치를 한국어로 안내하고 설정은 유지', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('file-input').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') })
  await expect(page.getByTestId('toast-error')).toContainText('디코딩할 수 없습니다')
  await expect(page.getByTestId('generate')).toBeDisabled()
  await expect(page.getByTestId('export-button')).toBeDisabled()

  await page.getByTestId('file-input').setInputFiles(SAMPLE)
  await expect(page.getByTestId('source-meta')).toContainText('512 × 448')

  await page.getByTestId('count-scratch').fill('99')
  await expect(page.getByTestId('defect-scratch')).toContainText('20 이하여야 합니다')
  await expect(page.getByTestId('generate')).toBeDisabled()

  await page.getByTestId('count-scratch').fill('20')
  await page.getByTestId('details-scratch').click()
  await page.getByTestId('scratch-length-min').fill('500')
  await page.getByTestId('scratch-length-max').fill('512')
  const response = await generate(page)
  expect(response.status()).toBe(422)
  await expect(page.getByTestId('error-message')).toContainText('배치하지 못했습니다')
  await expect(page.getByTestId('error-code')).toHaveText('DEFECT_PLACEMENT_FAILED')
  await expect(page.getByTestId('scratch-length-min')).toHaveValue('500')
  await expect(page.getByTestId('count-scratch')).toHaveValue('20')
  await expect(page.getByTestId('generate')).toBeEnabled()
})

test('설정 변경 표시, 이미지 교체 시 영역·결과 초기화', async ({ page }) => {
  await upload(page)
  await generate(page)
  await expect(page.getByTestId('generated-count')).toHaveText('7 / 7')
  await expect(page.getByTestId('stale-badge')).toHaveCount(0)

  await page.getByTestId('seed-input').fill('43')
  await expect(page.getByTestId('stale-badge')).toBeVisible()
  await expect(page.getByTestId('status-text')).toContainText('설정이 변경되었습니다')
  await generate(page)
  await expect(page.getByTestId('result-seed')).toHaveText('43')
  await expect(page.getByTestId('stale-badge')).toHaveCount(0)

  await page.getByTestId('add-include').click()
  for (const [px, py] of [
    [100, 100],
    [300, 120],
    [200, 300],
  ]) {
    const p = await pixelToPage(page, px, py)
    await page.mouse.click(p.x, p.y)
  }
  await page.getByTestId('region-close').click()
  await expect(page.getByTestId('area-status')).toContainText('생성 영역 1개')

  await page.getByTestId('file-input').setInputFiles(SAMPLE)
  await expect(page.getByTestId('area-status')).toContainText('이미지 전체')
  await expect(page.getByTestId('generation-summary')).toContainText('아직 생성된 결과가 없습니다')
})

test.describe('모바일 화면', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('세로 스택에서도 업로드·생성·다운로드 버튼을 사용할 수 있다', async ({ page }) => {
    await upload(page)
    await page.getByTestId('generate').scrollIntoViewIfNeeded()
    await generate(page)
    await expect(page.getByTestId('generated-count')).toHaveText('7 / 7')
    await expect(page.getByTestId('export-button')).toBeVisible()
    await expect(page.getByTestId('export-button')).toBeEnabled()
  })

  test('터치 탭으로 영역 꼭짓점을 추가할 수 있다', async ({ page }) => {
    await upload(page)
    await page.getByTestId('add-include').click()
    await page.getByTestId('canvas-container').scrollIntoViewIfNeeded()
    const targets = [
      [80, 80],
      [400, 90],
      [260, 360],
    ]
    for (const [px, py] of targets) {
      const p = await pixelToPage(page, px, py)
      await page.touchscreen.tap(p.x, p.y)
      await page.waitForTimeout(400) // keep taps apart so they are not read as a double-tap
    }
    await page.getByTestId('region-close').click()
    await expect(page.getByTestId('area-status')).toContainText('생성 영역 1개')
    const points = await regionPoints(page)
    targets.forEach(([tx, ty], i) => {
      expect(Math.abs(points[i][0] - tx)).toBeLessThanOrEqual(1)
      expect(Math.abs(points[i][1] - ty)).toBeLessThanOrEqual(1)
    })
  })
})
