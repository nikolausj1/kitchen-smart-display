// weatherRules.mjs - the weather lines the Entry board's headline can say.
//
// weatherLinesFor({ now, forecast, alerts, units }) -> the candidate lines,
// best first:
//
//   [{ text, kind, rank, until, rule }]
//
//   text   "Rain from 3 pm", "Wind Advisory until 6 pm"
//   kind   'alert' (a National Weather Service alert, either tier) or
//          'weather' (a forecast rule)
//   rank   lower wins. Two tiers, so headline.mjs can interleave them with
//          its calendar rules:
//            tier A, rank < TIER_B_RANK: outranks everything, a running
//              event included;
//            tier B, rank >= TIER_B_RANK: outranks the next timed event
//              today, all-day, tomorrow and day-part lines, but not an event
//              that is running or starts within the hour.
//   until  ISO time at which the sentence would change on its own (a hint
//          for pollers, as in headline.mjs), or null
//   rule   'alert' | 'rain' | 'frost' | 'wind' | 'heat' | 'cold'
//
// The rules, in rank order (thresholds exported below; the tests pin every
// boundary):
//
//   Tier A
//     alert  NWS alerts that are Extreme or Severe, or any Warning. Several:
//            the most severe, then the earliest ending.
//   Tier B
//     alert  every other NWS alert (advisories, watches, statements): the
//            same words, the same order.
//     rain   the hours from now to 9 pm. Raining now (a precipitation code
//            this hour, or >= 70 %): "Raining now, clearing by 5 pm" when the
//            wet run ends before midnight, else "Rain most of the day".
//            Otherwise the first hour at >= 50 % (or with a precipitation
//            code): "Rain within the hour" inside 60 minutes, else "Rain from
//            3 pm". Snow codes say Snow ("Snowing now, ..."), freezing
//            drizzle and freezing rain say Freezing rain, and a bare
//            probability says Snow at 32 F or below. Nothing from 9 pm on.
//     frost  from noon to midnight, the lowest hourly temperature from now
//            until 9 am tomorrow: <= 34 F "Frost tonight", <= 20 F "Hard
//            freeze tonight".
//     wind   the next 12 hours, gusts >= 30 mph: "Windy morning", "Windy
//            afternoon" or "Windy tonight" by the hour the gusts peak
//            ("Windy tomorrow morning" when that is tomorrow's); "Very windy
//            ..." at >= 45 mph.
//     heat   before 2 pm, today's high >= 90 F: "Hot one today, high of 94".
//     cold   before 10 am, the feels-like this hour <= 15 F: "Bitter cold
//            this morning, feels like 3".
//
// Alert words: "<Event> until 6 pm" (ends today), "... until midnight"
// (tonight's), "... through Sat 6 am" (a later day), "... from 4 pm" or
// "... from Fri 4 am" while its onset is still ahead, "<Event>" alone when it
// has no end. One line per event name.
//
// Degrees are whole and rounded BEFORE any comparison (34.4 F is 34, so
// frost); times read "3 pm", "6:30 am".
//
// forecast: the hub's snapshot (lib/hubWeather.mjs getForecast()):
//   { fetchedAt, error, hourly: [...], daily: [...] }
//   hourly: [{ time, tempF, feelsF, precipProb, precipIn, code, gustMph,
//   windMph }], each the hour STARTING at `time` (local, no zone): tempF,
//   feelsF, windMph at `time`; precipProb, precipIn, code, gustMph over the
//   hour after it. daily: [{ date: 'YYYY-MM-DD', highF, lowF, precipProbMax,
//   code, sunrise, sunset }].
// alerts: lib/nwsAlerts.mjs's normalised list, or its snapshot { alerts }.
// units: 'imperial' (the default: the app has no units setting and shows F
//   and mph) or 'metric', which changes only the degrees a line quotes; the
//   thresholds stay in F and mph.
//
// Pure ESM, local time, no imports: headline.mjs runs it on the hub, and it
// would run as is in a browser.

// --- thresholds ------------------------------------------------------------------

export const RAIN_PROB = 50 // %: an hour this likely is a wet hour
export const RAINING_NOW_PROB = 70 // %: this hour this likely is "raining now"
export const RAIN_SOON_MINUTES = 60 // "within the hour"
export const RAIN_UNTIL_HOUR = 21 // 9 pm: no rain line from then, none about later
export const SNOW_MAX_F = 32 // a bare probability at or below this says Snow
export const FROST_F = 34
export const HARD_FREEZE_F = 20
export const FROST_FROM_HOUR = 12 // noon
export const FROST_UNTIL_HOUR = 9 // 9 am tomorrow
export const WIND_GUST_MPH = 30
export const VERY_WINDY_GUST_MPH = 45
export const WIND_HOURS = 12
export const HOT_F = 90
export const HOT_BEFORE_HOUR = 14 // 2 pm
export const BITTER_FEELS_F = 15
export const BITTER_BEFORE_HOUR = 10 // 10 am

