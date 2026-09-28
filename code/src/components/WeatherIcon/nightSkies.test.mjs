// Tests for components/WeatherIcon/nightSkies.js: the night skies' clouds are
// the day files' own paths (public/icons/weather), character for character,
// and each moon sits inside its icon's box where the day icon's sun is.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLOUD_PIECES, NIGHT_SKIES, cloudClipPath } from './nightSkies.js'

const ICONS = fileURLToPath(new URL('../../../public/icons/weather/', import.meta.url))

function svg(name) {
  return readFileSync(`${ICONS}${name}`, 'utf8')
}

function pathD(file, id) {
  const m = new RegExp(`<path id="${id}" d="([^"]+)"`).exec(file)
  assert.ok(m, `no path ${id}`)
  return m[1]
}

function viewBoxOf(file) {
  return /viewBox="([^"]+)"/.exec(file)[1]
}

// One cubic 'C x1 y1 x2 y2 x y' from (x0, y0), run backwards.
function reverseCubic(from, curve) {
  const n = curve.replace(/^C/, '').trim().split(/\s+/)
  return { from: `${n[4]} ${n[5]}`, curve: `C${n[2]} ${n[3]} ${n[0]} ${n[1]} ${from}` }
}

test('partly cloudy night: the day file\'s cloud, verbatim, in the day file\'s box', () => {
  const day = svg('partly-cloudy.svg')
  const sky = NIGHT_SKIES['partly-cloudy-night']
  assert.equal(sky.cloud, pathD(day, 'Vector'))
  assert.equal(sky.cloudInside, CLOUD_PIECES.partlyInside)
  assert.ok(pathD(day, 'Vector').endsWith(CLOUD_PIECES.partlyInside))
  assert.equal(sky.viewBox, viewBoxOf(day))
})

test('mostly cloudy night: the cloud from the day file\'s own pieces, without the sun\'s arc', () => {
  const day = svg('mostly-cloudy.svg')
  const white = pathD(day, 'Vector')
  const orange = pathD(day, 'Vector_2')
  const p = CLOUD_PIECES
  // The edge runs on from where the arc meets the dome, to where it leaves.
  assert.ok(white.startsWith('M41.6691 86.1338'))
  assert.ok(white.indexOf(`89.9852 46.5639${p.mostlyEdge}Z`) > 0)
  // The flank and the bump: the sun's inside, which starts up the flank and
  // ends along the bump.
  assert.ok(white.indexOf(`ZM69.3253 68.5787${p.mostlyFlank}C`) > 0)
  assert.ok(white.indexOf(`43.8969 81.6952${p.mostlyBump}Z`) > 0)
  // The joins, run forwards, are the orange arc's own curves.
  const left = reverseCubic('41.6691 86.1338', p.mostlyJoinLeft)
  assert.equal(left.from, '43.8969 81.6952')
  assert.ok(orange.indexOf(`${left.from}${left.curve}`) >= 0, left.curve)
  const top = reverseCubic('86.029 48.6494', p.mostlyJoinTop)
  assert.equal(top.from, '89.9852 46.5639')
  assert.ok(orange.indexOf(`${top.from}${top.curve}`) >= 0, top.curve)
  // One closed outline: arc's end, bump, flank, arc's start.
  const outside = NIGHT_SKIES['mostly-cloudy-night'].cloud.slice(0, -p.mostlyInside.length)
  assert.equal(outside, `M89.9852 46.5639${p.mostlyEdge}${p.mostlyJoinLeft}${p.mostlyBump}${p.mostlyFlank}${p.mostlyJoinTop}Z`)
  // The inside edge, verbatim, is the white path's last subpath.
  assert.ok(white.endsWith(p.mostlyInside))
  const sky = NIGHT_SKIES['mostly-cloudy-night']
  assert.ok(sky.cloud.endsWith(p.mostlyInside))
  assert.equal(sky.cloudInside, p.mostlyInside)
  assert.equal(sky.viewBox, viewBoxOf(day))
  // The sun's arc is gone: nothing of the arc's own outside edge is drawn.
  assert.equal(sky.cloud.indexOf('36.5441 78.0965'), -1)
  assert.equal(sky.cloud.indexOf('53.1678 36.7242'), -1)
})

test('clear night: the day file\'s box; the moon on the sun\'s centre', () => {
  const day = svg('clear.svg')
  const sky = NIGHT_SKIES['clear-night']
  assert.equal(sky.viewBox, viewBoxOf(day))
  assert.equal(sky.cloud, null)
  // clear.svg's sun ring is centred on (65.45, 65.55).
  assert.ok(Math.abs(sky.moon.cx - 65.45) < 0.1 && Math.abs(sky.moon.cy - 65.55) < 0.1)
})

test('every moon inside its box; the mostly cloudy moon is the day sun, size and place', () => {
  for (const [key, sky] of Object.entries(NIGHT_SKIES)) {
    const [, , w, h] = sky.viewBox.split(' ').map(Number)
    const { cx, cy, r } = sky.moon
    assert.ok(cx - r >= 0 && cx + r <= w && cy - r >= 0 && cy + r <= h, key)
    // Round numbers: the path strings carry no float noise.
    for (const v of [cx - r, cx + r, cy - r, cy + r]) assert.equal(v, Number(v.toFixed(3)), `${key} ${v}`)
  }
  const m = NIGHT_SKIES['mostly-cloudy-night'].moon
  // mostly-cloudy.svg's sun: centre (65.39, 65.66), outside radius 31.4.
  assert.ok(Math.abs(m.cx - 65.39) < 0.2 && Math.abs(m.cy - 65.66) < 0.2 && Math.abs(m.r - 31.4) < 0.2)
})

test('the clip keeps everything but the cloud\'s inside', () => {
  const inside = NIGHT_SKIES['partly-cloudy-night'].cloudInside
  const d = cloudClipPath(inside)
  assert.ok(d.startsWith('M-50 -50H250V200H-50Z'))
  assert.ok(d.endsWith(inside))
})
