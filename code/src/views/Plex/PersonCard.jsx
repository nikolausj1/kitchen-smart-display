import { useEffect, useState } from 'react'
import { fetchPlexPerson, plexImageUrl } from '../../hooks/usePlexNow.js'
import { Face, PlexIcon, Poster } from './PlexParts.jsx'
import { cleanShowTitle, fmtDate } from './plexFormat.js'

// PersonCard - who someone in the cast is, over the Plex view.
//
// Opened by tapping a headshot. Shows the name, the picture, who they play
// here, TMDB's "Known for" (their most-voted films and series, when the hub
// has a TMDB key) and "In your Plex library" (everything else of theirs in
// the library, from Plex itself). Closes on a tap outside the card, on the
// close button, or after 45 s left alone (a touch inside restarts the wait).
//
// Lives inside the view, not the shell, and every surface is marked
// data-interactive, so the shell's rule (a tap on a dead area summons the
// menu) never fires through it.

const CLOSE_AFTER_MS = 45 * 1000
const SHELF_MAX = 8

function Shelf({ label, items }) {
  if (!items.length) return null
  return (
    <section className="pv-shelf">
      <div className="pv-shelf__label">{label}</div>
      <div className="pv-shelf__row">
        {items.slice(0, SHELF_MAX).map((it) => (
          <div className="pv-shelf__item" key={it.key}>
            <Poster src={it.poster} title={it.title} className="pv-shelf__poster" />
            <div className="pv-shelf__title">{it.title}</div>
            <div className="pv-shelf__meta">
              {it.year || ''}
              <span className="pv-shelf__kind">{it.kind}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function PersonCard({ person, media, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [touchedAt, setTouchedAt] = useState(0)

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

  // Left alone, the card goes after 45 s; a touch inside restarts the wait.
  useEffect(() => {
    const id = setTimeout(onClose, CLOSE_AFTER_MS)
    return () => clearTimeout(id)
  }, [touchedAt, onClose])

  const data = state.data
  // TMDB's list without the thing on screen (it is usually their newest).
  const here = media.type === 'episode' ? media.showGuids?.tmdb : media.guids?.tmdb
  const hereType = media.type === 'episode' ? 'tv' : 'movie'
  const knownFor = (data?.knownFor || [])
    .filter((k) => !(here && String(k.tmdbId) === String(here) && k.mediaType === hereType))
    .map((k) => ({
      key: `${k.mediaType}:${k.tmdbId}`,
      title: k.title,
      year: k.year,
      poster: k.poster,
      kind: k.mediaType === 'tv' ? 'TV' : 'Movie',
    }))
  const inLibrary = (data?.inLibrary || []).map((k) => ({
    key: `plex:${k.ratingKey}`,
    title: k.title,
    year: k.year,
    poster: plexImageUrl(k.poster),
    kind: k.type === 'show' ? 'TV' : 'Movie',
  }))
  const where = media.type === 'episode' ? cleanShowTitle(media.show) : media.title
  const born = fmtDate(data?.birthday)
  const facts = [
    data?.knownForDepartment && data.knownForDepartment !== 'Acting' ? data.knownForDepartment : null,
    born ? `Born ${born}${data?.placeOfBirth ? ` in ${data.placeOfBirth}` : ''}` : null,
    data?.deathday ? `Died ${fmtDate(data.deathday)}` : null,
  ].filter(Boolean)

  let note = null
  if (state.loading) note = 'Looking them up…'
  else if (state.error) note = `Could not look them up (${state.error}).`
  else if (!knownFor.length && !inLibrary.length) {
    note = data?.tmdb && !data.tmdb.configured
      ? 'Nothing else of theirs in the library. (Known for needs a TMDB key on the hub.)'
      : 'Nothing else of theirs in the library.'
  }

  return (
    <div
      className="pv-person"
      data-interactive="true"
      role="dialog"
      aria-modal="true"
      aria-label={person.name}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div
        className="pv-person__card"
        data-interactive="true"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={() => setTouchedAt(Date.now())}
      >
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

        <div className="pv-person__head">
          <Face src={data?.profile || person.thumb} name={person.name} className="pv-person__face" />
          <div className="pv-person__who">
            <div className="pv-person__name">{person.name}</div>
            {person.role && (
              <div className="pv-person__role">
                {person.role}
                <span className="pv-person__in"> in {where}</span>
              </div>
            )}
            {facts.length > 0 && <div className="pv-person__facts">{facts.join(' · ')}</div>}
            {data?.biography && <p className="pv-person__bio">{data.biography}</p>}
          </div>
        </div>

        <Shelf label="Known for" items={knownFor} />
        <Shelf label="In your Plex library" items={inLibrary} />
        {note && <div className="pv-person__note">{note}</div>}
      </div>
    </div>
  )
}
