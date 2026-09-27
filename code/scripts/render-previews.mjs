#!/usr/bin/env node
// render-previews.mjs - the Add block menu's thumbnails. Every block type the
// app knows is drawn alone, by the app itself, on a 1920x1080 Entry board at
// the box Add block starts it in, with the demo's sample data; the box is cut
// out and written as code/public/previews/<type>.png, 320 px wide (a 160 px
// menu tile at 2x), and code/public/previews/index.json lists them with the
// git stamp they were made at. The Vite build copies public/previews/ into
// dist/previews/, which the hub serves beside the app (deploy.sh
// HUB_APP_FILES); the layout editor looks them up as previews/<type>.png
// (src/editor/catalog.js previewPath).
//
// A DEV-ONLY TOOL, run by hand on the Mac after a change to how a block looks,
// then the PNGs are committed. It is not part of the build, and nothing runs
// it on a screen or on the hub (deploy.sh copies code/scripts/*.mjs to the hub
// beside the photo manifest scripts; this one is inert there). It needs:
//   - Google Chrome: $CHROME, else /Applications/Google Chrome.app/...
//   - puppeteer-core, deliberately NOT a dependency of this repo. Install it
//     once anywhere outside it and pass that folder:
//       npm install --prefix ~/.cache/sd-previews puppeteer-core
//       node code/scripts/render-previews.mjs --puppeteer ~/.cache/sd-previews
//     ($PUPPETEER_CORE works as well as --puppeteer; either may name the
//     install folder or the puppeteer-core package folder itself.) A
//     puppeteer-core Node finds on its own is used when neither is given.
//   - the app's own Vite (code/node_modules), which builds the app in memory:
//     nothing is written to dist/.
//
// How it draws: no server, no network, nothing sent to the hub.
//   - The build is served from memory through Chrome's request interception
//     at http://app.previews.test. The app runs as the layout editor shows it
//     (?edit=1&layout=entry, in an iframe: no kiosk behaviour, no writes),
//     with the demo's sample data (?demo=1&demoWeather=1) and a hub that does
//     not exist (?hub=http://hub.previews.test). Every hub request is answered
//     here with a 404, except the photo manifest and the pictures, which this
//     script draws (the photo tile and the image block need one; no family
//     photo ends up in the repo). Anything else off the page is refused.
//   - The clock is frozen at CLOCK (a Thursday mid-morning, outside the school
//     morning) in America/Los_Angeles and Math.random is seeded, so a rerun
//     draws the same pixels.
//   - For each type it sends the draft the editor would (sd-edit:spec): that
//     type alone at its starting box (layoutSpec.js newPanel / newBlock), with
//     SAMPLE_PROPS where a block needs something to show, over the black
//     backdrop (sd-edit:display); waits for the box to settle; and captures
//     the box scaled to 320 px wide, re-encoded smaller (lossless).
//
// Usage, from anywhere:
//   node code/scripts/render-previews.mjs --puppeteer ~/.cache/sd-previews
//   ... --only hourly,agenda       redraw some; the others and their index
//                                  entries stay as they are
//   ... --out <dir>                write somewhere else (default
//                                  code/public/previews)
// It exits 1 if any type fails to draw (the rest are still written).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(CODE, '..')
const APP = 'http://app.previews.test'
const HUB = 'http://hub.previews.test'
const CANVAS = { w: 1920, h: 1080 }
const WIDTH = 320
// Thursday 2026-10-15, 10:10 am in the house: a school day, past the morning.
const CLOCK = '2026-10-15T10:10:00-07:00'
const ZONE = 'America/Los_Angeles'
const SEED = 20261015
const CHROME_DEFAULT = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Props a block needs to show something (merged over its starting props).
// The Home Assistant ids are the demo whitelist's (data/demo.js demoHa).
const SAMPLE_PROPS = {
  text: { text: 'Welcome home' },
  image: { src: '/countdown-art/preview-sample.svg' },
  hastatus: { entity: 'cover.garage_door_controller' },
  habutton: { action: 'downstairs-off' },
  hapicker: { entity: 'input_select.day_part_override' },
}

