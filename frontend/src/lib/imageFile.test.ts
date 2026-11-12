import { describe, expect, it } from 'vitest'
import { checkDimensions, precheckFile } from './imageFile'

const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type })

describe('precheckFile', () => {
  it('accepts PNG/JPEG/WebP by MIME type or extension', () => {
    expect(precheckFile(file('a.png', 'image/png', 10))).toBeNull()
    expect(precheckFile(file('a.JPG', '', 10))).toBeNull()
    expect(precheckFile(file('a.bin', 'image/webp', 10))).toBeNull()
  })

  it('rejects other types, empty files and files over 10 MiB', () => {
    expect(precheckFile(file('a.gif', 'image/gif', 10))).toContain('PNG, JPEG, WebP')
    expect(precheckFile(file('notes.txt', 'text/plain', 10))).toContain('PNG, JPEG, WebP')
    expect(precheckFile(file('a.png', 'image/png', 0))).toContain('빈 파일')
    expect(precheckFile(file('a.png', 'image/png', 10 * 1024 * 1024 + 1))).toContain('10 MiB')
  })
})

describe('checkDimensions', () => {
  it('enforces 32..2048 px on both sides', () => {
    expect(checkDimensions(32, 2048)).toBeNull()
    expect(checkDimensions(31, 100)).toContain('31×100')
    expect(checkDimensions(100, 2049)).toContain('32~2048')
  })
})
