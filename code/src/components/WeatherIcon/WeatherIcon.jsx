// WeatherIcon - the 13 icon names in Smart Displays.md, mapped to inline SVGs.
//
// Style: line-art, stroke 3, round joins. Colour accents:
//   sun     -> orange  (#ff9a1a)
//   cloud   -> white   (#ffffff)
//   rain    -> blue    (#1ea0ff)
//   snow    -> white   (#ffffff)
//   lightning -> yellow (#ffe500)
//
// Each subcomponent shares the same 64x64 viewBox so they line up in the
// weather strip. All paths are pure outlines (fill="none") to keep the
// uniform line-art feel of the Figma reference.

const COLORS = {
  sun: '#ff9a1a',
  cloud: '#ffffff',
  rain: '#1ea0ff',
  snow: '#ffffff',
  bolt: '#ffe500',
}

const STROKE = 3

const Svg = ({ children }) => (
  <svg
    viewBox="0 0 64 64"
    width="100%"
    height="100%"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

// A reusable cloud outline. Position via an SVG transform on the wrapper.
const Cloud = ({ color = COLORS.cloud, x = 0, y = 0, scale = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path
      d="M16 44
         C10 44 8 38 12 34
         C10 26 20 22 26 26
         C28 20 40 20 42 28
         C50 26 54 34 50 40
         L50 44 Z"
      stroke={color}
      strokeWidth={STROKE}
    />
  </g>
)

const Sun = ({ x = 32, y = 32, r = 8, withRays = true }) => (
  <g stroke={COLORS.sun} strokeWidth={STROKE}>
    <circle cx={x} cy={y} r={r} />
    {withRays && (
      <>
        <line x1={x} y1={y - r - 4} x2={x} y2={y - r - 9} />
        <line x1={x} y1={y + r + 4} x2={x} y2={y + r + 9} />
        <line x1={x - r - 4} y1={y} x2={x - r - 9} y2={y} />
        <line x1={x + r + 4} y1={y} x2={x + r + 9} y2={y} />
        <line x1={x - r - 3} y1={y - r - 3} x2={x - r - 7} y2={y - r - 7} />
        <line x1={x + r + 3} y1={y - r - 3} x2={x + r + 7} y2={y - r - 7} />
        <line x1={x - r - 3} y1={y + r + 3} x2={x - r - 7} y2={y + r + 7} />
        <line x1={x + r + 3} y1={y + r + 3} x2={x + r + 7} y2={y + r + 7} />
      </>
    )}
  </g>
)

// A single rain stroke (45deg).
const RainLine = ({ x, y, length = 8, color = COLORS.rain }) => (
  <line
    x1={x}
    y1={y}
    x2={x - length * 0.5}
    y2={y + length}
    stroke={color}
    strokeWidth={STROKE}
  />
)

// A snowflake "x".
const Flake = ({ x, y, size = 4, color = COLORS.snow }) => (
  <g stroke={color} strokeWidth={STROKE - 0.5}>
    <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} />
    <line x1={x + size} y1={y - size} x2={x - size} y2={y + size} />
  </g>
)

function Clear() {
  return (
    <Svg>
      <Sun x={32} y={32} r={10} />
    </Svg>
  )
}

function PartlyCloudy() {
  return (
    <Svg>
      <Sun x={22} y={22} r={8} />
      <Cloud x={10} y={12} scale={0.85} />
    </Svg>
  )
}

function MostlyCloudy() {
  return (
    <Svg>
      <Sun x={18} y={20} r={6} withRays={false} />
      <Cloud x={6} y={10} scale={1} />
    </Svg>
  )
}

function Overcast() {
  return (
    <Svg>
      <Cloud x={2} y={8} scale={1} />
    </Svg>
  )
}

function LightDrizzle() {
  return (
    <Svg>
      <Cloud x={2} y={2} scale={1} />
      <RainLine x={32} y={50} length={7} />
    </Svg>
  )
}

function Drizzle() {
  return (
    <Svg>
      <Cloud x={2} y={2} scale={1} />
      <RainLine x={26} y={50} length={7} />
      <RainLine x={38} y={50} length={7} />
    </Svg>
  )
}

function Rain() {
  return (
    <Svg>
      <Cloud x={2} y={0} scale={1} />
      <RainLine x={22} y={49} length={9} />
      <RainLine x={32} y={49} length={9} />
      <RainLine x={42} y={49} length={9} />
    </Svg>
  )
}

function HeavyRain() {
  return (
    <Svg>
      <Cloud x={2} y={0} scale={1} />
      <RainLine x={20} y={48} length={12} />
      <RainLine x={28} y={48} length={12} />
      <RainLine x={36} y={48} length={12} />
      <RainLine x={44} y={48} length={12} />
    </Svg>
  )
}

function Thunderstorm() {
  return (
    <Svg>
      <Cloud x={2} y={0} scale={1} />
      <RainLine x={20} y={49} length={8} />
      <RainLine x={42} y={49} length={8} />
      <path
        d="M32 44 L28 54 L33 54 L30 62 L38 50 L33 50 L36 44 Z"
        stroke={COLORS.bolt}
        strokeWidth={STROKE - 1}
        fill={COLORS.bolt}
      />
    </Svg>
  )
}

function FreezingRain() {
  return (
    <Svg>
      <Cloud x={2} y={0} scale={1} />
      <RainLine x={22} y={49} length={8} />
      <Flake x={32} y={54} size={3} />
      <RainLine x={42} y={49} length={8} />
    </Svg>
  )
}

function Snow() {
  return (
    <Svg>
      <Cloud x={2} y={0} scale={1} />
      <Flake x={24} y={54} size={3} />
      <Flake x={40} y={54} size={3} />
    </Svg>
  )
}

function HeavySnow() {
  return (
    <Svg>
      <Cloud x={2} y={0} scale={1} />
      <Flake x={20} y={52} size={3} />
      <Flake x={32} y={56} size={3} />
      <Flake x={44} y={52} size={3} />
    </Svg>
  )
}

function Fog() {
  return (
    <Svg>
      <Cloud x={2} y={-4} scale={1} />
      <g stroke={COLORS.cloud} strokeWidth={STROKE}>
        <line x1={10} y1={48} x2={54} y2={48} />
        <line x1={6} y1={56} x2={50} y2={56} />
      </g>
    </Svg>
  )
}

const ICONS = {
  clear: Clear,
  'partly-cloudy': PartlyCloudy,
  'mostly-cloudy': MostlyCloudy,
  overcast: Overcast,
  'light-drizzle': LightDrizzle,
  drizzle: Drizzle,
  rain: Rain,
  'heavy-rain': HeavyRain,
  thunderstorm: Thunderstorm,
  'freezing-rain': FreezingRain,
  snow: Snow,
  'heavy-snow': HeavySnow,
  fog: Fog,
}

export const ICON_NAMES = Object.keys(ICONS)

export default function WeatherIcon({ name }) {
  const Component = ICONS[name] || Overcast
  return <Component />
}