// Boxes drawn beside a type (and not captured): the now-playing box shows the
// departure countdown while one runs (the demo's always does) unless the
// layout has a departure panel of its own, so it gets one, out of the way.
const COMPANIONS = {
  nowplaying: [{ id: 'departure', type: 'departure', x: 0, y: 0, w: 8, h: 10 }],
}

// --- Arguments --------------------------------------------------------------------

function parseArgs(argv) {
  const out = { puppeteer: process.env.PUPPETEER_CORE || null, only: null, out: path.join(CODE, 'public', 'previews') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--puppeteer') out.puppeteer = next()
    else if (a === '--only') out.only = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--out') out.out = path.resolve(next())
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`unknown argument: ${a}`)
  }
  return out
}

function expandHome(p) {
  return p && p.startsWith('~/') ? path.join(process.env.HOME || '', p.slice(2)) : p
}

// puppeteer-core: from the folder given (its install folder, or the package
// folder itself), else wherever Node finds it; else say how to install it.
async function loadPuppeteer(where) {
  const tries = []
  if (where) {
    const dir = path.resolve(expandHome(where))
    const pkgFile = path.join(dir, 'package.json')
    if (fs.existsSync(pkgFile) && JSON.parse(fs.readFileSync(pkgFile, 'utf8')).name === 'puppeteer-core') {
      tries.push(createRequire(path.join(dir, 'noop.js')).resolve(dir))
    } else {
      try {
        tries.push(createRequire(path.join(dir, 'noop.js')).resolve('puppeteer-core'))
      } catch {
        // not there: the error below says so
      }
    }
  }
  for (const entry of tries) {
    const mod = await import(pathToFileURL(entry).href)
    return mod.default || mod
  }
  try {
    const mod = await import('puppeteer-core')
    return mod.default || mod
  } catch {
    throw new Error(
      'puppeteer-core not found. It is not a dependency of this repo: install it once outside it\n' +
        '  npm install --prefix ~/.cache/sd-previews puppeteer-core\n' +
        'and run with --puppeteer ~/.cache/sd-previews (or PUPPETEER_CORE=...).'
    )
  }
}

// --- The app, built in memory -------------------------------------------------------

async function buildApp() {
  const require = createRequire(path.join(CODE, 'package.json'))
  const { build } = await import(pathToFileURL(require.resolve('vite')).href)
  const result = await build({
    root: CODE,
    configFile: path.join(CODE, 'vite.config.js'),
    // No public/: its stub photos are big and not wanted; the icons are
    // served from public/ directly (appFile).
    publicDir: false,
    logLevel: 'warn',
    build: { write: false, emptyOutDir: false },
  })
  const files = new Map()
  for (const out of Array.isArray(result) ? result : [result]) {
    for (const item of out.output) {
      const body = item.type === 'chunk' ? item.code : item.source
      files.set(`/${item.fileName}`, Buffer.isBuffer(body) ? body : Buffer.from(body))
    }
  }
  return files
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
}

// A file of the app: the build's, else public/'s (the icons), never the stub
// photos.
function appFile(files, urlPath) {
  const p = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath)
  if (files.has(p)) return files.get(p)
  if (p.startsWith('/stub-photos/') || p.includes('..')) return null
  const file = path.join(CODE, 'public', p)
  return file.startsWith(path.join(CODE, 'public') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()
    ? fs.readFileSync(file)
    : null
}

// --- The pictures (drawn here: no photo from the house goes in the repo) ---------------

