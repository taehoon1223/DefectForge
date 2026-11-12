import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'

// Geometry of the bundled synthetic part sample (examples/configs/regions_scratch.json).
const EXAMPLE = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../examples/configs/regions_scratch.json'), 'utf8'))
const ELECTRODE: number[][] = EXAMPLE.regions[0].polygon
const LINE: { start: number[]; end: number[] } = EXAMPLE.reference_line
const PART_IMAGE = path.resolve(import.meta.dirname, '../public/samples/part_synthetic_640x400.png')

async function openPart(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('api-status')).toHaveAttribute('data-state', 'ok')
  await page.getByTestId('file-input').setInputFiles(PART_IMAGE)
  await expect(page.getByTestId('source-meta')).toContainText('640 × 400 px')
}

async function viewState(page: Page) {
  const el = page.getByTestId('canvas-container')
  const box = (await el.boundingBox())!
  const num = async (name: string) => Number(await el.getAttribute(name))
  return { box, scale: await num('data-scale'), x: await num('data-offset-x'), y: await num('data-offset-y') }
}

async function pixelToPage(page: Page, px: number, py: number) {
  const v = await viewState(page)
  const p = { x: v.box.x + v.x + (px + 0.5) * v.scale, y: v.box.y + v.y + (py + 0.5) * v.scale }
  expect(p.x).toBeGreaterThan(v.box.x)
  expect(p.x).toBeLessThan(v.box.x + v.box.width)
  expect(p.y).toBeGreaterThan(v.box.y)
  expect(p.y).toBeLessThan(v.box.y + v.box.height)
  return p
}

async function clickPixels(page: Page, points: number[][]) {
  for (const [x, y] of points) {
    const p = await pixelToPage(page, x, y)
    await page.mouse.click(p.x, p.y)
  }
}

async function listPoints(page: Page): Promise<number[][]> {
  return page
    .getByTestId('region-points')
    .locator('li')
    .evaluateAll((items) => items.map((li) => [Number((li as HTMLElement).dataset.x), Number((li as HTMLElement).dataset.y)]))
}

function expectWithin1px(actual: number[][], expected: number[][]) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach(([x, y], i) => {
    expect(Math.abs(actual[i][0] - x)).toBeLessThanOrEqual(1)
    expect(Math.abs(actual[i][1] - y)).toBeLessThanOrEqual(1)
  })
}

async function generate(page: Page) {
  const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/v1/preview')), page.getByTestId('generate').click()])
  return response
}

async function scratchOnly(page: Page) {
  await page.getByTestId('enable-pinhole').uncheck()
  await page.getByTestId('enable-contamination').uncheck()
}

