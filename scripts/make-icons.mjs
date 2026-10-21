/**
 * Renders every icon and splash asset the web app and the Android build need.
 *
 * The web app's icons — the browser tab, the home-screen and install icons —
 * are cut from the logo, themes/hanzai-origins-logo.png.
 *
 * The Android launcher and splash still use the earlier mark — a brush-stroke
 * 汉 on cinnabar — drawn from geometry rather than a font, so the output does
 * not depend on which typefaces happen to be installed on the machine
 * running the build.
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'

const CINNABAR = [0xf4, 0x55, 0x2e]
/* The splash ground is the page's default ground (Gruvbox bg0_h), so the
   launch goes splash → first paint with no change of colour under the mark. */
const INK = [0x1d, 0x20, 0x21]
const WHITE = [0xff, 0xff, 0xff]

/** Strokes of 汉 in a 100×100 design box: 氵 on the left, 又 on the right. */
const STROKES = [
  { a: [20, 30], b: [26, 36], w: 7 },
  { a: [16, 48], b: [22, 54], w: 7 },
  { a: [20, 72], b: [27, 66], w: 7 },
  { a: [44, 30], b: [86, 30], w: 8 },
  { a: [58, 30], b: [40, 78], w: 8 },
  { a: [52, 46], b: [84, 78], w: 8 },
]

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * @param {object} opts
 * @param {'rounded'|'circle'|'none'} opts.shape  Silhouette of the tile.
 * @param {number[]|null} opts.bg                 Tile colour, or null for transparency.
 * @param {number[]} opts.fg                      Stroke colour.
 * @param {number} opts.mark                      Fraction of the canvas the mark occupies.
 */
function render(width, height, { shape = 'rounded', bg = CINNABAR, fg = WHITE, mark = 1 } = {}) {
  const pixels = Buffer.alloc(width * height * 4)
  const side = Math.min(width, height)
  const radius = shape === 'circle' ? side / 2 : side * 0.22
  const markSize = side * mark
  const offX = (width - markSize) / 2
  const offY = (height - markSize) / 2
  const scale = markSize / 100

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const px = x + 0.5
      const py = y + 0.5

      const tile = shape === 'none' ? 1 : coverage(px, py, width, height, radius)

      let ink = 0
      for (const s of STROKES) {
        const d = distToSegment((px - offX) / scale, (py - offY) / scale, s.a, s.b)
        ink = Math.max(ink, clamp01((s.w / 2 - d) * scale + 0.5))
      }

      const alpha = bg ? tile : ink * tile
      if (alpha <= 0) continue
      for (let c = 0; c < 3; c++) {
        pixels[i + c] = bg ? Math.round(bg[c] * (1 - ink) + fg[c] * ink) : fg[c]
      }
      pixels[i + 3] = Math.round(255 * alpha)
    }
  }
  return png(width, height, pixels)
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))

function coverage(px, py, w, h, r) {
  const cx = Math.min(Math.max(px, r), w - r)
  const cy = Math.min(Math.max(py, r), h - r)
  return clamp01(r - Math.hypot(px - cx, py - cy) + 0.5)
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4 + 1
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function emit(path, buf) {
  writeFileSync(path, buf)
  console.log(`  ${path}`)
}

// ------------------------------------------------------------------ the logo
/* The browser tab and the install icons are the logo itself. It is a large
   painting on a transparent ground, so it is read here, cropped to what is
   drawn on it, and scaled down by area: each pixel of a small icon is the
   average of the logo under it, not one sample of it, which is what keeps a
   16-pixel favicon from turning to noise. */
const LOGO = 'themes/hanzai-origins-logo.png'
// The cream of the logo's disc: the ground for the icons that must be opaque.
const PAPER = [0xfa, 0xf1, 0xe5]

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** An 8-bit RGB or RGBA PNG, not interlaced, as RGBA. */
function readPng(path) {
  const buf = readFileSync(path)
  let width = 0
  let height = 0
  let channels = 0
  const idat = []
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0) {
        throw new Error(`${path}: expected an 8-bit RGB or RGBA PNG, not interlaced`)
      }
      channels = data[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0
      line[x] = (line[x] + add) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) rgba[o + c] = line[x * channels + c]
      rgba[o + 3] = channels === 4 ? line[x * channels + 3] : 255
    }
    prev = line
  }
  return { width, height, rgba }
}

