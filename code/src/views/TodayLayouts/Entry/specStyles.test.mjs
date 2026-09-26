// Tests for specStyles.js: what the element styles and the box v2 look draw
// as. Run from code/: node --test src/views/TodayLayouts/Entry/specStyles.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blurTintAlpha, boxLook, elementStylesCss, hexChannels, shrinkKeysOf } from './specStyles.js'

test('no styles, no stylesheet', () => {
  assert.equal(elementStylesCss('clock', null), '')
  assert.equal(elementStylesCss('clock', {}), '')
  assert.equal(elementStylesCss('bad id"', { time: { size: 2 } }), '')
})

test('a hidden element is display: none, and nothing else', () => {
  assert.equal(
    elementStylesCss('agenda', { rows: { hidden: true, size: 2, color: '#fff' } }),
    '[data-box="agenda"] [data-edit="rows"][data-edit]{display:none!important}\n'
  )
})

test('size multiplies the text scale through the variables, never a font size', () => {
  const css = elementStylesCss('agenda', { rows: { size: 1.3 } })
  assert.equal(
    css,
    '[data-box="agenda"] [data-edit="rows"][data-edit]{--tl-el-size:1.3;' +
      '--tl-text-scale:calc(var(--tl-knob-scale, 1) * var(--tl-el-size, 1) * var(--tl-el-fit, 1))}\n'
  )
  assert.ok(!/font-size/.test(css))
})

test('typography reaches the element and its children; margins the element only', () => {
  const css = elementStylesCss('weather', {
    description: { weight: 700, color: '#ffcc00', tracking: 0.12, caps: true, spaceAbove: 0.5, spaceBelow: 1, fit: 'clip' },
  })
  const [own, deep] = css.trim().split('\n')
  assert.ok(own.startsWith('[data-box="weather"] [data-edit="description"][data-edit]{'))
  assert.ok(own.includes('margin-top:calc(var(--tl-pad) * 0.5)!important'))
  assert.ok(own.includes('margin-bottom:calc(var(--tl-pad) * 1)!important'))
  assert.ok(own.includes('overflow:hidden!important'))
  assert.ok(deep.startsWith('[data-box="weather"] [data-edit="description"] *{'))
  for (const decl of ['font-weight:700!important', 'color:#ffcc00!important', 'letter-spacing:0.12em!important', 'text-transform:uppercase!important', 'text-overflow:clip!important']) {
    assert.ok(own.includes(decl), decl)
    assert.ok(deep.includes(decl), decl)
  }
  assert.ok(!deep.includes('margin'))
})

test('shrink sets the text scale so the fitter factor applies', () => {
  const css = elementStylesCss('headline', { text: { fit: 'shrink' } })
  assert.ok(css.includes('--tl-text-scale:calc(var(--tl-knob-scale, 1) * var(--tl-el-size, 1) * var(--tl-el-fit, 1))'))
  assert.ok(!css.includes('--tl-el-size:'))
  assert.equal(shrinkKeysOf({ text: { fit: 'shrink' }, dot: { fit: 'shrink', hidden: true }, x: { fit: 'wrap' } }), 'text')
  assert.equal(shrinkKeysOf(null), '')
})

test('boxLook at the defaults adds nothing', () => {
  const look = boxLook({ background: 'card', padding: 1, textScale: 1, align: 'start' }, 'agenda')
  assert.deepEqual(look, { classes: [], style: {}, fill: null, boxShadow: null, rounded: false, title: null })
})

test('boxLook: a gradient fill over the preset, a frame above it, a drop shadow', () => {
  const look = boxLook(
    { background: 'card', bg: { color: '#223344', color2: '#556677', gradient: 'diagonal', opacity: 0.8 }, border: { width: 2, color: '#ffffff' }, shadow: 'soft' },
    'countdowns'
  )
  assert.deepEqual(look.fill, { background: 'linear-gradient(to bottom right, #223344, #556677)', opacity: 0.8 })
  assert.deepEqual(look.classes, ['tl-spec--fill', 'tl-spec--frame'])
  assert.equal(look.style['--tl-spec-frame'], 'inset 0 0 0 max(1px, 0.1042vw) #ffffff, inset 0 0 0 1px var(--tl-spec-edge)')
  assert.match(look.boxShadow, /^0 calc\(var\(--tl-pad\) \* 0\.15\)/)
  assert.equal(look.rounded, true)
})

test('boxLook: an opacity alone fades the preset fill; no preset, no colour, no fill', () => {
  assert.deepEqual(boxLook({ background: 'solid', bg: { opacity: 0.5 } }, 'clock').fill, { background: 'var(--tl-surface-solid)', opacity: 0.5 })
  assert.equal(boxLook({ background: 'none', bg: { opacity: 0.5 } }, 'clock').fill, null)
  assert.equal(
    boxLook({ background: 'none', bg: { color2: '#000000', gradient: 'down' } }, 'clock').fill.background,
    'linear-gradient(to bottom, transparent, #000000)'
  )
})

test('boxLook: blur, font, colour, valign and title', () => {
  const look = boxLook(
    { background: 'none', blur: 10, font: 'roboto', color: '#102030', valign: 'bottom', title: { mode: 'custom', text: '  Next up  ' } },
    'agenda'
  )
  assert.deepEqual(look.classes, ['tl-spec--blur', 'tl-spec--valign-bottom'])
  assert.equal(look.style['--tl-spec-blur'], '0.5208vw')
  assert.equal(look.style['--tl-spec-tint'], `rgba(8, 10, 12, ${blurTintAlpha(10)})`)
  assert.equal(look.boxShadow, 'none')
  assert.equal(look.style.fontFamily, "'Roboto', -apple-system, system-ui, sans-serif")
  assert.equal(look.style['--tl-font-display'], look.style.fontFamily)
  assert.equal(look.style['--tl-fg-rgb'], '16, 32, 48')
  assert.equal(look.style['--tl-fg-3'], 'rgba(16, 32, 48, 0.42)')
  assert.deepEqual(look.title, { mode: 'custom', text: 'Next up' })
  // A text block's colour is its own prop: the box leaves it alone.
  assert.equal(boxLook({ color: '#102030' }, 'text').style.color, undefined)
  assert.equal(boxLook({ font: 'inherit' }, 'clock').style.fontFamily, undefined)
  assert.deepEqual(boxLook({ title: { mode: 'none' } }, 'clock').title, { mode: 'none', text: '' })
})

test('hexChannels', () => {
  assert.equal(hexChannels('#f2f2f0'), '242, 242, 240')
  assert.equal(hexChannels('#abc'), '170, 187, 204')
  assert.equal(hexChannels('#11223380'), '17, 34, 51')
  assert.equal(hexChannels('red'), null)
})
