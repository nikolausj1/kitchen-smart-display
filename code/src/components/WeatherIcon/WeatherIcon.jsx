import { useId } from 'react'
import { MoonShape } from '../MoonGlyph/MoonGlyph.jsx'
import { DEFAULT_PHASE, clampPhase, moonPhaseName } from '../MoonGlyph/moonGeometry.js'
import { nightIconKey, wmoToIcon } from '../../views/TodayLayouts/data/wmo.js'
import { ICON_FILES } from './iconFiles.js'
import { CLOUD_COLOR, NIGHT_SKIES, cloudClipPath } from './nightSkies.js'
import './WeatherIcon.css'

// WeatherIcon - thin wrapper around the 13 Figma-exported SVGs in
// /public/icons/weather/. Each file is line-art with stroke and fill colours
// already baked in (sun orange, cloud white, rain blue, lightning yellow,
// etc.), so all we need to do here is pick the right file by name.
//
// The SVGs were exported with their own intrinsic aspect ratios. The CSS in
// WeatherPanel sizes a fixed-aspect square container around the <img>; the
// patched SVGs use the default preserveAspectRatio so they letterbox inside
// it instead of stretching.
//
//   <WeatherIcon code={wmo} isDay={bool} moonPhase={0..1} />
//   <WeatherIcon name="partly-cloudy" isDay={bool} moonPhase={0..1} />
//
// code: a WMO code (views/TodayLayouts/data/wmo.js wmoToIcon picks the
// file); name: a file's key, for callers that hold the key already (the
// Framed Today's slots, the layouts' current reading). code wins when it is
// a number. Anything unknown draws overcast, as it always has. A night sky's
// own key ('clear-night', nightSkies.js) draws that sky whatever isDay says.
//
// Night. isDay undefined or true: the day icon, the <img> exactly as it has
// always been. isDay === false and the sky is clear, partly cloudy or mostly
// cloudy: its night version, drawn inline (nightSkies.js) so the moon can
// show its phase: the moon alone, or behind the cloud (MoonGlyph.jsx
// MoonShape). Every other sky keeps its day icon at night. moonPhase: 0 new,
// 0.5 full, 1 new again (the hub's scale); missing, a waxing crescent. The
// night <svg> carries the img's class, so every caller's sizing rule for
// `.weather-icon-img` sizes it the same (it fills its box, display block:
// WeatherIcon.css), and names itself for a screen reader ("Clear night,
// waxing gibbous"); the day img stays hidden from one, as before.

// The day files, by key (iconFiles.js; ICON_NAMES lists them, and
// nightSkies.js NIGHT_ICON_NAMES the night skies).
const FILES = ICON_FILES

function NightSky({ sky, moonPhase }) {
  const s = NIGHT_SKIES[sky]
  const clipId = useId()
  const p = clampPhase(moonPhase)
  const phase = p == null ? DEFAULT_PHASE : p
  const moon = <MoonShape phase={phase} cx={s.moon.cx} cy={s.moon.cy} r={s.moon.r} />
  return (
    <svg
      className="weather-icon-img weather-icon-night"
      viewBox={s.viewBox}
      fill="none"
      role="img"
      aria-label={`${s.label}, ${moonPhaseName(phase).toLowerCase()}`}
      data-night-sky={sky}
    >
      {s.cloud ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <path clipRule="evenodd" d={cloudClipPath(s.cloudInside)} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>{moon}</g>
          <path d={s.cloud} fill={CLOUD_COLOR} />
        </>
      ) : (
        moon
      )}
    </svg>
  )
}

export default function WeatherIcon({ name, code, isDay, moonPhase }) {
  const key = typeof code === 'number' ? wmoToIcon(code) : name
  // A night sky: a sun sky at night, or a night key asked for by name
  // (name="clear-night", a preview's).
  const sky = isDay === false ? nightIconKey(key) : key
  if (typeof sky === 'string' && Object.prototype.hasOwnProperty.call(NIGHT_SKIES, sky)) {
    return <NightSky sky={sky} moonPhase={moonPhase} />
  }
  const src = FILES[key] || FILES.overcast
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable="false"
      className="weather-icon-img"
    />
  )
}
