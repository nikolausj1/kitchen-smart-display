// countdowns.mjs - the Entry board's countdown tiles, from hand-marked events.
//
// A countdown is never picked automatically (decided 2026-09-24): someone
// writes a marker in the Google Calendar event's description:
//
//   countdown                 count down from 30 days out (shared.calendar
//                             .countdownLeadDays)
//   countdown 14              from 14 days out; also `countdown = 14 days`,
//                             `countdown: 2 weeks`, `countdown 1 month`
//   label: Minnesota!         the tile's title instead of the event's
//   image: airplane           this Countdown Art image by name; case, the
//                             extension and trailing digits do not matter
//                             (`image: mark_kim5.png` finds mark_kim);
//                             `image: none` = no art, show the title's emoji
//   color: blue               the tile's colour (the art-above tiles,
//                             docs/designs/panels-and-controls.md): #rgb,
//                             #rrggbb or a TILE_COLORS name; `colour:` too.
//                             Anything else is ignored, as if it were not
//                             there, and the tile takes its colour from the
//                             art, else the calendar
//
// Case-insensitive, anywhere in the description. label/image/color take the
// rest of their line, so give each its own line (a pair on one line is split
// at the second keyword). Google stores descriptions edited on the web as
// HTML (<br>, <p>, &amp;), which is read as the text it displays.
//
// Art (lib/countdownArt.mjs mirrors the "Countdown Art" Immich album): an
// explicit `image:` wins; otherwise the entry with the LONGEST keyword that
// appears as a whole word in the event title (or the label), ties to the
// first entry in the index; otherwise none, and the tile shows the title's
// emoji, or a calendar glyph.
//
// Pure ESM, no IO. Local dates throughout (the hub runs in the house
// timezone), via countdown.mjs's dateKey.

import { dateKey } from './countdown.mjs'

const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// --- descriptions --------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&#(\d{1,7});/g, (m, n) => safeCodePoint(Number(n), m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n) => safeCodePoint(parseInt(n, 16), m))
    .replace(/&amp;/gi, '&') // last, so "&amp;lt;" stays "&lt;"
}

function safeCodePoint(n, fallback) {
  try {
    return String.fromCodePoint(n)
  } catch {
    return fallback
  }
}

// A description as the text Google Calendar displays: line-breaking tags
// become newlines, other tags go, entities decode.
export function descriptionText(description) {
  if (typeof description !== 'string' || !description) return ''
  return decodeEntities(
    description
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote)(?:\s[^>]*)?>/gi, '\n')
      .replace(/<\/?[a-z][^>]*>/gi, ''),
  )
}

// --- the marker ------------------------------------------------------------------

const COUNTDOWN_RE =
  /(?<![\p{L}\p{N}_])countdown(?![\p{L}_])(?:[ \t]*[:=]?[ \t]*(\d{1,3})(?:[ \t]*(days?|d|weeks?|wks?|w|months?|mo)(?!\p{L}))?)?/iu
const DIRECTIVE_RE = /(?<![\p{L}\p{N}_])(label|image|colou?r)[ \t]*[:=][ \t]*/giu
const LABEL_MAX = 80

function unitDays(unit) {
  const u = (unit || 'd').toLowerCase()
  if (u.startsWith('w')) return 7
  if (u.startsWith('mo')) return 30
  return 1
}

// --- tile colours ----------------------------------------------------------------

// The names `color:` knows, each a mid-tone that white text reads on (WCAG
// contrast 3.25 to 4.96 against white, the large-text bar): the art-above
// tile draws its title and number in white on this colour and on the darker
// shade the gradient runs to. 'grey' is read as gray.
export const TILE_COLORS = Object.freeze({
  red: '#d9453d',
  orange: '#e06a1b',
  yellow: '#b8860b',
  green: '#2f9e44',
  teal: '#0d9488',
  blue: '#2f7fe8',
  indigo: '#5b61e0',
  purple: '#8e4ed8',
  pink: '#db4a8a',
  brown: '#9a6a45',
  gray: '#6b7280',
})

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// A `color:` value as '#rrggbb' (lowercase), or null when it is not one:
// '#rgb' and '#rrggbb' in any case, or a TILE_COLORS name in any case.
// Wrapping quotes and a closing full stop are forgiven ("color: Blue.").
export function tileColor(value) {
  if (typeof value !== 'string') return null
  const s = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\.$/, '')
    .trim()
    .toLowerCase()
  if (HEX_COLOR_RE.test(s)) {
    return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s
  }
  const name = s === 'grey' ? 'gray' : s
  return Object.hasOwn(TILE_COLORS, name) ? TILE_COLORS[name] : null
}

