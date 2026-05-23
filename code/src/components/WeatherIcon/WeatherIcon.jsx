// WeatherIcon - thin wrapper around the 13 Figma-exported SVGs in
// /public/icons/weather/. Each file is line-art with stroke and fill colours
// already baked in (sun orange, cloud white, rain blue, lightning yellow,
// etc.), so all we need to do here is pick the right file by name.
//
// The SVGs were exported with their own intrinsic aspect ratios. The CSS in
// WeatherPanel sizes a fixed-aspect square container around the <img>; the
// patched SVGs use the default preserveAspectRatio so they letterbox inside
// it instead of stretching.

const FILES = {
  clear: '/icons/weather/clear.svg',
  'partly-cloudy': '/icons/weather/partly-cloudy.svg',
  'mostly-cloudy': '/icons/weather/mostly-cloudy.svg',
  overcast: '/icons/weather/overcast.svg',
  'light-drizzle': '/icons/weather/light-drizzle.svg',
  drizzle: '/icons/weather/drizzle.svg',
  rain: '/icons/weather/rain.svg',
  'heavy-rain': '/icons/weather/heavy-rain.svg',
  thunderstorm: '/icons/weather/thunderstorm.svg',
  'freezing-rain': '/icons/weather/freezing-rain.svg',
  snow: '/icons/weather/snow.svg',
  'heavy-snow': '/icons/weather/heavy-snow.svg',
  fog: '/icons/weather/fog.svg',
}

export const ICON_NAMES = Object.keys(FILES)

export default function WeatherIcon({ name }) {
  const src = FILES[name] || FILES.overcast
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
