import { useEffect, useState, type RefObject } from 'react'
import { colorizeClassMask, pngDataUrl } from './maskColors'

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export function useHtmlImage(src: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; img: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const img = new Image()
    img.onload = () => !cancelled && setLoaded({ src, img })
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])
  return src && loaded?.src === src ? loaded.img : null
}

/** Decode the grayscale class-mask PNG and paint it with the legend palette (view-only copy). */
export function useColorizedMask(base64: string | null): HTMLCanvasElement | null {
  const [state, setState] = useState<{ key: string; canvas: HTMLCanvasElement } | null>(null)
  useEffect(() => {
    if (!base64) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      pixels.data.set(colorizeClassMask(pixels.data))
      ctx.putImageData(pixels, 0, 0)
      setState({ key: base64, canvas })
    }
    img.src = pngDataUrl(base64)
    return () => {
      cancelled = true
    }
  }, [base64])
  return base64 && state?.key === base64 ? state.canvas : null
}
