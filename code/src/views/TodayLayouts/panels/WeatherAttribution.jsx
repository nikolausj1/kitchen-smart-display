import './WeatherAttribution.css'

// WeatherAttribution - the "Apple Weather" mark the WeatherKit licence asks
// for wherever Apple's data shows (docs/designs/panels-and-controls.md,
// "WeatherKit"): a small muted caption inside every weather panel while the
// hub's feed comes from Apple (useTodayData d.weather.attribution; null for
// Open-Meteo, which needs no mark, and then nothing renders at all).
//
// It is marked data-edit="attribution" so the layout editor can point at it,
// but that key is deliberately NOT in PANEL_ELEMENTS (panels/schemas.js): the
// spec normaliser drops any element style for it, so it cannot be hidden,
// shrunk or recoloured apart from its panel. Its size is fixed at 12 to 14 px
// and does not follow the box's text scale. Settings prints the legal link
// (the Echo cannot follow one); the dashboard's weather card has it too.
//
// corner: pinned to the panel's bottom-right corner (the weather card, whose
// corner is free), for a panel that carries tl-wx-host; else a line at the
// foot of the panel's body, right-aligned, so it can never sit on the data.
export default function WeatherAttribution({ attribution, corner = false }) {
  const name = attribution && typeof attribution.name === 'string' ? attribution.name : null
  if (!name) return null
  return (
    <div
      className={`tl-wx-attr${corner ? ' tl-wx-attr--corner' : ''}`}
      data-edit="attribution"
      data-edit-label={name}
    >
      {name}
    </div>
  )
}