// --- ranks -----------------------------------------------------------------------

// Tier A is below TIER_B_RANK. An alert's rank adds its severity's index, so a
// Moderate warning (a Gale Warning) sorts after a Severe one.
export const TIER_B_RANK = 200
export const RANK = Object.freeze({
  ALERT: 100,
  ADVISORY: 200,
  RAIN: 210,
  FROST: 220,
  WIND: 230,
  HEAT: 240,
  COLD: 250,
})

export const SEVERITIES = Object.freeze(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'])

// --- WMO weather codes (Open-Meteo) ------------------------------------------------

const DRIZZLE = [51, 53, 55]
const FREEZING = [56, 57, 66, 67] // freezing drizzle, freezing rain
const RAIN = [61, 63, 65, 80, 81, 82, 95, 96, 99] // rain, showers, thunderstorms
const SNOW = [71, 73, 75, 77, 85, 86] // snow, snow grains, snow showers
export const SNOW_CODES = new Set(SNOW)
export const FREEZING_CODES = new Set(FREEZING)
export const PRECIP_CODES = new Set([...DRIZZLE, ...FREEZING, ...RAIN, ...SNOW])

// --- helpers -----------------------------------------------------------------------

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Whole degrees (or mph), the unit every comparison and every sentence uses.
function whole(v) {
  const n = num(v)
  return n == null ? null : Math.round(n) + 0 // + 0: never "-0"
}

function parseTime(v) {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v) // an offset-less date-time is local, which is what Open-Meteo sends
  return Number.isNaN(d.getTime()) ? null : d
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Local `hour`:00 on the day of `base`, `days` later.
function atHour(base, hour, days = 0) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, 0, 0, 0)
}

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

