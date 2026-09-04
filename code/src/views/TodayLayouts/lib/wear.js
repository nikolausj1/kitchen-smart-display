import { RAIN_CODES, SNOW_CODES } from '../data/wmo.js'

// What to wear - one line of dressing advice from today's forecast.
//
// Tuned for Seattle and for kids walking to school: the bands below are what
// actually changes what goes on before school, not a meteorological ideal. The
// thresholds are exported so Settings can put them on screen later instead of
// having them buried in an if-chain.

export const WEAR_THRESHOLDS = {
  // Upper bound of each band is the next one down, i.e. shorts at 75+,
  // t-shirt 62-74, light jacket 50-61, jacket 38-49, coat 32-37, hat below 32.
  shortsAbove: 75,
  tshirtAbove: 62,
  lightJacketAbove: 50,
  jacketAbove: 38,
  coatAbove: 32,
  // In the t-shirt band, a low under this means the morning still needs a
  // layer even though the afternoon will not.
  chillyMorningLow: 55,
  // Chance of precipitation that earns rain gear on its own, without a wet
  // weather code.
  wetPrecipPct: 50,
  // Advice about "the morning" is only useful during it.
  morningEndsHour: 12,
  // When true, a wet day swaps the garment icon for rain gear (raincoat when
  // it is cool, umbrella when it is mild). The headline and detail are
  // unaffected. Set false to always show the temperature-band garment.
  rainGearIcon: true,
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// decideWear({ highF, lowF, precipPct, code, hourNow })
//   -> { headline, detail, icon } | null
// null means "no forecast yet" - the panel shows its own empty state rather
// than being handed invented advice.
export function decideWear({ highF, lowF, precipPct, code, hourNow } = {}) {
  const T = WEAR_THRESHOLDS
  const high = num(highF)
  if (high == null) return null

  const low = num(lowF)
  const pct = num(precipPct)
  const hour = num(hourNow)

  // A snow code wins over a bare precipitation percentage: 60% on a snow day
  // is 60% chance of snow, and telling someone to grab an umbrella for it is
  // worse than saying nothing.
  const snowy = SNOW_CODES.has(code)
  const wet = !snowy && ((pct != null && pct >= T.wetPrecipPct) || RAIN_CODES.has(code))

  // A cool start to a warm day: the t-shirt band only, and only while the
  // morning is still ahead of us.
  const chillyMorning =
    high >= T.tshirtAbove &&
    high < T.shortsAbove &&
    low != null &&
    low < T.chillyMorningLow &&
    (hour == null || hour < T.morningEndsHour)

  let headline
  let icon
  if (high >= T.shortsAbove) {
    headline = 'Shorts weather'
    icon = 'shorts'
  } else if (high >= T.tshirtAbove) {
    headline = chillyMorning ? 'T-shirt, jacket early' : 'T-shirt weather'
    // In the morning of a cool-start day the actionable garment is the layer,
    // not the t-shirt underneath it.
    icon = chillyMorning ? 'light-jacket' : 'tshirt'
  } else if (high >= T.lightJacketAbove) {
    headline = 'Light jacket'
    icon = 'light-jacket'
  } else if (high >= T.jacketAbove) {
    headline = 'Jacket weather'
    icon = 'jacket'
  } else if (high >= T.coatAbove) {
    headline = 'Coat weather'
    icon = 'coat'
  } else {
    headline = 'Coat and hat'
    icon = 'hat'
  }

  // One extra clause at most, so the detail stays a sentence. Rain outranks
  // snow outranks the cool-morning note.
  let extra = ''
  if (wet) {
    const chance = pct != null ? `${pct}% rain` : 'rain likely'
    const gear = high >= T.tshirtAbove ? 'grab an umbrella' : 'take a raincoat'
    extra = `${chance}, ${gear}`
    if (T.rainGearIcon && high >= T.jacketAbove) {
      icon = high >= T.tshirtAbove ? 'umbrella' : 'raincoat'
    }
  } else if (snowy) {
    extra = pct != null ? `${pct}% chance of snow` : 'snow likely'
  } else if (chillyMorning) {
    extra = 'light jacket for the morning'
  }

  // Drop the low when there is a second clause, or the line turns into a list.
  const base = low != null && !extra ? `High ${high}, low ${low}` : `High ${high}`
  const detail = extra ? `${base}, ${extra}` : base

  return { headline, detail, icon }
}
