import { LIMITS } from '../types/generation'

/** Cheap checks before decoding; the backend re-validates by actually decoding the bytes. */
export function precheckFile(file: File): string | null {
  const name = file.name.toLowerCase()
  const typeOk = LIMITS.image.acceptedMimeTypes.includes(file.type) || LIMITS.image.acceptedExtensions.some((ext) => name.endsWith(ext))
  if (!typeOk) return 'PNG, JPEG, WebP 이미지만 업로드할 수 있습니다.'
  if (file.size === 0) return '빈 파일입니다.'
  if (file.size > LIMITS.image.maxUploadBytes) {
    return `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)} MiB). 최대 ${LIMITS.image.maxUploadBytes / 1024 / 1024} MiB까지 업로드할 수 있습니다.`
  }
  return null
}

export function checkDimensions(width: number, height: number): string | null {
  const { minDim, maxDim } = LIMITS.image
  if (width < minDim || height < minDim || width > maxDim || height > maxDim) {
    return `이미지 크기 ${width}×${height}px는 지원 범위를 벗어났습니다. 가로·세로 모두 ${minDim}~${maxDim}px이어야 합니다.`
  }
  return null
}

/** Browser decode (applies EXIF orientation like the backend's exif_transpose). */
export function decodeImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('decode'))
    img.src = url
  })
}
