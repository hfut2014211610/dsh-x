// Generates the desktop shell's icons (build/icon.png 1024px, assets/tray.png
// 32px) from signed-distance fields with supersampling — no binary design
// tool needed, and the visual is reviewable in code. Run from apps/desktop:
//   node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** PNG encoder (RGBA8, filter 0). */
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xFFFFFFFF
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = []
  for (let y = 0; y < size; y += 1) rows.push(Buffer.from([0, ...rgba.subarray(y * size * 4, (y + 1) * size * 4)]))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Rounded-box SDF in unit space: `half` = half extent, `radius` = corner radius. */
function roundedBox(x, y, half, radius) {
  return roundedExtentBox(x, y, half, half, radius)
}

/** Rounded-box SDF with independent half extents — capsules need `hy << hx`. */
function roundedExtentBox(x, y, hx, hy, radius) {
  const qx = Math.abs(x) - (hx - radius)
  const qy = Math.abs(y) - (hy - radius)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius
}

/** One diagonal bar of the X, centered, rotated to `angle`. */
function bar(px, py, angle, halfLen, thickness) {
  const c = Math.cos(-angle)
  const s = Math.sin(-angle)
  const x = px * c - py * s
  const y = px * s + py * c
  return roundedExtentBox(x, y, halfLen, thickness / 2, thickness / 2)
}

const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
const hex = value => [(value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF]
const mix = ([r1, g1, b1], [r2, g2, b2], t) => [lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t)]

/** Gradient stops: bright periwinkle over deep indigo, diagonal. */
const TOP = hex(0x8FB0FF)
const BOTTOM = hex(0x2440C8)
const X_SHADOW = hex(0x14267A)

/** Renders `size`×`size` RGBA with `ss`× supersampling. */
function render(size, ss) {
  const big = size * ss
  const out = Buffer.alloc(size * size * 4)
      const halfLen = 0.315
      const thickness = 0.072
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const px = ((x * ss + sx + 0.5) / big) - 0.5
          const py = ((y * ss + sy + 0.5) / big) - 0.5
          const plate = roundedBox(px, py, 0.44, 0.115)
          const plateA = 1 - smoothstep(-1 / big, 1 / big, plate)
          if (plateA === 0) continue
          // Diagonal gradient plus a soft gloss from the upper left.
          const grad = Math.min(Math.max(px + py + 1, 0), 2) / 2
          let color = mix(TOP, BOTTOM, grad)
          const gloss = (1 - smoothstep(0, 0.55, Math.hypot(px + 0.14, py + 0.18))) * 0.16
          color = mix(color, [255, 255, 255], gloss)
          // A thin inner edge light keeps the plate from looking flat.
          const rim = (1 - smoothstep(0.004, 0.016, Math.abs(plate + 0.016))) * 0.22
          color = mix(color, [255, 255, 255], rim)
          // The X: soft drop shadow beneath, then the white bars.
          const shadow = bar(px - 0.006, py - 0.008, Math.PI / 4, halfLen, thickness)
          const mark = Math.min(
            bar(px, py, Math.PI / 4, halfLen, thickness),
            bar(px, py, -Math.PI / 4, halfLen, thickness),
          )
          const shadowA = (1 - smoothstep(-1 / big, 1 / big, shadow)) * 0.45
          color = mix(color, X_SHADOW, shadowA)
          const markA = 1 - smoothstep(-1 / big, 1 / big, mark)
          color = mix(color, [255, 255, 255], markA)
          r += color[0] * plateA
          g += color[1] * plateA
          b += color[2] * plateA
          a += plateA * 255
        }
      }
      const samples = ss * ss
      const o = (y * size + x) * 4
      out[o] = Math.round(r / samples)
      out[o + 1] = Math.round(g / samples)
      out[o + 2] = Math.round(b / samples)
      out[o + 3] = Math.round(a / samples)
    }
  }
  return out
}

mkdirSync(join(here, '..', 'build'), { recursive: true })
mkdirSync(join(here, '..', 'assets'), { recursive: true })
writeFileSync(join(here, '..', 'build', 'icon.png'), encodePng(1024, render(1024, 3)))
writeFileSync(join(here, '..', 'assets', 'tray.png'), encodePng(32, render(32, 4)))
console.log('icons written: build/icon.png (1024), assets/tray.png (32)')
