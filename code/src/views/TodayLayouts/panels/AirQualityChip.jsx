import PanelFrame from './PanelFrame.jsx'
import './AirQualityChip.css'

// AirQualityChip - a coloured square holding the US AQI number, then the word
// for it and the PM2.5 reading underneath.
//
// airQuality: { pm25, aqi, label, fetchedAt } from the hub (Open-Meteo air
// quality, hourly). The colour follows the hub's label (the EPA's six bands);
// a label it does not recognise falls back to the AQI number's band, so an
// unexpected string never paints the wrong colour. null: a grey square and
// "No reading yet", never an invented number.

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

export default function AirQualityChip({ airQuality }) {
  const aqi = Number.isFinite(airQuality?.aqi) ? Math.round(airQuality.aqi) : null
  const pm25 = Number.isFinite(airQuality?.pm25) ? Math.round(airQuality.pm25) : null
  const hasReading = aqi != null || pm25 != null
  const level = levelForLabel(airQuality?.label) || levelForAqi(aqi)
  const word =
    (typeof airQuality?.label === 'string' && airQuality.label.trim()) ||
    level?.label ||
    'Air quality'

  return (
    <PanelFrame
      title={null}
      className={`tl-aq tl-aq--${hasReading && level ? level.key : 'none'}`}
      bodyClassName="tl-aq__body"
    >
      <div className="tl-aq__square tl-num" aria-hidden={aqi == null ? 'true' : undefined}>
        {aqi == null ? '--' : aqi}
      </div>
      <div className="tl-aq__text">
        <div className="tl-aq__word">{hasReading ? word : 'Air quality'}</div>
        <div className="tl-aq__detail tl-num">
          {!hasReading
            ? 'No reading yet'
            : pm25 != null
              ? `PM2.5 ${pm25} µg/m³`
              : 'US AQI'}
        </div>
      </div>
    </PanelFrame>
  )
}