function landscape(w, h, palette) {
  const [sky1, sky2, sun, far, mid, near, water] = palette
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1000 ${Math.round((1000 * h) / w)}" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
<rect width="1000" height="1000" fill="url(#s)"/>
<circle cx="690" cy="300" r="70" fill="${sun}"/>
<path d="M0 420 L140 330 L260 390 L400 280 L560 380 L700 320 L860 400 L1000 340 L1000 1000 L0 1000Z" fill="${far}"/>
<path d="M0 500 L180 430 L330 480 L520 410 L700 470 L880 430 L1000 460 L1000 1000 L0 1000Z" fill="${mid}"/>
<path d="M0 560 L220 520 L460 560 L700 530 L1000 570 L1000 1000 L0 1000Z" fill="${near}"/>
<rect y="600" width="1000" height="400" fill="${water}"/>
<path d="M600 640 L780 640 M630 680 L750 680 M660 720 L720 720" stroke="${sun}" stroke-width="6" stroke-linecap="round" opacity="0.7"/>
</svg>`
}

const PHOTO_SVG = landscape(1600, 1000, ['#f3c58f', '#e6956b', '#fff1d0', '#8a6f93', '#5d5a82', '#3d4668', '#2d3a5c'])
const PICTURE_SVG = landscape(1000, 1000, ['#9fd3e6', '#e9f2e8', '#fffbe8', '#7fa88a', '#4f8a6a', '#2f6b52', '#3f7fa8'])
const MANIFEST = {
  albums: [],
  photos: [1, 2, 3].map((n) => ({
    src: `/stub-photos/preview-${n}.svg`,
    width: 1600,
    height: 1000,
    orientation: 'landscape',
    addedAt: 0,
    albums: [],
    exif: { location: 'Seattle, Washington', date: 'October 2026' },
  })),
}

function hubAnswer(urlPath) {
  if (urlPath === '/stub-photos/manifest.json') return { type: 'application/json', body: JSON.stringify(MANIFEST) }
  if (/^\/stub-photos\/preview-\d\.svg$/.test(urlPath)) return { type: 'image/svg+xml', body: PHOTO_SVG }
  if (urlPath === '/countdown-art/preview-sample.svg') return { type: 'image/svg+xml', body: PICTURE_SVG }
  return null
}

// --- Chrome ----------------------------------------------------------------------------

// Runs in every frame before its scripts: one frozen moment, a seeded random.
function freeze(fixed, seed) {
  const RealDate = Date
  class FrozenDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(fixed)
      else super(...a)
    }
    static now() {
      return fixed
    }
  }
  window.Date = FrozenDate
  let s = seed >>> 0
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PARENT = `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden">
<iframe id="app" style="border:0;display:block;width:${CANVAS.w}px;height:${CANVAS.h}px"
  src="/?hub=${encodeURIComponent(HUB)}&device=dev-mac&layout=entry&view=today&edit=1&demo=1&demoWeather=1"></iframe>
</body></html>`

async function openBoard(puppeteer, files) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || CHROME_DEFAULT,
    headless: true,
    // Software raster, one thread, sRGB: the same pixels every run.
    args: [
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--num-raster-threads=1',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  })
  const page = await browser.newPage()
  await page.emulateTimezone(ZONE)
  await page.setViewport({ width: CANVAS.w, height: CANVAS.h, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(freeze, Date.parse(CLOCK), SEED)
  const net = { pending: 0, last: Date.now(), refused: new Set(), errors: [] }
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    net.pending += 1
    net.last = Date.now()
    const done = () => {
      net.pending -= 1
      net.last = Date.now()
    }
    const url = new URL(req.url())
    // The hub is another origin to the app: its answers carry CORS, as the
    // real hub's do.
    const headers = url.origin === HUB ? { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } : {}
    const reply = (status, type, body) => req.respond({ status, contentType: type, headers, body }).finally(done)
    if (url.protocol === 'data:' || url.protocol === 'blob:') return req.continue().finally(done)
    if (url.origin === APP) {
      if (url.pathname === '/__previews.html') return reply(200, MIME['.html'], PARENT)
      const body = appFile(files, url.pathname)
      if (!body) return reply(404, 'text/plain', 'not found')
      return reply(200, MIME[path.extname(url.pathname === '/' ? '/index.html' : url.pathname)] || 'application/octet-stream', body)
    }
    if (url.origin === HUB) {
      const a = req.method() === 'GET' ? hubAnswer(url.pathname) : null
      return a ? reply(200, a.type, a.body) : reply(404, 'application/json', '{}')
    }
    net.refused.add(url.origin)
    return req.abort().finally(done)
  })
  page.on('pageerror', (e) => net.errors.push(e.message))
  await page.goto(`${APP}/__previews.html`, { waitUntil: 'load' })
  const frame = await (await page.$('#app')).contentFrame()
  await frame.waitForSelector('.tl-spec-canvas', { timeout: 30000 })
  return { browser, page, frame, net }
}

// Tell the app in the iframe, as the editor does.
function post(page, msg) {
  return page.evaluate((m) => document.getElementById('app').contentWindow.postMessage(m, location.origin), msg)
}

async function settle(page, frame, net, id) {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    if (net.pending === 0 && Date.now() - net.last > 500) break
    await sleep(100)
  }
  await frame.evaluate(() => document.fonts.ready)
  await frame.evaluate(
    (boxId) =>
      Promise.all(
        Array.from(document.querySelectorAll(`[data-panel-id="${boxId}"] img`)).map((img) =>
          img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })
        )
      ),
    id
  )
  // The fitters (shrink to fit, the Home Assistant faces, the flip clock) and
  // the eases (a tile's colour) run in this time; then every animation ends.
  await sleep(1500)
  await frame.evaluate(() => {
    document.getAnimations().forEach((a) => {
      try {
        const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null
        if (t && t.iterations === Infinity) {
          a.pause()
          a.currentTime = 0
        } else {
          a.finish()
        }
      } catch {
        // an animation that cannot be finished is left as it is
      }
    })
  })
  await sleep(300)
}

// --- PNG: a lossless re-encode (RGB when opaque, the best filter per row, zlib 9) --------

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// Chrome's PNG (8-bit RGBA or RGB, not interlaced) -> { w, h, rgba }.
function decodePng(png) {
  let w = 0
  let h = 0
  let type = 0
  const idat = []
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at)
    const kind = png.toString('latin1', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + len)
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unexpected PNG format')
      type = data[9]
    } else if (kind === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0
  if (!bpp) throw new Error(`unexpected PNG colour type ${type}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
      const v = raw[src + x]
      px[y * stride + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255
    }
  }
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    rgba[i * 4] = px[j]
    rgba[i * 4 + 1] = px[j + 1]
    rgba[i * 4 + 2] = px[j + 2]
    rgba[i * 4 + 3] = bpp === 4 ? px[j + 3] : 255
  }
  return { w, h, rgba }
}

