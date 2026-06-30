// gen-icons.mjs — dependency-free generator for the Ghost Companion app + tray icons.
//
// Renders the in-app "Ghost" mark (concentric diamonds + center dot, brand blue
// #38AACE) so the installer/exe icon, window icon, and system-tray icon all share
// one identity. Pure Node: rasterizes the mark with supersampled anti-aliasing,
// encodes PNGs via zlib, and packs a multi-size Windows .ico (PNG-compressed
// entries, Vista+).
//
//   node scripts/gen-icons.mjs
//
// Outputs:
//   build/icon.ico     — dark rounded tile + blue mark (electron-builder NSIS/exe)
//   build/icon.png     — 512px master (handy reference / fallback)
//   resources/tray.png — 32px blue mark on transparent (system tray + window icon)

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ---- palette (matches GhostCompanion.jsx `C`) ----
const TILE = [5, 8, 15]       // #05080F app background
const BLUE = [56, 170, 206]   // #38AACE brand blue
const WHITE = [255, 255, 255]
const SQRT1_2 = Math.SQRT1_2  // 0.7071 — L1→perpendicular stroke conversion

// straight-alpha "over": src over acc, all channels 0..1
function over(acc, sr, sg, sb, sa) {
  if (sa <= 0) return acc
  const a = sa + acc[3] * (1 - sa)
  if (a <= 0) return [0, 0, 0, 0]
  const r = (sr * sa + acc[0] * acc[3] * (1 - sa)) / a
  const g = (sg * sa + acc[1] * acc[3] * (1 - sa)) / a
  const b = (sb * sa + acc[2] * acc[3] * (1 - sa)) / a
  return [r, g, b, a]
}

// rounded-rect signed distance (negative inside), box [0..N]² corner radius rad
function roundRectSdf(x, y, N, rad) {
  const qx = Math.abs(x - N / 2) - (N / 2 - rad)
  const qy = Math.abs(y - N / 2) - (N / 2 - rad)
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rad
}

// color (straight rgba 0..1) at one sub-sample point in icon space
function sampleColor(x, y, opts) {
  const { N, tile, markFrac, fillOpacity, outerStroke } = opts
  let acc = [0, 0, 0, 0]

  // dark rounded tile (app icon only)
  if (tile) {
    const rad = N * 0.22
    const sdf = roundRectSdf(x, y, N, rad)
    if (sdf < 0) acc = over(acc, TILE[0] / 255, TILE[1] / 255, TILE[2] / 255, 1)
    // faint blue rim so the dark tile reads on dark taskbars
    const rim = N * 0.018
    if (Math.abs(sdf) <= rim && sdf < rim) {
      acc = over(acc, BLUE[0] / 255, BLUE[1] / 255, BLUE[2] / 255, 0.32 * (1 - Math.abs(sdf) / rim))
    }
  }

  // map icon-space px → 32-unit viewBox of the Ghost mark, centered with margin
  const markSize = N * markFrac
  const off = (N - markSize) / 2
  const scale = markSize / 32
  const vx = (x - off) / scale
  const vy = (y - off) / scale
  const dx = vx - 16, dy = vy - 16
  const s = Math.abs(dx) + Math.abs(dy)        // L1 distance (diamond level)
  const bR = BLUE[0] / 255, bG = BLUE[1] / 255, bB = BLUE[2] / 255

  // layers, in the SVG's paint order
  // 1. outer diamond outline (level 14, strokeWidth outerStroke)
  if (Math.abs(s - 14) <= outerStroke * SQRT1_2) acc = over(acc, bR, bG, bB, 1)
  // 2. mid diamond fill (level 10)
  if (s <= 10) acc = over(acc, bR, bG, bB, fillOpacity)
  // 3. inner diamond outline (level 6, strokeWidth 0.8)
  if (Math.abs(s - 6) <= 0.8 * SQRT1_2) acc = over(acc, bR, bG, bB, 0.5)
  // 4. center dot (r 2.8)
  if (dx * dx + dy * dy <= 2.8 * 2.8) acc = over(acc, bR, bG, bB, 1)
  // 5. highlight (r 1.2, white)
  if (dx * dx + dy * dy <= 1.2 * 1.2) acc = over(acc, WHITE[0] / 255, WHITE[1] / 255, WHITE[2] / 255, 0.6)

  return acc
}

// render an RGBA buffer at size N with SS×SS supersampling
function render(N, opts) {
  const SS = 4
  const buf = Buffer.alloc(N * N * 4)
  const o = { ...opts, N }
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let sr = 0, sg = 0, sb = 0, sa = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          const [r, g, b, a] = sampleColor(x, y, o)
          sr += r * a; sg += g * a; sb += b * a; sa += a  // premultiplied
        }
      }
      const cnt = SS * SS
      const A = sa / cnt
      const i = (py * N + px) * 4
      if (A > 0) {
        buf[i] = Math.round((sr / sa) * 255)
        buf[i + 1] = Math.round((sg / sa) * 255)
        buf[i + 2] = Math.round((sb / sa) * 255)
      }
      buf[i + 3] = Math.round(A * 255)
    }
  }
  return buf
}

// ---- PNG encoding ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function encodePng(N, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4)
  ihdr[8] = 8; ihdr[9] = 6  // 8-bit, RGBA
  const raw = Buffer.alloc(N * (N * 4 + 1))
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0  // filter: none
    rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- ICO encoding (PNG-compressed entries) ----
function encodeIco(images) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const im of images) {
    const e = Buffer.alloc(16)
    e[0] = im.size >= 256 ? 0 : im.size
    e[1] = im.size >= 256 ? 0 : im.size
    e[2] = 0; e[3] = 0
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(im.png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += im.png.length
    entries.push(e)
  }
  return Buffer.concat([head, ...entries, ...images.map(i => i.png)])
}

// ---- build ----
const buildDir = path.join(ROOT, 'build')
fs.mkdirSync(buildDir, { recursive: true })

// app icon: dark tile + mark, full size range for the .ico
const appOpts = { tile: true, markFrac: 0.60, fillOpacity: 0.12, outerStroke: 1.5 }
const icoSizes = [256, 128, 64, 48, 32, 16]
const icoImages = icoSizes.map(size => ({ size, png: encodePng(size, render(size, appOpts)) }))
fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeIco(icoImages))
fs.writeFileSync(path.join(buildDir, 'icon.png'), encodePng(512, render(512, appOpts)))

// tray/window icon: transparent bg, mark only — bolder so it reads at 16–32px
const trayOpts = { tile: false, markFrac: 0.86, fillOpacity: 0.22, outerStroke: 2.0 }
fs.writeFileSync(path.join(ROOT, 'resources', 'tray.png'), encodePng(32, render(32, trayOpts)))

console.log('icons written:')
console.log('  build/icon.ico     ', icoSizes.join('/'), 'px')
console.log('  build/icon.png      512px')
console.log('  resources/tray.png  32px')
