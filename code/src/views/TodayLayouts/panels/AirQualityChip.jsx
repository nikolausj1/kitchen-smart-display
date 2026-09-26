import PanelFrame from './PanelFrame.jsx'
import { panelKnobs } from './schemas.js'
import './AirQualityChip.css'

// AirQualityChip - a coloured square holding the US AQI number, then the word
// for it and the PM2.5 reading underneath.
//
// airQuality: { pm25, aqi, label, fetchedAt } from the hub (Open-Meteo air
// quality, hourly). The colour follows the hub's label (the EPA's six bands);
// a label it does not recognise falls back to the AQI number's band, so an
// unexpected string never paints the wrong colour. null: a grey square and
// "No reading yet", never an invented number.
//
// knobs (a spec layout, panels/schemas.js 'airquality'): style ('chip': the
// square beside two lines; 'inline': one line, the number in a small pill),
// size (the square with its number, and the words), showPm25.

const LEVELS = [
  { key: 'good', max: 50, label: 'Good' },
  { key: 'moderate', max: 100, label: 'Moderate' },
  { key: 'usg', max: 150, label: 'Unhealthy for sensitive groups' },
  { key: 'unhealthy', max: 200, label: 'Unhealthy' },
  { key: 'very', max: 300, label: 'Very unhealthy' },
  { key: 'hazardous', max: Infinity, label: 'Hazardous' },
]

function levelForLabel(label) {
  if (typeof label !== 'string') return null
  const s = label.trim().toLowerCase()
  if (!s) return null
  if (s.includes('sensitive')) return LEVELS[2]
  if (s.startsWith('very')) return LEVELS[4]
  return LEVELS.find((l) => l.label.toLowerCase() === s) || null
}

function levelForAqi(aqi) {
  if (!Number.isFinite(aqi) || aqi < 0) return null
  return LEVELS.find((l) => aqi <= l.max) || null
}

export default function AirQualityChip({ airQuality, knobs }) {
  const k = panelKnobs('airquality', knobs)
  const aqi = Number.isFinite(airQuality?.aqi) ? Math.round(airQuality.aqi) : null
  const pm25 = Number.isFinite(airQuality?.pm25) ? Math.round(airQuality.pm25) : null
  const hasReading = aqi != null || pm25 != null
  const level = levelForLabel(airQuality?.label) || levelForAqi(aqi)
  const word =
    (typeof airQuality?.label === 'string' && airQuality.label.trim()) ||
    level?.label ||
    'Air quality'
  // With PM2.5 off, a reading needs no second line; "No reading yet" stays,
  // it is the honest empty state.
  const showPm25 = k ? !!k.showPm25 : true
  const detail = !hasReading
    ? 'No reading yet'
    : !showPm25
      ? null
      : pm25 != null
        ? `PM2.5 ${pm25} µg/m³`
        : 'US AQI'
  const cls = [
    'tl-aq',
    `tl-aq--${hasReading && level ? level.key : 'none'}`,
    k ? 'tl-knobs' : '',
    k && k.style === 'inline' ? 'tl-aq--inline' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <PanelFrame
      title={null}
      className={cls}
      bodyClassName="tl-aq__body"
      style={k ? { '--tl-aq-size': String(k.size) } : undefined}
    >
      <div
        className="tl-aq__square tl-num"
        aria-hidden={aqi == null ? 'true' : undefined}
        data-edit="number"
        data-edit-label="AQI"
      >
        {aqi == null ? '--' : aqi}
      </div>
      <div className="tl-aq__text" data-edit="label">
        <div className="tl-aq__word">{hasReading ? word : 'Air quality'}</div>
        {detail && (
          <div className="tl-aq__detail tl-num" data-edit="detail">
            {detail}
          </div>
        )}
      </div>
    </PanelFrame>
  )
}
