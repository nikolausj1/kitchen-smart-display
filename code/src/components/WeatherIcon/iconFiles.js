// iconFiles.js - the 13 day icons (public/icons/weather), by the keys
// views/TodayLayouts/data/wmo.js wmoToIcon returns. Drawn by WeatherIcon.jsx
// as an <img>; kept in a module of their own so the component's file exports
// only components (React fast refresh). The night skies are nightSkies.js.

export const ICON_FILES = Object.freeze({
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
})

export const ICON_NAMES = Object.keys(ICON_FILES)
