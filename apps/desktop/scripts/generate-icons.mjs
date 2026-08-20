// Generates the desktop shell's icons (build/icon.png 1024px, assets/tray.png
// 32px) from the product mark — the whale path of website/public/favicon.svg,
// parsed and scanline-filled with supersampling, so no binary design tool is
// needed and the visual is reviewable in code. Run from apps/desktop:
//   node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

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

/** The mark: the favicon's single path (M/C/Z only), in its 50×50 viewBox. */
function markPath() {
  const svg = readFileSync(join(repoRoot, 'website', 'public', 'favicon.svg'), 'utf8')
  const d = /d="([^"]+)"/.exec(svg)?.[1]
  const fill = /<path[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(svg)?.[1]
  if (d === undefined || fill === undefined) throw new Error('favicon.svg no longer carries one filled path')
  const commands = new Set(d.match(/[A-Za-z]/g) ?? [])
  for (const command of commands) {
    if (command !== 'M' && command !== 'C' && command !== 'Z') {
      throw new Error(`favicon.svg grew a path command this rasterizer does not read: ${command}`)
    }
  }
  return { d, fill }
}

/** Parse the M/C/Z path into subpaths of flattened polylines. */
function parseSubpaths(d) {
  const tokens = d.match(/[MCZ]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []
  const subpaths = []
  let polyline = []
  let cursor = { x: 0, y: 0 }
  let start = { x: 0, y: 0 }
  let index = 0
  const number = () => Number(tokens[index += 1])
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === 'M') {
      if (polyline.length > 0) subpaths.push(polyline)
      cursor = { x: number(), y: number() }
      start = cursor
      polyline = [cursor]
    } else if (token === 'C') {
      const c1 = { x: number(), y: number() }
      const c2 = { x: number(), y: number() }
      const end = { x: number(), y: number() }
      // Fixed 32 subdivisions: the mark is rendered at ≥32px, so a segment is
      // always shorter than a pixel step's supersample budget.
      for (let step = 1; step <= 32; step += 1) {
        const t = step / 32
        const u = 1 - t
        polyline.push({
          x: u * u * u * cursor.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * cursor.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        })
      }
      cursor = end
    } else if (token === 'Z') {
      polyline.push(start)
      cursor = start
    }
    index += 1
  }
  if (polyline.length > 0) subpaths.push(polyline)
  return subpaths
}

/**
 * Render `size`×`size` RGBA with `ss`× supersampling: the mark centered at
 * `scale` of the canvas, nonzero-winding filled, on full transparency.
 */
function render(size, ss, scale, subpaths, fill) {
  const [fr, fg, fb] = [parseInt(fill.slice(1, 3), 16), parseInt(fill.slice(3, 5), 16), parseInt(fill.slice(5, 7), 16)]
  const big = size * ss
  const out = Buffer.alloc(size * size * 4)
  // The viewBox is 50 units; `scale * size` pixels of canvas map onto it.
  const pixelPerUnit = (scale * big) / 50
  const origin = (big - scale * big) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const pointX = origin + (x * ss + sx + 0.5) / pixelPerUnit
          const pointY = origin + (y * ss + sy + 0.5) / pixelPerUnit
          // Nonzero winding: accumulate signed crossings over every subpath.
          let winding = 0
          for (const polyline of subpaths) {
            for (let i = 0; i < polyline.length - 1; i += 1) {
              const a = polyline[i]
              const b = polyline[i + 1]
              if (a.y <= pointY) {
                if (b.y > pointY && (b.x - a.x) * (pointY - a.y) - (pointX - a.x) * (b.y - a.y) > 0) winding += 1
              } else if (b.y <= pointY && (b.x - a.x) * (pointY - a.y) - (pointX - a.x) * (b.y - a.y) < 0) {
                winding -= 1
              }
            }
          }
          if (winding !== 0) hits += 1
        }
      }
      if (hits > 0) {
        const o = (y * size + x) * 4
        out[o] = fr
        out[o + 1] = fg
        out[o + 2] = fb
        out[o + 3] = Math.round((hits / (ss * ss)) * 255)
      }
    }
  }
  return out
}

const { d, fill } = markPath()
const subpaths = parseSubpaths(d)
mkdirSync(join(here, '..', 'build'), { recursive: true })
mkdirSync(join(here, '..', 'assets'), { recursive: true })
writeFileSync(join(here, '..', 'build', 'icon.png'), encodePng(1024, render(1024, 2, 0.92, subpaths, fill)))
writeFileSync(join(here, '..', 'assets', 'tray.png'), encodePng(32, render(32, 4, 0.9, subpaths, fill)))
console.log('icons written from the favicon mark: build/icon.png (1024), assets/tray.png (32)')
