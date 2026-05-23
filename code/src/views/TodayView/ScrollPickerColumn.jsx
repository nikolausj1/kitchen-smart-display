import { useEffect, useLayoutEffect, useRef } from 'react'

// One scroll-wheel column for the set-timer picker.
//
// CSS scroll-snap on a vertical overflow:auto container gives us native
// touch inertia for free. We render the list with one item-height of spacer
// above and below so the first and last entries can scroll into the centered
// position. A mask-image gradient on the viewport fades items as they
// approach the edges, producing the iOS-style scroll wheel look without any
// drag math.
//
// onChange fires on every scroll event with the item closest to the center.

export default function ScrollPickerColumn({
  items,
  value,
  onChange,
  formatItem = (v) => String(v),
  ariaLabel,
  variant = 'digits', // 'digits' | 'ampm' - controls text size via CSS class
}) {
  const ref = useRef(null)
  const isProgrammaticScrollRef = useRef(false)

  // Scroll to the current value on mount and whenever value changes from
  // outside (e.g. component re-mounted, parent reset). The flag prevents
  // the onScroll handler from firing a redundant onChange in response.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const idx = items.indexOf(value)
    if (idx < 0) return
    const itemHeight = el.firstElementChild?.nextElementSibling?.offsetHeight
    if (!itemHeight) return
    isProgrammaticScrollRef.current = true
    el.scrollTop = idx * itemHeight
    // Release the flag after the scroll event has fired and settled.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false
      })
    })
  }, [value, items])

  // Update value as user scrolls. Read the centered item by dividing scroll
  // position by item height and rounding.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    function handleScroll() {
      if (isProgrammaticScrollRef.current) return
      const itemHeight = el.firstElementChild?.nextElementSibling?.offsetHeight
      if (!itemHeight) return
      const idx = Math.round(el.scrollTop / itemHeight)
      const clamped = Math.max(0, Math.min(items.length - 1, idx))
      const next = items[clamped]
      if (next !== value) onChange(next)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [items, value, onChange])

  const colClass = `scroll-picker scroll-picker--${variant}`
  return (
    <div
      ref={ref}
      className={colClass}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <div className="scroll-picker__spacer" aria-hidden="true" />
      {items.map((item) => {
        const isSelected = item === value
        return (
          <div
            key={String(item)}
            className={
              'scroll-picker__item' +
              (isSelected ? ' scroll-picker__item--selected' : '')
            }
            role="option"
            aria-selected={isSelected}
          >
            {formatItem(item)}
          </div>
        )
      })}
      <div className="scroll-picker__spacer" aria-hidden="true" />
    </div>
  )
}
