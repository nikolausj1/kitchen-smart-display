// useAppBridge - the editor's end of the edit-mode message channel
// (docs/designs/layout-editor.md, Contract v1 "Messages" and Contract v2).
//
//   editor -> app   sd-edit:ping, sd-edit:sample,
//                   sd-edit:spec { spec, layoutId }  the draft, for that layout
//                   sd-edit:hover { id, element }   element: a data-edit key
//                                   inside that panel, or null for the box
//                   sd-edit:daypart { daypart }     'day' | 'morning' |
//                                   'evening' | 'weekend' forces the preview
//                                   to that part; null (on unmount) lets it
//                                   follow the clock again
//                   sd-edit:display (Entry only, see below)
//   app -> editor   sd-edit:ready, sd-edit:rects
//
// Pings on load and every second until the app answers ready (and gives up
// after 15 s, which the status line reports). On every ready (a reload, or the
// app noticing a new saved spec) the draft, the day part, the sample flag and
// the hover are sent again, so the app always renders what the editor shows.
// The draft goes out at most once per animation frame, however fast the
// pointer moves.
//
// sd-edit:display { display: { entryBackdrop, entryDim } } is the draft
// backdrop, so the preview can show it before Save. An app that does not know
// it ignores it.
//
// Incoming messages must come from the iframe's window and its origin, and a
// ready must be for the layout being edited.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isDict, normalizeCanvas } from './spec.js'

const PING_EVERY_MS = 1000
const GIVE_UP_MS = 15_000

export default function useAppBridge({ iframeRef, frame, frameKey, layoutId, spec, canvas, sample, hover, daypart, display, onReady, onRects }) {
  // Per iframe load (frameKey): whether the app has answered, how many readies
  // it has sent (each one resends the draft), and the viewport it reported.
  const [link, setLink] = useState({ key: -1, ready: false, seq: 0, appCanvas: null, gaveUp: false })
  const current = link.key === frameKey
  const ready = current && link.ready
  const gaveUp = current && link.gaveUp && !link.ready

  const callbacks = useRef({ onReady, onRects })
  useLayoutEffect(() => {
    callbacks.current = { onReady, onRects }
  })

  const post = useCallback(
    (msg) => {
      const win = iframeRef.current?.contentWindow
      if (win) win.postMessage(msg, frame.target)
    },
    [iframeRef, frame.target]
  )

  const ping = useCallback(() => post({ type: 'sd-edit:ping' }), [post])

  useEffect(() => {
    function onMessage(e) {
      const win = iframeRef.current?.contentWindow
      if (!win || e.source !== win || e.origin !== frame.origin) return
      const m = e.data
      if (!isDict(m) || typeof m.type !== 'string') return
      if (m.type === 'sd-edit:ready') {
        if (m.layoutId != null && m.layoutId !== layoutId) return
        setLink((l) => ({
          key: frameKey,
          ready: true,
          seq: (l.key === frameKey ? l.seq : 0) + 1,
          appCanvas: normalizeCanvas(m.canvas),
          gaveUp: false,
        }))
        callbacks.current.onReady?.(m)
      } else if (m.type === 'sd-edit:rects') {
        callbacks.current.onRects?.(m, frameKey)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef, frame.origin, frameKey, layoutId])

  // The handshake: ping until ready, or give up.
  useEffect(() => {
    if (ready) return undefined
    const started = performance.now()
    const timer = setInterval(() => {
      if (performance.now() - started > GIVE_UP_MS) {
        clearInterval(timer)
        setLink((l) =>
          l.key === frameKey && l.ready ? l : { key: frameKey, ready: false, seq: 0, appCanvas: null, gaveUp: true }
        )
        return
      }
      post({ type: 'sd-edit:ping' })
    }, PING_EVERY_MS)
    return () => clearInterval(timer)
  }, [ready, frameKey, post])

  // The draft, at most once per frame.
  const pending = useRef(null)
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  useEffect(() => {
    if (!ready || !spec) return
    pending.current = { type: 'sd-edit:spec', layoutId, spec: { ...spec, canvas: { w: canvas.w, h: canvas.h } } }
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const msg = pending.current
      pending.current = null
      if (msg) post(msg)
    })
  }, [ready, link.seq, spec, layoutId, canvas.w, canvas.h, post])

  useEffect(() => {
    if (ready) post({ type: 'sd-edit:sample', on: !!sample })
  }, [ready, link.seq, sample, post])

  const hoverId = hover?.id ?? null
  const hoverElement = hover?.element ?? null
  useEffect(() => {
    if (ready) post({ type: 'sd-edit:hover', id: hoverId, element: hoverId ? hoverElement : null })
  }, [ready, link.seq, hoverId, hoverElement, post])

  // The day part on show. Day is sent as 'day' (not null), so the preview
  // does not follow the clock while the editor is open.
  useEffect(() => {
    if (ready && daypart) post({ type: 'sd-edit:daypart', daypart })
  }, [ready, link.seq, daypart, post])
  const postRef = useRef(post)
  useLayoutEffect(() => {
    postRef.current = post
  })
  useEffect(() => () => postRef.current({ type: 'sd-edit:daypart', daypart: null }), [])

  useEffect(() => {
    if (ready && display) post({ type: 'sd-edit:display', display })
  }, [ready, link.seq, display, post])

  return { ready, gaveUp, appCanvas: ready ? link.appCanvas : null, ping }
}

// The panels the app marks as carrying a visibility rule (data-rule on the
// box, Contract chunk 1), read from the preview's own DOM: a Set of panel ids,
// or null when the preview is on another origin (development with ?app=) and
// cannot be read. The rects message's own `rule` flags win when it has them.
export function readRuleMarks(iframe) {
  try {
    const doc = iframe?.contentDocument
    if (!doc) return null
    const ids = new Set()
    doc.querySelectorAll('[data-panel-id][data-rule]').forEach((el) => {
      const v = el.getAttribute('data-rule')
      if (v !== '0' && v !== 'false') ids.add(el.getAttribute('data-panel-id'))
    })
    return ids
  } catch {
    return null
  }
}