test('부품 예시: 확대·팬 후 생성·제외 영역과 기준선 지정 → 미리보기 → ZIP', async ({ page }) => {
  await openPart(page)
  await expect(page.getByTestId('area-status')).toContainText('이미지 전체')

  // Zoom in and pan so that clicks go through a non-trivial view transform.
  await page.getByTestId('zoom-in').click()
  let v = await viewState(page)
  await page.mouse.move(v.box.x + v.box.width / 2, v.box.y + v.box.height / 2)
  await page.mouse.down()
  await page.mouse.move(v.box.x + v.box.width / 2 + 160, v.box.y + v.box.height / 2 + 20, { steps: 6 })
  await page.mouse.up()
  v = await viewState(page)
  expect(v.scale).toBeGreaterThan(1.5)

  await page.getByTestId('add-include').click()
  await clickPixels(page, ELECTRODE)
  await page.keyboard.press('Enter')
  const row = page.locator('[data-region-kind="include"]').first()
  expectWithin1px(await listPoints(page), ELECTRODE)
  await expect(page.getByTestId('area-status')).toContainText('생성 영역 1개')

  const xs = ELECTRODE.map((p) => p[0])
  const ys = ELECTRODE.map((p) => p[1])
  const cx = Math.round(xs.reduce((a, b) => a + b) / 4)
  const cy = Math.round(ys.reduce((a, b) => a + b) / 4)
  const hole = [
    [cx - 12, cy - 12],
    [cx + 12, cy - 12],
    [cx + 12, cy + 12],
    [cx - 12, cy + 12],
  ]
  await page.getByTestId('add-exclude').click()
  await clickPixels(page, hole)
  await page.getByTestId('region-close').click()
  expectWithin1px(await listPoints(page), hole)
  await expect(page.getByTestId('area-status')).toContainText('제외 영역 1개')

  await scratchOnly(page)
  await page.getByTestId('orient-line').click()
  await expect(page.getByTestId('blocked-reason')).toContainText('기준선이 필요')
  // Only the direction matters: use a point 40% along the line so both clicks stay in the zoomed view.
  const lineEnd = [0, 1].map((k) => Math.round(LINE.start[k] + 0.4 * (LINE.end[k] - LINE.start[k])))
  await page.getByTestId('line-start').click()
  await clickPixels(page, [LINE.start, lineEnd])
  const readout = page.getByTestId('line-readout')
  await expect(readout).toBeVisible()
  expect(Math.abs(Number(await readout.getAttribute('data-start-x')) - LINE.start[0])).toBeLessThanOrEqual(1)
  expect(Math.abs(Number(await readout.getAttribute('data-start-y')) - LINE.start[1])).toBeLessThanOrEqual(1)
  expect(Math.abs(Number(await readout.getAttribute('data-end-x')) - lineEnd[0])).toBeLessThanOrEqual(1)
  expect(Math.abs(Number(await readout.getAttribute('data-end-y')) - lineEnd[1])).toBeLessThanOrEqual(1)
  const lineAngle = Number(await readout.getAttribute('data-angle'))
  expect(lineAngle).toBeGreaterThan(6)
  expect(lineAngle).toBeLessThan(10)

  await page.getByTestId('surface-match').check()
  await page.getByTestId('details-scratch').click()
  await page.getByTestId('scratch-length-min').fill('20')
  await page.getByTestId('scratch-length-max').fill('50')
  await page.getByTestId('count-scratch').fill('3')
  const response = await generate(page)
  expect(response.status()).toBe(200)
  const preview = await response.json()
  const meta = preview.metadata
  expect(meta.version).toBe('1.1')
  expect(meta.generated_count).toBe(3)
  expect(meta.area.excluded_pixel_count).toBeGreaterThan(0)
  expect(meta.reference_line.angle_deg).toBeCloseTo(lineAngle, 3)
  expect(meta.surface_analysis).not.toBeNull()
  for (const inst of meta.instances) {
    const diff = Math.abs(((((inst.params.angle_deg - inst.params.base_angle_deg + 90) % 180) + 180) % 180) - 90)
    expect(diff).toBeLessThanOrEqual(5 + 1e-6) // default jitter ±5°
    expect(inst.bbox_xyxy[0]).toBeGreaterThanOrEqual(Math.min(...xs))
    expect(inst.bbox_xyxy[2]).toBeLessThanOrEqual(Math.max(...xs))
    expect(inst.bbox_xyxy[1]).toBeGreaterThanOrEqual(Math.min(...ys))
    expect(inst.bbox_xyxy[3]).toBeLessThanOrEqual(Math.max(...ys))
  }
  await expect(page.getByTestId('result-scope')).toHaveText('영역 1개 − 제외 1개')
  await expect(page.getByTestId('stale-badge')).toHaveCount(0)

  // A display-name change does not invalidate the result; a setting change does.
  await row.getByTestId('region-name').fill('전극 좌측')
  await expect(page.getByTestId('stale-badge')).toHaveCount(0)
  await page.getByTestId('advanced-settings').click()
  await page.getByTestId('edge-margin').fill('3')
  await expect(page.getByTestId('stale-badge')).toBeVisible()
  await page.getByTestId('edge-margin').fill('0')
  await expect(page.getByTestId('stale-badge')).toHaveCount(0)

  await page.getByTestId('export-count').fill('3')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-button').click()])
  const files = unzipSync(fs.readFileSync(await dl.path()))
  expect(Buffer.from(files['images/image_0001.png']).equals(Buffer.from(preview.image_png_base64, 'base64'))).toBe(true)
  expect(Buffer.from(files['masks/mask_0001.png']).equals(Buffer.from(preview.class_mask_png_base64, 'base64'))).toBe(true)
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  expect(manifest.area.allowed_mask_sha256).toBe(meta.area.allowed_mask_sha256)
  const sample3 = JSON.parse(strFromU8(files['metadata/image_0003.json']))
  expect(sample3.version).toBe('1.1')
  expect(sample3.config.regions[0].name).toBe('전극 좌측')
})

test('빈 허용 영역은 서버가 원인과 함께 거절하고 영역은 유지된다', async ({ page }) => {
  await openPart(page)
  const corner = [
    [560, 20],
    [630, 20],
    [630, 60],
  ]
  await page.getByTestId('add-include').click()
  await clickPixels(page, corner)
  await page.keyboard.press('Enter')
  await page.getByTestId('add-exclude').click()
  await clickPixels(page, [
    [540, 10],
    [636, 10],
    [636, 80],
    [540, 80],
  ])
  await page.keyboard.press('Enter')
  const response = await generate(page)
  expect(response.status()).toBe(422)
  await expect(page.getByTestId('error-code')).toHaveText('EMPTY_ALLOWED_AREA')
  await expect(page.getByTestId('error-message')).toContainText('영역이 비어')
  await expect(page.locator('[data-region-kind]')).toHaveCount(2)
})

test('이미지를 교체하면 영역·기준선·결과가 초기화된다', async ({ page }) => {
  await openPart(page)
  await page.getByTestId('add-include').click()
  await clickPixels(page, ELECTRODE)
  await page.keyboard.press('Enter')
  await scratchOnly(page)
  await page.getByTestId('orient-line').click()
  await page.getByTestId('line-start').click()
  await clickPixels(page, [LINE.start, LINE.end])
  await page.getByTestId('details-scratch').click()
  await page.getByTestId('scratch-length-min').fill('20')
  await page.getByTestId('scratch-length-max').fill('50')
  expect((await generate(page)).status()).toBe(200)
  await expect(page.getByTestId('result-scope')).toBeVisible()

  await page.getByTestId('file-input').setInputFiles(PART_IMAGE)
  await expect(page.locator('[data-region-kind]')).toHaveCount(0)
  await expect(page.getByTestId('line-readout')).toHaveCount(0)
  await expect(page.getByTestId('area-status')).toContainText('이미지 전체')
  await expect(page.getByTestId('generation-summary')).toContainText('아직 생성된 결과가 없습니다')
})