function encodePng({ w, h, rgba }) {
  let opaque = true
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) opaque = false
  const bpp = opaque ? 3 : 4
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    px[j] = rgba[i * 4]
    px[j + 1] = rgba[i * 4 + 1]
    px[j + 2] = rgba[i * 4 + 2]
    if (bpp === 4) px[j + 3] = rgba[i * 4 + 3]
  }
  const raw = Buffer.alloc(h * (stride + 1))
  const row = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    let best = null
    let bestSum = Infinity
    for (let f = 0; f < 5; f++) {
      let sum = 0
      for (let x = 0; x < stride; x++) {
        const v = px[y * stride + x]
        const a = x >= bpp ? px[y * stride + x - bpp] : 0
        const b = y > 0 ? px[(y - 1) * stride + x] : 0
        const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
        const o = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 255
        row[x] = o
        sum += o < 128 ? o : 256 - o
      }
      if (sum < bestSum) {
        bestSum = sum
        best = Buffer.concat([Buffer.from([f]), row])
      }
    }
    best.copy(raw, y * (stride + 1))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = opaque ? 2 : 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- The run -----------------------------------------------------------------------------

function gitStamp() {
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    const commit = git('rev-parse', '--short', 'HEAD')
    const dirty = git('status', '--porcelain', '--', 'code/src').length > 0
    return { commit, dirty }
  } catch {
    return { commit: 'unknown', dirty: false }
  }
}