/**
 * The square of the logo that holds everything drawn on it, plus a margin.
 * The painting's ground is not quite clean: a haze of near-zero alpha runs
 * out to the edges, and its solid parts are 99% opaque. Both are snapped
 * here, the haze to nothing and the solid parts to solid.
 */
function inkSquare(img, margin) {
  const { width, height, rgba } = img
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4 + 3
      if (rgba[o] <= 8) rgba[o] = 0
      else if (rgba[o] >= 250) rgba[o] = 255
      if (!rgba[o]) continue
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) * (1 + 2 * margin)
  return { x: (x0 + x1 + 1 - side) / 2, y: (y0 + y1 + 1 - side) / 2, side }
}

/**
 * The square `box` of the image scaled to n×n by area, with colour weighted
 * by alpha so the transparent ground does not darken the edges. Separable:
 * across each row, then down each column. Returns premultiplied RGBA, colour
 * 0–255 and alpha 0–1; anything outside the image counts as transparent.
 */
function shrink({ width, height, rgba }, box, n) {
  const k = box.side / n
  const spans = (from) => {
    const out = []
    for (let d = 0; d < n; d++) {
      const a = from + d * k
      const b = a + k
      const cells = []
      for (let s = Math.floor(a); s < Math.ceil(b); s++) cells.push([s, Math.min(b, s + 1) - Math.max(a, s)])
      out.push(cells)
    }
    return out
  }
  const across = spans(box.x)
  const down = spans(box.y)
  const rows0 = Math.floor(box.y)
  const rows = Math.ceil(box.y + box.side) - rows0
  const mid = new Float64Array(rows * n * 4)
  for (let r = 0; r < rows; r++) {
    const y = rows0 + r
    if (y < 0 || y >= height) continue
    for (let d = 0; d < n; d++) {
      const t = (r * n + d) * 4
      for (const [x, w] of across[d]) {
        if (x < 0 || x >= width) continue
        const o = (y * width + x) * 4
        const a = (rgba[o + 3] / 255) * w
        mid[t] += rgba[o] * a
        mid[t + 1] += rgba[o + 1] * a
        mid[t + 2] += rgba[o + 2] * a
        mid[t + 3] += a
      }
    }
  }
  const out = new Float64Array(n * n * 4)
  for (let dy = 0; dy < n; dy++) {
    for (let d = 0; d < n; d++) {
      const t = (dy * n + d) * 4
      for (const [y, w] of down[dy]) {
        const m = ((y - rows0) * n + d) * 4
        for (let c = 0; c < 4; c++) out[t + c] += mid[m + c] * w
      }
      for (let c = 0; c < 4; c++) out[t + c] /= k * k
    }
  }
  return out
}

/**
 * The logo as a size×size icon: `fill` is how much of the side it spans,
 * centred; `ground` an opaque colour under it, or null to keep the
 * transparency.
 */
function logoIcon(img, box, size, { fill = 1, ground = null } = {}) {
  const n = Math.round(size * fill)
  const art = shrink(img, box, n)
  const off = Math.floor((size - n) / 2)
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const ax = x - off
      const ay = y - off
      const t = (ay * n + ax) * 4
      const inside = ax >= 0 && ay >= 0 && ax < n && ay < n
      const a = inside ? Math.min(1, art[t + 3]) : 0
      if (ground) {
        for (let c = 0; c < 3; c++) px[o + c] = Math.round((inside ? art[t + c] : 0) + ground[c] * (1 - a))
        px[o + 3] = 255
      } else if (a > 0) {
        for (let c = 0; c < 3; c++) px[o + c] = Math.round(Math.min(255, art[t + c] / a))
        px[o + 3] = Math.round(a * 255)
      }
    }
  }
  return png(size, size, px)
}

