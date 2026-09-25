import { useEffect, useRef, useState } from 'react'
import { fetchPlexPerson, holdPlexActivity, notePlexActivity, plexImageUrl } from '../../hooks/usePlexNow.js'
import { Headshot, PlexIcon, Poster } from './PlexParts.jsx'
import { cleanRole, cleanShowTitle, fmtDate, sameWork, yearsOld } from './plexFormat.js'

// PersonCard - who someone in the cast is, full screen over the Plex view.
//
// Opened by tapping a cast card. The headshot, big, on the left (TMDB's large
// profile when the hub has it, over the cast thumb it already showed); on the
// right the name, who they play here, when and where they were born (and
// died), then two rows that scroll sideways: TMDB's "Known for" (their
// most-voted films and series; a badge on the ones in the Plex library) and
// "In your Plex library" (the rest of theirs Plex has, from Plex itself,
// without the ones Known for already shows). No biography. The right column
// scrolls up when a larger text size needs it.
//
// Closes on the close button, a tap outside the content, or 60 s after the
// last touch inside it. While it is open the shell's follow logic counts it as
// someone using the view (usePlexNow.js holdPlexActivity), so the view is not
// taken down under it. Lives inside the view, not the shell, and every surface
// is marked data-interactive, so the shell's rule (a tap on a dead area
// summons the menu) never fires through it.

const CLOSE_AFTER_MS = 60 * 1000

// Taps on the content do not close the card.
const keep = (e) => e.stopPropagation()

function Shelf({ label, items }) {
  if (!items.length) return null
  return (
    <section className="pv-shelf" onClick={keep}>
      <div className="pv-shelf__label">{label}</div>
      <div className="pv-shelf__row">
        {items.map((it) => (
          <div className="pv-shelf__item" key={it.key}>
            <div className="pv-shelf__art">
              <Poster src={it.poster} title={it.title} className="pv-shelf__poster" />
              {it.inLibrary && <span className="pv-shelf__badge">In your library</span>}
            </div>
            <div className="pv-shelf__title">{it.title}</div>
            {it.year ? <div className="pv-shelf__year">{it.year}</div> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function PersonCard({ person, media, nowMs, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const lastTouchRef = useRef(0)

  useEffect(() => {
    let live = true
    fetchPlexPerson({
      tmdbId: person.tmdbPersonId,
      name: person.name,
      exclude: [media.ratingKey, media.showRatingKey],
    })
      .then((data) => {
        if (live) setState({ loading: false, data, error: null })
      })
      .catch((e) => {
        if (live) setState({ loading: false, data: null, error: String((e && e.message) || e) })
      })
    return () => {
      live = false
    }
  }, [person.tmdbPersonId, person.name, media.ratingKey, media.showRatingKey])

  // Open = someone using the view. Left alone for a minute, it closes.
  useEffect(() => {
    const release = holdPlexActivity()
    lastTouchRef.current = Date.now()
    const id = setInterval(() => {
      if (Date.now() - lastTouchRef.current >= CLOSE_AFTER_MS) onClose()
    }, 1000)
    return () => {
      clearInterval(id)
      release()
    }
  }, [onClose])

  function touched() {
    lastTouchRef.current = Date.now()
    notePlexActivity()
  }

  const data = state.data
  // TMDB's list without the thing on screen (it is usually their newest).
  const here = media.type === 'episode' ? media.showGuids?.tmdb : media.guids?.tmdb
  const hereType = media.type === 'episode' ? 'tv' : 'movie'
  const knownFor = (Array.isArray(data?.knownFor) ? data.knownFor : [])
    .filter((k) => k && k.title && !(here && String(k.tmdbId) === String(here) && k.mediaType === hereType))
    .map((k) => ({
      key: `${k.mediaType}:${k.tmdbId}`,
      title: k.title,
      year: k.year,
      poster: plexImageUrl(k.poster),
      inLibrary: k.inLibrary === true,
    }))
  // Plex's own list, less what Known for already shows (same title, year
  // within one).
  const inLibrary = (Array.isArray(data?.inLibrary) ? data.inLibrary : [])
    .filter((k) => k && k.title && !knownFor.some((s) => sameWork(s, k)))
    .map((k) => ({
      key: `plex:${k.ratingKey}`,
      title: k.title,
      year: k.year,
      poster: plexImageUrl(k.poster),
      inLibrary: false,
    }))

  const where = media.type === 'episode' ? cleanShowTitle(media.show) : media.title
  const role = cleanRole(person.role, person.name)
  const born = fmtDate(data?.birthday)
  const died = fmtDate(data?.deathday)
  // The age at death from the two dates; alive, the hub's age (its clock),
  // else worked out here.
  const age = died
    ? yearsOld(data.birthday, data.deathday)
    : Number.isFinite(data?.age)
      ? data.age
      : yearsOld(data?.birthday, null, nowMs)
  const place = data?.placeOfBirth || null
  let bornLine = null
  if (born) bornLine = `Born ${born}${place ? ` in ${place}` : ''}${!died && age != null ? ` · ${age}` : ''}`
  else if (place) bornLine = `Born in ${place}`
  const diedLine = died ? `Died ${died}${age != null ? ` · aged ${age}` : ''}` : null

  let note = null
  if (state.loading) note = 'Looking them up…'
  else if (state.error) note = `Could not look them up (${state.error}).`
  else if (!knownFor.length && !inLibrary.length) note = 'Nothing else of theirs in the library.'

  return (
    <div
      className="pv-person"
      data-interactive="true"
      role="dialog"
      aria-modal="true"
      aria-label={person.name}
      onPointerDown={touched}
      onScrollCapture={touched}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="pv-person__photo" onClick={keep}>
        <Headshot
          src={plexImageUrl(person.thumb, 300, 450)}
          over={data?.profileLarge || data?.profile || null}
          name={person.name}
        />
      </div>

      <div className="pv-person__body">
        <div className="pv-person__who" onClick={keep}>
          <h2 className="pv-person__name">{person.name}</h2>
          <div className="pv-person__role">
            {role && <span className="pv-person__char">{role}</span>}
            {role ? ' in ' : 'In '}
            {where}
          </div>
          {bornLine && <div className="pv-person__fact">{bornLine}</div>}
          {diedLine && <div className="pv-person__fact">{diedLine}</div>}
        </div>

        <Shelf label="Known for" items={knownFor} />
        <Shelf label="In your Plex library" items={inLibrary} />
        {note && (
          <div className="pv-person__note" onClick={keep}>
            {note}
          </div>
        )}
      </div>

      <button
        type="button"
        className="pv-person__close"
        aria-label="Close"
        data-interactive="true"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <PlexIcon name="close" />
      </button>
    </div>
  )
}