// The draft spec for one type: it alone at its starting box (and a companion
// where it needs one), with a fixed id so reruns send the same spec.
function specFor(app, type) {
  const t = app.panelType(type)
  const props = SAMPLE_PROPS[type] || {}
  const made = t.kind === 'block' ? app.newBlock(type, { props }) : app.newPanel(type, { props }, { layoutId: 'entry' })
  const panel = { ...made, id: t.kind === 'block' ? `${type}-0001` : type }
  const panels = [panel].concat((COMPANIONS[type] || []).map((c) => ({ ...c, z: 0 })))
  return { panel, spec: { version: 2, canvas: { ...CANVAS }, global: { textScale: 1 }, panels } }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    // This file's opening comment.
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1)
    const end = lines.findIndex((l) => !l.startsWith('//'))
    process.stdout.write(`${lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')}\n`)
    return 0
  }
  const puppeteer = await loadPuppeteer(args.puppeteer)
  const app = await import(pathToFileURL(path.join(CODE, 'src/views/TodayLayouts/layoutSpec.js')).href)
  const all = app.PANEL_TYPE_LIST.map((t) => t.type)
  const types = args.only ? args.only.filter((t) => all.includes(t)) : all
  if (args.only && types.length !== args.only.length) {
    throw new Error(`not a type the app knows: ${args.only.filter((t) => !all.includes(t)).join(', ')}`)
  }

  console.log(`building the app in memory (${path.relative(process.cwd(), CODE) || '.'})`)
  const files = await buildApp()
  fs.mkdirSync(args.out, { recursive: true })
  const indexFile = path.join(args.out, 'index.json')
  const previous = args.only && fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null
  const entries = new Map((previous && Array.isArray(previous.files) ? previous.files : []).map((e) => [e.type, e]))

  const { browser, page, frame, net } = await openBoard(puppeteer, files)
  const failed = []
  try {
    await post(page, { type: 'sd-edit:display', display: { entryBackdrop: 'black' } })
    for (const type of types) {
      const { panel, spec } = specFor(app, type)
      const want = spec.panels.map((p) => p.id).sort()
      try {
        await post(page, { type: 'sd-edit:spec', spec, layoutId: 'entry' })
        await frame.waitForFunction(
          (ids) => {
            const got = Array.from(document.querySelectorAll('[data-panel-id]')).map((el) => el.getAttribute('data-panel-id')).sort()
            return got.length === ids.length && got.every((x, i) => x === ids[i])
          },
          { timeout: 10000, polling: 100 },
          want
        )
        await settle(page, frame, net, panel.id)
        const r = await frame.evaluate((id) => {
          const b = document.querySelector(`[data-panel-id="${id}"]`).getBoundingClientRect()
          return { x: b.left, y: b.top, w: b.width, h: b.height }
        }, panel.id)
        // Whole pixels, so the scaled picture is exactly WIDTH wide.
        const x = Math.floor(r.x)
        const y = Math.floor(r.y)
        const w = Math.round(r.x + r.w) - x
        const h = Math.round(r.y + r.h) - y
        const shot = await page.screenshot({ type: 'png', clip: { x, y, width: w, height: h, scale: WIDTH / w } })
        const img = decodePng(Buffer.from(shot))
        const png = encodePng(img)
        fs.writeFileSync(path.join(args.out, `${type}.png`), png)
        entries.set(type, {
          type,
          file: `${type}.png`,
          w: img.w,
          h: img.h,
          bytes: png.length,
          box: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
        })
        console.log(`  ${type.padEnd(12)} ${img.w} x ${String(img.h).padEnd(4)} ${(png.length / 1024).toFixed(1)} KB`)
      } catch (e) {
        failed.push(type)
        console.error(`  ${type.padEnd(12)} FAILED: ${e.message.split('\n')[0]}`)
      }
    }
  } finally {
    await browser.close()
  }

  const stamp = gitStamp()
  const index = {
    what: 'The layout editor Add block menu thumbnails: each block type alone on a 1920x1080 Entry board at the box Add block starts it in, the demo data, cut out 320 px wide',
    made: 'code/scripts/render-previews.mjs',
    commit: stamp.commit,
    dirty: stamp.dirty,
    clock: CLOCK,
    canvas: { ...CANVAS },
    width: WIDTH,
    files: all.filter((t) => entries.has(t)).map((t) => entries.get(t)),
  }
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`)
  if (net.errors.length) console.error(`page errors:\n  ${[...new Set(net.errors)].join('\n  ')}`)
  if (net.refused.size) console.log(`refused (never fetched): ${[...net.refused].join(', ')}`)
  console.log(`${types.length - failed.length} of ${types.length} written to ${path.relative(process.cwd(), args.out) || '.'}; index.json at ${stamp.commit}${stamp.dirty ? ' (with uncommitted changes)' : ''}`)
  if (failed.length) console.error(`failed: ${failed.join(', ')}`)
  return failed.length ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e.message || e)
    process.exit(1)
  }
)