// { label, image, color } from `label: ...` / `image: ...` / `color: ...`
// directives, the first of each; for color the first that is a colour (an
// unknown one is skipped, as if it were not there). `colour:` is `color:`.
function directives(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const hits = [...line.matchAll(DIRECTIVE_RE)]
    hits.forEach((m, i) => {
      const from = m.index + m[0].length
      const to = i + 1 < hits.length ? hits[i + 1].index : line.length
      const value = line.slice(from, to).trim().replace(/[\s,;|]+$/, '')
      const word = m[1].toLowerCase()
      const key = word === 'colour' ? 'color' : word
      if (!value || out[key] !== undefined) return
      if (key === 'color') {
        const c = tileColor(value)
        if (c) out.color = c
        return
      }
      out[key] = value
    })
  }
  return out
}

// The countdown marker in an event description, or null when there is none.
//   -> { leadDays, label: string|null, image: string|null,
//        color: '#rrggbb'|null }
export function parseCountdownMarker(description, { defaultLeadDays = 30 } = {}) {
  const text = descriptionText(description)
  if (!text) return null
  const m = COUNTDOWN_RE.exec(text)
  if (!m) return null
  const lead = m[1] != null ? Number(m[1]) * unitDays(m[2]) : Number(defaultLeadDays)
  const d = directives(text)
  return {
    leadDays: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : 30,
    label: d.label ? d.label.slice(0, LABEL_MAX).trim() : null,
    image: d.image || null,
    color: d.color || null,
  }
}

// --- emoji -----------------------------------------------------------------------

// One emoji: a flag (two regional indicators), or a pictograph with its
// optional VS16, skin tone, tag sequence (subdivision flags) and ZWJ joins.
// Digits, '#' and '*' are not Extended_Pictographic, so keycaps never match.
const EMOJI_SRC =
  String.raw`\p{RI}\p{RI}|\p{Extended_Pictographic}\uFE0F?\p{EMod}?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?` +
  String.raw`(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{EMod}?)*`
const emojiRe = () => new RegExp(EMOJI_SRC, 'gu')
// Pictographic by Unicode, but ordinary text in a title ("Disney(TM) trip")
// unless explicitly given emoji presentation.
const TEXT_SYMBOLS = new Set(['\u00A9', '\u00AE', '\u2122'])

function isTextSymbol(seq) {
  const first = String.fromCodePoint(seq.codePointAt(0))
  return TEXT_SYMBOLS.has(first) && !seq.includes('\uFE0F')
}

// The first emoji in a title, or null. A lone pictograph whose default
// presentation is text (the airplane sign typed without VS16) gets a VS16, so a screen
// draws it as an emoji rather than a monochrome glyph.
export function titleEmoji(title) {
  if (typeof title !== 'string' || !title) return null
  for (const m of title.matchAll(emojiRe())) {
    const seq = m[0]
    if (isTextSymbol(seq)) continue
    const single = [...seq].length === 1
    if (single && !/\p{Emoji_Presentation}/u.test(seq)) return seq + '\uFE0F'
    return seq
  }
  return null
}

// A title without its emoji (the tile shows the emoji as the icon), or the
// title itself when nothing would be left.
export function stripEmoji(title) {
  if (typeof title !== 'string') return ''
  const out = title
    .replace(emojiRe(), (seq) => (isTextSymbol(seq) ? seq : ' '))
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-\u2013:|\u00B7\u2022\s]+|[-\u2013:|\u00B7\u2022\s]+$/g, '')
    .trim()
  return out || title.trim()
}

// --- art matching ----------------------------------------------------------------

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|heic|heif|svg)$/i

