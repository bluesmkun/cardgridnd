// Draws the 180x180 home-screen icon iOS demands, with no image library: a PNG is
// a zlib stream of filtered scanlines, and zlib is in Node's standard library.
// iOS only reads PNG here and fills transparency with black, so the icon is
// opaque. Everything comes from the theme's own palette so it cannot drift.
//
// `preview.png`, the panel's preview card, is not drawn here: it is a real
// screenshot of the built theme, which shows the actual thing rather than an
// approximation of it. See the README for how to retake it.
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** `pixels` is RGBA, row-major, `width * height * 4` bytes. */
function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10-12 stay zero: deflate, adaptive filtering, no interlace.
  // One filter byte per scanline, all zero (None): these images are flat enough
  // that the extra pass of a real filter would not pay for itself.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// --- a tiny painter ---------------------------------------------------------

function canvas(width, height) {
  return { width, height, px: Buffer.alloc(width * height * 4, 255) }
}

/** Alpha-composites `colour` (each 0-1, alpha 0-1) over the pixel at `x, y`. */
function blend(img, x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height || a <= 0) return
  const i = (y * img.width + x) * 4
  img.px[i] = img.px[i] + (r * 255 - img.px[i]) * a
  img.px[i + 1] = img.px[i + 1] + (g * 255 - img.px[i + 1]) * a
  img.px[i + 2] = img.px[i + 2] + (b * 255 - img.px[i + 2]) * a
  img.px[i + 3] = 255
}

const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255]

/** Anti-aliased coverage of a shape given as a signed distance, in pixels. */
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d))

function fill(img, colour) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) blend(img, x, y, colour, 1)
}

/** An axis-aligned rectangle given by its two corners, in pixels. */
function rect(img, x0, y0, x1, y1, colour, alpha = 1) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      // Distance to the nearest edge, negative inside: one expression handles
      // both the body and the anti-aliased border without a second pass.
      const d = Math.max(x0 - (x + 0.5), (x + 0.5) - x1, y0 - (y + 0.5), (y + 0.5) - y1)
      blend(img, x, y, colour, cover(d) * alpha)
    }
  }
}

/** A stroked line of `width` pixels between two points. */
function line(img, x0, y0, x1, y1, width, colour, alpha = 1) {
  const half = width / 2
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  for (let y = Math.floor(Math.min(y0, y1) - half - 1); y <= Math.ceil(Math.max(y0, y1) + half + 1); y++) {
    for (let x = Math.floor(Math.min(x0, x1) - half - 1); x <= Math.ceil(Math.max(x0, x1) + half + 1); x++) {
      const px = x + 0.5 - x0
      const py = y + 0.5 - y0
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
      const d = Math.hypot(px - dx * t, py - dy * t) - half
      blend(img, x, y, colour, cover(d) * alpha)
    }
  }
}

function disc(img, cx, cy, radius, colour, alpha = 1) {
  for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y++) {
    for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius
      blend(img, x, y, colour, cover(d) * alpha)
    }
  }
}

// --- the icon ---------------------------------------------------------------

/**
 * The mark: the card, in miniature.
 *
 * The theme itself has no logo -- it is a page of white ruled by hairlines -- so
 * the icon is that page: a white sheet carrying the three things every card on
 * the site repeats, a status dot, a name and a column of meters. Drawn at
 * `size` with every dimension proportional, so it reads the same at 180px and in
 * a 32px browser tab.
 *
 * The ground behind the sheet is opaque and slightly grey rather than
 * transparent: iOS fills transparency with black, and a black square on the home
 * screen is not what this theme is. The sheet is inset from the edge so the
 * hairline survives the corner rounding iOS applies at a radius no CSS predicts.
 */
