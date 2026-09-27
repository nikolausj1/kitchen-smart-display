import { useEffect, useRef, useState } from 'react'
import { ERROR_MS, OK_MS, haErrorText } from './haParts.js'

// useHaAction(run) - one press of a Home Assistant button or picker, from the
// moment it goes to the moment its answer has been shown
// (docs/designs/panels-and-controls.md, chunk 5).
//
//   run   (actionId, { data }) -> Promise<{ ok, status, error }>: the store's
//         runHaAction on a screen, demo.js's demoHaAction under ?demo=1 (it
//         only animates), null in the layout editor (nothing fires)
//
// -> { phase: 'idle' | 'pending' | 'ok' | 'error', key, error, fire }
//   fire(actionId, data?, key?) sends it (not while one is pending) and
//   resolves the result, or null when it did not go. key says which part
//   was pressed (the picker's option). 'ok' shows for OK_MS, 'error' (with
//   its words, panels/haParts.js haErrorText) for ERROR_MS, then 'idle'.

const IDLE = Object.freeze({ phase: 'idle', key: null, error: null })

export default function useHaAction(run) {
  const [state, setState] = useState(IDLE)
  const busy = useRef(false)
  const timer = useRef(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(timer.current)
    }
  }, [])

  function show(next, ms) {
    clearTimeout(timer.current)
    setState(next)
    timer.current = setTimeout(() => {
      if (alive.current) setState(IDLE)
    }, ms)
  }

  function fire(actionId, data, key) {
    if (typeof run !== 'function' || !actionId || busy.current) return Promise.resolve(null)
    busy.current = true
    clearTimeout(timer.current)
    const k = key == null ? null : key
    setState({ phase: 'pending', key: k, error: null })
    return Promise.resolve()
      .then(() => run(actionId, data ? { data } : undefined))
      .catch(() => ({ ok: false, status: 0, error: 'failed' }))
      .then((r) => {
        busy.current = false
        const result = r && typeof r === 'object' ? r : { ok: false, status: 0, error: 'no answer' }
        if (alive.current) {
          if (result.ok) show({ phase: 'ok', key: k, error: null }, OK_MS)
          else show({ phase: 'error', key: k, error: haErrorText(result) }, ERROR_MS)
        }
        return result
      })
  }

  return { phase: state.phase, key: state.key, error: state.error, fire }
}