/** An .ico holding PNGs, the form every browser since 2010 reads. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(([size, data], i) => {
    const e = 6 + 16 * i
    head[e] = size >= 256 ? 0 : size
    head[e + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map(([, data]) => data)])
}

// ------------------------------------------------------------------ web / PWA
console.log('Web icons, from ' + LOGO)
mkdirSync('app/icons', { recursive: true })
const logo = readPng(LOGO)
// Tight for the tab, where every pixel counts; a little air for the rest.
const tight = inkSquare(logo, 0)
const roomy = inkSquare(logo, 0.03)
const tab = [16, 32, 48].map((s) => [s, logoIcon(logo, tight, s)])
emit('app/icons/favicon.ico', ico(tab))
emit('app/icons/favicon-16.png', tab[0][1])
emit('app/icons/favicon-32.png', tab[1][1])
// iOS fills transparency with black and rounds the corners itself.
emit('app/icons/apple-touch-icon.png', logoIcon(logo, roomy, 180, { fill: 0.9, ground: PAPER }))
emit('app/icons/icon-192.png', logoIcon(logo, roomy, 192))
emit('app/icons/icon-512.png', logoIcon(logo, roomy, 512))
// A maskable icon is cut to the launcher's shape, anything down to a circle
// 80% across, so the logo sits inside that on a ground of its own paper.
emit('app/icons/icon-maskable.png', logoIcon(logo, roomy, 512, { fill: 0.72, ground: PAPER }))
// The old drawn mark, from before there was a logo, would otherwise still be
// the tab icon wherever a browser prefers SVG.
if (existsSync('app/icons/favicon.svg')) rmSync('app/icons/favicon.svg')

// ------------------------------------------------------------------- Android
const RES = 'android/app/src/main/res'
if (!existsSync(RES)) {
  console.log('\nAndroid project not present — skipping native assets (npx cap add android).')
  process.exit(0)
}

console.log('\nAndroid launcher icons')
// Legacy launcher sizes, and the 108dp adaptive foreground for each density.
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]
for (const [density, legacy, adaptive] of DENSITIES) {
  const dir = `${RES}/mipmap-${density}`
  mkdirSync(dir, { recursive: true })
  emit(`${dir}/ic_launcher.png`, render(legacy, legacy, { mark: 1 }))
  emit(`${dir}/ic_launcher_round.png`, render(legacy, legacy, { shape: 'circle', mark: 1 }))
  // Adaptive foregrounds are cropped hard, so the mark sits inside the safe zone.
  emit(
    `${dir}/ic_launcher_foreground.png`,
    render(adaptive, adaptive, { shape: 'none', bg: null, mark: 0.52 }),
  )
}

writeFileSync(
  `${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#F4552E</color>
</resources>
`,
)
console.log(`  ${RES}/values/ic_launcher_background.xml`)

console.log('\nAndroid splash screens')
// Portrait and landscape splash bitmaps for each density.
const SPLASH = [
  ['mdpi', 320, 480],
  ['hdpi', 480, 800],
  ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600],
  ['xxxhdpi', 1280, 1920],
]
for (const [density, w, h] of SPLASH) {
  for (const [orientation, width, height] of [
    ['port', w, h],
    ['land', h, w],
  ]) {
    const dir = `${RES}/drawable-${orientation}-${density}`
    mkdirSync(dir, { recursive: true })
    emit(`${dir}/splash.png`, render(width, height, { shape: 'none', bg: INK, mark: 0.28 }))
  }
}
mkdirSync(`${RES}/drawable`, { recursive: true })
emit(`${RES}/drawable/splash.png`, render(720, 1280, { shape: 'none', bg: INK, mark: 0.28 }))
