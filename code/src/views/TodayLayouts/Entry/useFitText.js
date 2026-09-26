import { useLayoutEffect, useRef } from 'react'
import { createFitter } from '../lib/fitText.js'

// useFitText(boxRef, keys, version) - keeps the box's shrink-to-fit elements
// fitted (lib/fitText.js). keys: 'a,b', the data-edit keys whose style says
// fit: 'shrink' (specStyles.js shrinkKeysOf); '' starts nothing at all.
// version: anything that changes when the box's spec does (the panel object),
// which re-fits every element, since a knob or a style can change its room
// without changing its text. Layout effects, so the fit lands before the
// browser paints: no frame of unfitted text on mount or on an edit.
export default function useFitText(boxRef, keys, version) {
  const fitterRef = useRef(null)
  // A fitter fits as it starts: the version effect of that same commit skips.
  const freshRef = useRef(false)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !keys) return undefined
    const fitter = createFitter(box, keys.split(','))
    fitterRef.current = fitter
    freshRef.current = true
    return () => {
      fitter.stop()
      if (fitterRef.current === fitter) fitterRef.current = null
    }
  }, [boxRef, keys])

  useLayoutEffect(() => {
    if (freshRef.current) {
      freshRef.current = false
      return
    }
    if (version != null && fitterRef.current) fitterRef.current.flush(true)
  }, [version])
}
