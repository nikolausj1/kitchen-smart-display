import { useEffect, useState } from 'react'

// useBoxSize(ref) -> { w, h, vw }: the element's content size and the
// window's width, in CSS px, from a ResizeObserver ({ w: 0, h: 0, vw: 0 }
// until it first reports, and where there is none). For the weather panels
// whose arrangement depends on their box (the hourly strip's automatic
// columns, the conditions' one or two columns, the alert's second line).
//
// setState lives in the observer's callback, not in the effect body, and
// short-circuits when nothing moved, so it cannot loop (the PhotoPanel
// pattern).
export default function useBoxSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0, vw: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect
      if (!rect) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      const vw = typeof window !== 'undefined' ? window.innerWidth : 0
      setSize((prev) => (prev.w === w && prev.h === h && prev.vw === vw ? prev : { w, h, vw }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