// "3 pm", "6:30 am", "12 pm" (noon).
export function clock(d) {
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

function degrees(f, units) {
  const n = units === 'metric' ? ((f - 32) * 5) / 9 : f
  return Math.round(n) + 0
}

function line(rule, rank, text, untilMs) {
  return {
    text,
    kind: rule === 'alert' ? 'alert' : 'weather',
    rank,
    until: untilMs == null ? null : new Date(untilMs).toISOString(),
    rule,
  }
}

// The forecast's hours as { at, ms, ... }, in time order, without a repeated
// stamp (a DST fall-back repeats one local hour).
function hoursOf(forecast) {
  const list = Array.isArray(forecast?.hourly) ? forecast.hourly : []
  const out = []
  for (const h of list) {
    const at = parseTime(h?.time)
    if (!at) continue
    out.push({
      at,
      ms: at.getTime(),
      tempF: num(h.tempF),
      feelsF: num(h.feelsF),
      precipProb: num(h.precipProb),
      code: num(h.code),
      gustMph: num(h.gustMph),
    })
  }
  out.sort((a, b) => a.ms - b.ms)
  return out.filter((h, i) => i === 0 || h.ms !== out[i - 1].ms)
}

// Hours not yet over at `nowMs`: the current one and everything after it.
const notOver = (h, nowMs) => h.ms + HOUR_MS > nowMs

// --- the forecast rules ------------------------------------------------------------

const WORDS = {
  rain: { noun: 'Rain', now: 'Raining now' },
  snow: { noun: 'Snow', now: 'Snowing now' },
  freezing: { noun: 'Freezing rain', now: 'Freezing rain now' },
}

function precipWords(h) {
  if (SNOW_CODES.has(h.code)) return WORDS.snow
  if (FREEZING_CODES.has(h.code)) return WORDS.freezing
  if (PRECIP_CODES.has(h.code)) return WORDS.rain
  const t = whole(h.tempF)
  return t != null && t <= SNOW_MAX_F ? WORDS.snow : WORDS.rain
}

const isWet = (h) => PRECIP_CODES.has(h.code) || (h.precipProb ?? 0) >= RAIN_PROB
const isWetNow = (h) => PRECIP_CODES.has(h.code) || (h.precipProb ?? 0) >= RAINING_NOW_PROB

// Rain (or snow) between now and 9 pm.
export function rainLine(now, hours) {
  const nowMs = now.getTime()
  const stopMs = atHour(now, RAIN_UNTIL_HOUR).getTime()
  if (nowMs >= stopMs) return null
  const ahead = hours.filter((h) => notOver(h, nowMs) && h.ms < stopMs)
  if (!ahead.length) return null
  const current = ahead[0].ms <= nowMs ? ahead[0] : null

  if (current && isWetNow(current)) {
    const words = precipWords(current)
    const midnightMs = atHour(now, 0, 1).getTime()
    const later = hours.filter((h) => h.ms > current.ms)
    const dry = later.find((h) => !isWet(h))
    if (dry && dry.ms < midnightMs) {
      return line('rain', RANK.RAIN, `${words.now}, clearing by ${clock(dry.at)}`, dry.ms)
    }
    const last = later.length ? later[later.length - 1] : current
    if (dry || last.ms + HOUR_MS >= midnightMs) {
      return line('rain', RANK.RAIN, `${words.noun} most of the day`, stopMs)
    }
    // The forecast ends before the rain does: say only what is known.
    return line('rain', RANK.RAIN, words.now, last.ms + HOUR_MS)
  }

  const first = ahead.find(isWet)
  if (!first) return null
  const words = precipWords(first)
  const minutes = Math.ceil((first.ms - nowMs) / MINUTE_MS)
  if (minutes <= RAIN_SOON_MINUTES) {
    // This very hour (likely, not yet certain), or the next inside 60 min.
    return line('rain', RANK.RAIN, `${words.noun} within the hour`, first.ms > nowMs ? first.ms : first.ms + HOUR_MS)
  }
  return line('rain', RANK.RAIN, `${words.noun} from ${clock(first.at)}`, first.ms - RAIN_SOON_MINUTES * MINUTE_MS)
}

// Frost overnight, said from noon.
export function frostLine(now, hours) {
  if (now.getHours() < FROST_FROM_HOUR) return null
  const nowMs = now.getTime()
  const endMs = atHour(now, FROST_UNTIL_HOUR, 1).getTime()
  let low = null
  for (const h of hours) {
    if (!notOver(h, nowMs) || h.ms >= endMs) continue
    const t = whole(h.tempF)
    if (t != null && (low == null || t < low)) low = t
  }
  if (low == null || low > FROST_F) return null
  return line('frost', RANK.FROST, low <= HARD_FREEZE_F ? 'Hard freeze tonight' : 'Frost tonight', endMs)
}

function partOfDay(at, now) {
  const h = at.getHours()
  const tomorrow = dayKey(at) !== dayKey(now) ? 'tomorrow ' : ''
  if (h >= 5 && h < 12) return `${tomorrow}morning`
  if (h >= 12 && h < 18) return `${tomorrow}afternoon`
  return 'tonight'
}

// Gusts in the next 12 hours, named for when they peak.
export function windLine(now, hours) {
  const nowMs = now.getTime()
  const endMs = nowMs + WIND_HOURS * HOUR_MS
  const gusty = hours.filter((h) => notOver(h, nowMs) && h.ms < endMs && (whole(h.gustMph) ?? 0) >= WIND_GUST_MPH)
  if (!gusty.length) return null
  let peak = gusty[0]
  for (const h of gusty) if (whole(h.gustMph) > whole(peak.gustMph)) peak = h
  const strength = whole(peak.gustMph) >= VERY_WINDY_GUST_MPH ? 'Very windy' : 'Windy'
  const last = gusty[gusty.length - 1]
  return line('wind', RANK.WIND, `${strength} ${partOfDay(peak.at, now)}`, last.ms + HOUR_MS)
}

// A hot day, said in the morning.
export function heatLine(now, daily, units) {
  if (now.getHours() >= HOT_BEFORE_HOUR) return null
  const today = daily.find((d) => d?.date === dayKey(now))
  const high = whole(today?.highF)
  if (high == null || high < HOT_F) return null
  return line('heat', RANK.HEAT, `Hot one today, high of ${degrees(today.highF, units)}`, atHour(now, HOT_BEFORE_HOUR).getTime())
}

// A bitter morning, from this hour's feels-like.
export function coldLine(now, hours, units) {
  if (now.getHours() >= BITTER_BEFORE_HOUR) return null
  const nowMs = now.getTime()
  const current = hours.find((h) => h.ms <= nowMs && notOver(h, nowMs))
  const feels = whole(current?.feelsF)
  if (feels == null || feels > BITTER_FEELS_F) return null
  return line(
    'cold',
    RANK.COLD,
    `Bitter cold this morning, feels like ${degrees(current.feelsF, units)}`,
    atHour(now, BITTER_BEFORE_HOUR).getTime(),
  )
}

// --- NWS alerts --------------------------------------------------------------------

export function severityIndex(severity) {
  const i = SEVERITIES.indexOf(severity)
  return i === -1 ? SEVERITIES.length - 1 : i
}

// Tier A: Extreme or Severe, or any Warning whatever its severity.
export function isTierA(alert) {
  return severityIndex(alert?.severity) <= 1 || /\bwarning\b/i.test(String(alert?.event ?? ''))
}

function alertList(alerts) {
  const list = Array.isArray(alerts) ? alerts : Array.isArray(alerts?.alerts) ? alerts.alerts : []
  return list.filter((a) => a && typeof a === 'object' && clean(a.event))
}

function endsMs(a) {
  return parseTime(a.ends)?.getTime() ?? null
}

// Alerts still in force at `now` (no end means in force).
export function activeAlerts(alerts, now = new Date()) {
  const nowMs = now.getTime()
  return alertList(alerts).filter((a) => {
    const e = endsMs(a)
    return e == null || e > nowMs
  })
}

const nullsLast = (x, y) => (x == null ? (y == null ? 0 : 1) : y == null ? -1 : x - y)

// Most severe first, then the earliest ending, then the earliest onset.
export function compareAlerts(a, b) {
  return (
    severityIndex(a.severity) - severityIndex(b.severity) ||
    nullsLast(endsMs(a), endsMs(b)) ||
    nullsLast(parseTime(a.onset)?.getTime() ?? null, parseTime(b.onset)?.getTime() ?? null) ||
    clean(a.event).localeCompare(clean(b.event))
  )
}

// Tonight's midnight: 00:00 exactly, at the start of tomorrow.
function isTonightsMidnight(d, now) {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && dayKey(d) === dayKey(atHour(now, 0, 1))
}

// "6 pm" today, "midnight" tonight, "Sat 6 am" within the week, else "Dec 28".
function when(d, now) {
  if (isTonightsMidnight(d, now)) return 'midnight'
  if (dayKey(d) === dayKey(now)) return clock(d)
  const days = Math.round((atHour(d, 0).getTime() - atHour(now, 0).getTime()) / DAY_MS)
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function alertText(alert, now = new Date()) {
  const event = clean(alert.event)
  const onset = parseTime(alert.onset)
  if (onset && onset.getTime() > now.getTime()) return `${event} from ${when(onset, now)}`
  const ends = parseTime(alert.ends)
  if (!ends) return event
  const today = dayKey(ends) === dayKey(now) || isTonightsMidnight(ends, now)
  return `${event} ${today ? 'until' : 'through'} ${when(ends, now)}`
}

// The alerts worth a line, best first, one per event name.
function uniqueByEvent(alerts, now) {
  const seen = new Set()
  return activeAlerts(alerts, now)
    .sort(compareAlerts)
    .filter((a) => {
      const key = clean(a.event).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function alertLines(now, alerts) {
  const nowMs = now.getTime()
  return uniqueByEvent(alerts, now).map((a) => {
    const onsetMs = parseTime(a.onset)?.getTime() ?? null
    const untilMs = onsetMs != null && onsetMs > nowMs ? onsetMs : endsMs(a)
    const rank = (isTierA(a) ? RANK.ALERT : RANK.ADVISORY) + severityIndex(a.severity)
    return line('alert', rank, alertText(a, now), untilMs)
  })
}

// GET /api/state.weatherAlerts: the alerts in force, most severe first, at
// most `max`, one per event name: [{ event, severity, until, headline }] with
// `until` the alert's end as NWS sent it (ends, else expires; null if none).
export function weatherAlertsFor(alerts, now = new Date(), max = 3) {
  return uniqueByEvent(alerts, now)
    .slice(0, max)
    .map((a) => ({
      event: clean(a.event),
      severity: SEVERITIES[severityIndex(a.severity)],
      until: typeof a.ends === 'string' && a.ends ? a.ends : null,
      headline: typeof a.headline === 'string' && a.headline ? a.headline : null,
    }))
}

// --- all together ------------------------------------------------------------------

export function weatherLinesFor({ now = new Date(), forecast = null, alerts = null, units = 'imperial' } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return []
  const hours = hoursOf(forecast)
  const daily = Array.isArray(forecast?.daily) ? forecast.daily.filter((d) => d && typeof d === 'object') : []
  const lines = [
    ...alertLines(now, alerts),
    rainLine(now, hours),
    frostLine(now, hours),
    windLine(now, hours),
    heatLine(now, daily, units),
    coldLine(now, hours, units),
  ].filter(Boolean)
  // Stable: alerts of one rank keep compareAlerts' order.
  return lines.sort((a, b) => a.rank - b.rank)
}
