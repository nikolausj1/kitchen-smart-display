// catalog.js - what the Add block menu lists, and how (Layers.jsx,
// AddMenu.jsx). Every type the app knows, always: a type already on the
// layout is added again as a further instance (docs/designs/layout-editor.md,
// "Blocks"). Grouped in this order, each group under its header:
//
//   Clocks and dates, Weather, Calendar, Countdowns, Home, Media, Blocks
//
// then Other for any type the app knows that no group names (a newer app's).
// A group's types the app does not know are left out, so the Home group
// shows once the app ships its Home Assistant blocks.
//
// Each row: the type's label, a one-line description (the app's own when its
// type list gives one, else DESCRIPTIONS below) and a thumbnail, the app
// build's previews/<type>.png (resolved by the caller: hub.js appAsset),
// which AddMenu draws over a placeholder tile so a missing picture never
// shows as a broken image.
//
// A block other than text and image (the shape) is listed twice: in front of
// everything, and "behind selection" (just behind the selected blocks and
// over their area, a card behind a group; at the back when nothing is
// selected), the two ways Add shape offered before.
//
// Search (filterCatalog) matches the label, and the group's name, so
// "weather" or "calendar" lists a whole group.

import { hasOwnProps, isBlockType, registeredTypeDescription, registeredTypePreview } from './schema.js'
import { typeLabel } from './spec.js'

export const ADD_GROUPS = [
  { id: 'clocks', label: 'Clocks and dates', types: ['clock', 'flipclock', 'analog', 'clock2', 'date', 'daycount'] },
  {
    id: 'weather',
    label: 'Weather',
    types: ['weather', 'forecast', 'hourly', 'conditions', 'precip', 'alert', 'sunmoon', 'wear', 'airquality'],
  },
  { id: 'calendar', label: 'Calendar', types: ['agenda', 'upnext', 'daylist', 'weekgrid', 'monthgrid', 'headline'] },
  { id: 'countdowns', label: 'Countdowns', types: ['countdowns', 'countdown', 'departure'] },
  { id: 'home', label: 'Home', types: ['hastatus', 'habutton', 'hachips', 'hapicker', 'school'] },
  { id: 'media', label: 'Media', types: ['nowplaying', 'photo'] },
  { id: 'blocks', label: 'Blocks', types: ['text', 'image', 'shape'] },
]
export const OTHER_GROUP = { id: 'other', label: 'Other' }

// One short line each, what the block shows.
export const DESCRIPTIONS = {
  clock: 'The time, the date and a greeting',
  flipclock: 'Split-flap digits that flip over',
  analog: 'A clock face with hands',
  clock2: 'The time in another time zone',
  date: "Today's date, as big as the box",
  daycount: 'Week of the year, days left, school days',
  weather: 'Temperature and sky, right now',
  forecast: 'The next few days, a column each',
  hourly: 'The next hours: sky and temperature',
  conditions: 'Feels like, wind, humidity, UV',
  precip: 'Chance of rain, hour by hour',
  alert: 'A banner while an alert is on',
  sunmoon: 'Sunrise, sunset and the moon',
  wear: 'What to put on, in a sentence',
  airquality: 'Air quality number and colour',
  agenda: 'The calendar, a column per day',
  upnext: 'The next event, large, then more',
  daylist: "Today's or tomorrow's events",
  weekgrid: 'The week, a row per hour',
  monthgrid: 'The month at a glance',
  headline: 'One line: what to know now',
  countdowns: 'Tiles: art, title, days to go',
  countdown: 'One countdown, large',
  departure: 'The school-run countdown',
  hastatus: 'A device at a glance: door, garage',
  habutton: 'A button that runs a home action',
  hachips: 'House modes and people, as chips',
  hapicker: 'Pick an option, like the day part',
  school: 'Lunch and after-school activities',
  nowplaying: 'What the Sonos is playing',
  photo: 'The photo slideshow, in a tile',
  text: 'Your words: a name, a welcome, a note',
  image: 'Countdown Art or a picture from the web',
  shape: 'A card, a band of colour, a divider',
}

const BEHIND_WITH = 'Behind the selection, over its area'
const BEHIND_NONE = 'At the back (nothing is selected)'

// The thumbnail of a type, a path in the app build: the app's own when its
// type list gives one, else previews/<type>.png.
export const previewPath = (type) => registeredTypePreview(type) || `previews/${type}.png`

// The menu: [{ id, label, items: [{ key, type, where, label, description,
// preview, count }] }], groups with nothing in them left out.
//   known       the app's types, in its order (typeRegistry().known)
//   counts      { type: how many the part on show has }
//   labels      the app's names (the reducer's, from the ready)
//   hasSelection  for the "behind selection" rows' description
//   resolve     path -> URL for the thumbnails (hub.js appAsset)
export function buildCatalog({ known, counts = {}, labels, hasSelection = false, resolve = (p) => p }) {
  const types = [...(known || [])]
  const listed = new Set(ADD_GROUPS.flatMap((g) => g.types))
  const item = (type) => ({
    key: type,
    type,
    where: 'front',
    label: typeLabel(type, labels),
    description: registeredTypeDescription(type) || DESCRIPTIONS[type] || '',
    preview: resolve(previewPath(type)),
    count: counts[type] || 0,
  })
  const itemsOf = (list) => {
    const out = []
    for (const type of list) {
      out.push(item(type))
      // Any block but text and image: also behind the selection.
      if (isBlockType(type) && !hasOwnProps(type)) {
        out.push({
          ...item(type),
          key: `${type}:behind`,
          where: 'behind',
          label: `${typeLabel(type, labels)} behind selection`,
          description: hasSelection ? BEHIND_WITH : BEHIND_NONE,
        })
      }
    }
    return out
  }
  const groups = ADD_GROUPS.map((g) => ({ id: g.id, label: g.label, items: itemsOf(g.types.filter((t) => types.includes(t))) }))
  groups.push({ ...OTHER_GROUP, items: itemsOf(types.filter((t) => !listed.has(t))) })
  return groups.filter((g) => g.items.length)
}

// The groups whose name, or the rows whose label, match the query: every
// word of it somewhere in the text, case and accents ignored.
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function filterCatalog(groups, query) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return groups
  const hit = (text) => {
    const t = fold(text)
    return words.every((w) => t.includes(w))
  }
  const out = []
  for (const g of groups) {
    const items = hit(g.label) ? g.items : g.items.filter((it) => hit(it.label))
    if (items.length) out.push({ ...g, items })
  }
  return out
}