// A Countdown Art name, as the index stores it and as `image:` is compared:
// lowercased, trimmed, unquoted, single-spaced, without an image extension or
// trailing digits (and the separator before them): "Mark_Kim5.png" ->
// "mark_kim", "pumpkin1" -> "pumpkin". A name that is all digits stays as is.
export function artName(name) {
  const base = String(name ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(IMAGE_EXT_RE, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return base.replace(/\d+$/, '').replace(/[\s_-]+$/, '') || base
}

// Names compare with _, - and spaces alike: `image: mark kim` finds mark_kim.
const nameKey = (name) => artName(name).replace(/[\s_-]+/g, ' ')

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hasWholeWord(text, word) {
  if (!word) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'u').test(text)
}

// The art entry for a countdown, or null. artIndex entries are
// countdown-art/index.json's { id, file, name, keywords }.
export function matchArt(event, marker, artIndex) {
  const list = Array.isArray(artIndex) ? artIndex.filter(isDict) : []
  const want = marker?.image ? nameKey(marker.image) : null
  if (want === 'none') return null
  if (!list.length) return null
  if (want) {
    const hit = list.find((a) => nameKey(a.name) === want)
    if (hit) return hit
    // An unknown name (a typo, art not synced yet) falls through to keywords.
  }
  const text = `${event?.title ?? ''} ${marker?.label ?? ''}`.toLowerCase().replace(/\s+/g, ' ')
  let best = null
  let bestLen = 0
  for (const a of list) {
    for (const kw of Array.isArray(a.keywords) ? a.keywords : []) {
      const k = String(kw).toLowerCase().trim()
      if (k.length > bestLen && hasWholeWord(text, k)) {
        best = a
        bestLen = k.length
      }
    }
  }
  return best
}

// --- the tiles -------------------------------------------------------------------

// Whole local days from one 'YYYY-MM-DD' to another (DST-proof: UTC dates).
export function daysBetween(fromKey, toKey) {
  const [y1, m1, d1] = fromKey.split('-').map(Number)
  const [y2, m2, d2] = toKey.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

// The local date an event counts down to: its start (a multi-day event counts
// to its first day).
function eventDate(e) {
  if (typeof e.startDate === 'string' && DATE_KEY_RE.test(e.startDate)) return e.startDate
  const d = typeof e.start === 'string' ? new Date(e.start) : null
  return d && !Number.isNaN(d.getTime()) ? dateKey(d) : null
}

const defaultArtUrl = (entry) => `/countdown-art/${encodeURIComponent(entry.file)}`

function count(v, fallback) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

// Normalized calendar events -> the countdown tiles:
//   [{ id, title, date, daysLeft, leadDays, image, emoji, calendarLabel, color,
//      tileColor }]
// `color` is the event's calendar colour (the tiles' edge, the dashboard's
// dot); `tileColor` the marker's `color:`, '#rrggbb' or null (the art-above
// tile's own colour, over the art's and the calendar's).
// Only marked events with 0 <= daysLeft <= leadDays, by date then title, at
// most `max`. A recurring series shows only its next instance.
export function buildCountdowns(
  events,
  { now = new Date(), artIndex = [], defaultLeadDays = 30, max = 3, artUrl = defaultArtUrl } = {},
) {
  const today = dateKey(now)
  const cap = count(max, 3)
  const lead = count(defaultLeadDays, 30)
  const candidates = []
  for (const e of Array.isArray(events) ? events : []) {
    if (!isDict(e) || e.status === 'cancelled') continue
    const marker = parseCountdownMarker(e.description, { defaultLeadDays: lead })
    if (!marker) continue
    const date = eventDate(e)
    if (!date) continue
    const daysLeft = daysBetween(today, date)
    if (daysLeft < 0 || daysLeft > marker.leadDays) continue
    const shown = marker.label || String(e.title ?? '')
    candidates.push({ e, marker, date, daysLeft, title: stripEmoji(shown) })
  }
  candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)))

  const out = []
  const seenIds = new Set()
  const seenSeries = new Set()
  for (const c of candidates) {
    if (out.length >= cap) break
    const { e, marker } = c
    if (e.id != null) {
      if (seenIds.has(e.id)) continue
      seenIds.add(e.id)
    }
    if (e.recurringEventId) {
      if (seenSeries.has(e.recurringEventId)) continue
      seenSeries.add(e.recurringEventId)
    }
    const art = matchArt(e, marker, artIndex)
    out.push({
      id: e.id ?? null,
      title: c.title,
      date: c.date,
      daysLeft: c.daysLeft,
      leadDays: marker.leadDays,
      image: art?.file ? artUrl(art) : null,
      emoji: titleEmoji(marker.label) || titleEmoji(e.title),
      calendarLabel: e.calendarLabel ?? null,
      color: e.color ?? null,
      tileColor: marker.color,
    })
  }
  return out
}
