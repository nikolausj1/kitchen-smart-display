import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { notePlexActivity, plexImageUrl } from '../../hooks/usePlexNow.js'
import { Headshot } from './PlexParts.jsx'
import { cleanRole } from './plexFormat.js'

// CastBoard - everyone credited, as portrait cards, under the Plex view's strip.
//
// Six columns at 1280x800 and text size 100% (the columns are a minimum width,
// so a bigger text size gets fewer and a smaller one more), two rows in view
// with the tops of the third peeking under a fade, and a pill saying how many
// more there are until the first scroll. The grid scrolls by touch, with the
// scrollbar hidden; the parent keys it by item, so a new item starts at the
// top. An episode's guest stars carry a Guest tag; the series regulars who are
// not in this episode follow under a "Series regulars" divider. A tap on a
// card opens that person's card (onOpen). Every tap and scroll here counts as
// activity for the shell's follow logic (usePlexNow.js notePlexActivity).
// Memoised: the view re-renders every second for its clock, the board only
// when its cast changes (usePlexNow keeps an unchanged cast's identity).

function CastCard({ person, onOpen }) {
  const role = cleanRole(person.role, person.name)
  return (
    <button
      type="button"
      className="pv-card"
      data-interactive="true"
      aria-label={role ? `${person.name}, ${role}` : person.name}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(person)
      }}
    >
      <span className="pv-card__img">
        <Headshot src={plexImageUrl(person.thumb, 300, 450)} name={person.name} />
        {person.guest === true && <span className="pv-card__tag">Guest</span>}
      </span>
      <span className="pv-card__name">{person.name}</span>
      {role && <span className="pv-card__role">{role}</span>}
    </button>
  )
}

function CastBoard({ cast, castTotal, onOpen }) {
  const scrollRef = useRef(null)
  // Cards not wholly in view at the top (the pill's count), whether the board
  // has been scrolled (the pill goes for good), and whether it is at its end
  // (the fade goes, so the last row reads).
  const [below, setBelow] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [atEnd, setAtEnd] = useState(true)

  // Measured after layout and again whenever the board or its grid changes
  // size (a text size change, Inter arriving and rewrapping the names).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    function measure() {
      const h = el.clientHeight
      let hidden = 0
      const cards = el.querySelectorAll('.pv-card')
      for (let i = 0; i < cards.length; i += 1) {
        if (cards[i].offsetTop + cards[i].offsetHeight > h + 1) hidden += 1
      }
      setBelow(hidden)
      setAtEnd(el.scrollTop + h >= el.scrollHeight - 2)
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      if (el.firstElementChild) ro.observe(el.firstElementChild)
      return () => ro.disconnect()
    }
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  }, [cast])

  function onScroll() {
    notePlexActivity()
    const el = scrollRef.current
    if (!el) return
    if (!scrolled && el.scrollTop > 8) setScrolled(true)
    const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    if (end !== atEnd) setAtEnd(end)
  }

  // The pill scrolls on by most of a screen.
  function showMore(e) {
    e.stopPropagation()
    const el = scrollRef.current
    if (!el) return
    const by = Math.round(el.clientHeight * 0.8)
    if (typeof el.scrollBy === 'function') el.scrollBy({ top: by, behavior: 'smooth' })
    else el.scrollTop += by
  }

  const firstRegular = cast.findIndex((c) => c.regular === true)
  const total = Number.isFinite(Number(castTotal)) && Number(castTotal) > cast.length ? Number(castTotal) : cast.length
  const pill =
    !scrolled && below > 0
      ? `${below} more${total > cast.length ? ` · ${cast.length} of ${total} shown` : ''}`
      : null

  return (
    <section className="pv-cast" aria-label="Cast">
      <div className="pv-cast__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="pv-cast__grid">
          {cast.map((c, i) => (
            <Fragment key={`${c.tmdbPersonId ?? c.plexId ?? c.name}:${i}`}>
              {i === firstRegular && <div className="pv-cast__divider">Series regulars</div>}
              <CastCard person={c} onOpen={onOpen} />
            </Fragment>
          ))}
        </div>
      </div>
      {!atEnd && <div className="pv-cast__fade" aria-hidden="true" />}
      {pill && (
        <button type="button" className="pv-cast__more" data-interactive="true" onClick={showMore}>
          {pill}
        </button>
      )}
    </section>
  )
}

export default memo(CastBoard)