function draw(size) {
  const img = canvas(size, size)
  const u = size / 180

  fill(img, hex("#f4f5f7"))

  // The sheet, as a rounded rectangle: two crossed rectangles for the body and
  // four discs for the corners. No arc maths, and no aliasing seam where the two
  // shapes meet, because they overlap rather than abut.
  const inset = 16 * u
  const radius = 13 * u
  const x0 = inset
  const y0 = inset
  const x1 = size - inset
  const y1 = size - inset
  rect(img, x0, y0 + radius, x1, y1 - radius, hex("#ffffff"))
  rect(img, x0 + radius, y0, x1 - radius, y1, hex("#ffffff"))
  for (const [cx, cy] of [
    [x0 + radius, y0 + radius],
    [x1 - radius, y0 + radius],
    [x0 + radius, y1 - radius],
    [x1 - radius, y1 - radius],
  ]) {
    disc(img, cx, cy, radius, hex("#ffffff"))
  }

  // The hairline border -- the whole visual idea of the theme, and the reason
  // the sheet needs no shadow to be visible.
  const h = 1.5 * u
  const edge = hex("#d6dae1")
  line(img, x0 + radius, y0, x1 - radius, y0, h, edge)
  line(img, x0 + radius, y1, x1 - radius, y1, h, edge)
  line(img, x0, y0 + radius, x0, y1 - radius, h, edge)
  line(img, x1, y0 + radius, x1, y1 - radius, h, edge)
  for (const [cx, cy, sx, sy] of [
    [x0 + radius, y0 + radius, -1, -1],
    [x1 - radius, y0 + radius, 1, -1],
    [x0 + radius, y1 - radius, -1, 1],
    [x1 - radius, y1 - radius, 1, 1],
  ]) {
    // The four corner arcs, drawn as a dense fan of points rather than a ring,
    // so only the quarter facing out of the sheet is stroked.
    const steps = Math.ceil((Math.PI / 2) * radius)
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2)
      const px = cx + sx * radius * Math.cos(a)
      const py = cy + sy * radius * Math.sin(a)
      rect(img, px - h / 2, py - h / 2, px + h / 2, py + h / 2, edge)
    }
  }

  // Card head: the status dot, the name, the country tag.
  const pad = 20 * u
  const dotY = y0 + 30 * u
  disc(img, x0 + pad + 5 * u, dotY, 5 * u, hex("#15803d"))
  rect(img, x0 + pad + 18 * u, dotY - 4 * u, x0 + pad + 64 * u, dotY + 4 * u, hex("#16181d"))
  rect(img, x1 - pad - 22 * u, dotY - 4 * u, x1 - pad, dotY + 4 * u, hex("#c9ced8"))

  // The rule under the head: one line, doing the work a box would do.
  const ruleY = dotY + 20 * u
  line(img, x0 + pad, ruleY, x1 - pad, ruleY, h, hex("#e8eaee"))

  // Three meters -- the default card -- each a label, a track, a fill, a figure.
  const meterTop = ruleY + 22 * u
  const gap = 32 * u
  const labelX = x0 + pad
  const trackX0 = x0 + pad + 32 * u
  const trackX1 = x1 - pad - 32 * u
  const fills = [0.42, 0.68, 0.31]
  // The third meter is the one over its quota in the sample data, so it carries
  // the warning tone: an icon that shows only the healthy state teaches the
  // reader nothing about what this page does.
  const tones = [hex("#16181d"), hex("#16181d"), hex("#b45309")]
  for (let i = 0; i < 3; i++) {
    const y = meterTop + i * gap
    rect(img, labelX, y - 3.5 * u, labelX + 22 * u, y + 3.5 * u, hex("#8b909c"))
    rect(img, trackX0, y - 2 * u, trackX1, y + 2 * u, hex("#e8eaee"))
    rect(img, trackX0, y - 2 * u, trackX0 + (trackX1 - trackX0) * fills[i], y + 2 * u, tones[i])
    rect(img, x1 - pad - 28 * u, y - 3.5 * u, x1 - pad, y + 3.5 * u, hex("#5c6270"))
  }

  return img
}

// --- write ------------------------------------------------------------------

mkdirSync(join(ROOT, "public"), { recursive: true })
const icon = draw(180)
writeFileSync(join(ROOT, "public", "apple-touch-icon.png"), png(icon.width, icon.height, icon.px))
console.log("wrote public/apple-touch-icon.png (180x180)")
