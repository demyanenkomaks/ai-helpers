import type { ContextRelayBand } from '../types'

/**
 * SVG for the desktop surface: icons on a 16x16 grid, a gauge and a
 * sparkline. Every drawing takes its colour as an argument.
 */
const wrap = (body: string, w = 16, h = 16): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`

export function weatherIcon(band: ContextRelayBand, color: string): string {
  switch (band) {
    case 'clear':
      return wrap(
        `<circle cx="8" cy="8" r="3.2" fill="${color}"/>` +
          `<g stroke="${color}" stroke-width="1.4" stroke-linecap="round">` +
          `<line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/>` +
          `<line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/>` +
          `<line x1="3.1" y1="3.1" x2="4.5" y2="4.5"/><line x1="11.5" y1="11.5" x2="12.9" y2="12.9"/>` +
          `<line x1="3.1" y1="12.9" x2="4.5" y2="11.5"/><line x1="11.5" y1="4.5" x2="12.9" y2="3.1"/></g>`,
      )
    case 'overcast':
      return wrap(
        `<path fill="${color}" d="M4.5 12.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 6a2.75 2.75 0 0 1 .2 5.5z"/>`,
      )
    case 'rain':
      return wrap(
        `<path fill="${color}" d="M4.5 10a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 3.5a2.75 2.75 0 0 1 .2 5.5z"/>` +
          `<g stroke="${color}" stroke-width="1.3" stroke-linecap="round">` +
          `<line x1="5" y1="11.5" x2="4.2" y2="14"/><line x1="8" y1="11.5" x2="7.2" y2="14"/><line x1="11" y1="11.5" x2="10.2" y2="14"/></g>`,
      )
    case 'storm':
      return wrap(
        `<path fill="${color}" d="M4.5 9.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 3a2.75 2.75 0 0 1 .2 5.5z"/>` +
          `<path fill="${color}" d="M8.6 9.5 6 13h2.2l-.8 3 3-4.2H8.2z"/>`,
      )
  }
}

export function clockIcon(color: string): string {
  return wrap(
    `<circle cx="8" cy="8" r="6" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<path d="M8 4.5V8l2.5 1.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`,
  )
}

export function calendarIcon(color: string): string {
  return wrap(
    `<rect x="2" y="3.5" width="12" height="10.5" rx="1.5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<line x1="2" y1="6.5" x2="14" y2="6.5" stroke="${color}" stroke-width="1.5"/>` +
      `<line x1="5" y1="2" x2="5" y2="5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<line x1="11" y1="2" x2="11" y2="5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`,
  )
}

export function boltIcon(color: string): string {
  return wrap(`<path fill="${color}" d="M9.5 1 3.5 9h4l-1 6 6-8h-4z"/>`)
}

export function flameIcon(color: string): string {
  return wrap(
    `<path fill="${color}" d="M8.2 1.5c.4 2.2-1.9 3.3-1.9 5.6 0 .9.4 1.6 1 2-.1-1.4.8-2 1.4-2.6.2 1.6 2.1 2.2 2.1 4.2A3.6 3.6 0 0 1 7.3 14.3 4.3 4.3 0 0 1 3.5 10c0-3.6 3.6-4.4 4.7-8.5z"/>`,
  )
}

export function coinIcon(color: string): string {
  return wrap(
    `<circle cx="8" cy="8" r="6" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<path d="M8 4.2v7.6M10.2 6.2c0-.9-1-1.5-2.2-1.5S5.8 5.3 5.8 6.2c0 2 4.4 1.3 4.4 3.5 0 .9-1 1.6-2.2 1.6s-2.2-.7-2.2-1.6" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>`,
  )
}

export function peopleIcon(color: string): string {
  return wrap(
    `<circle cx="5.5" cy="5" r="2.2" fill="${color}"/><circle cx="11" cy="5.5" r="1.8" fill="${color}"/>` +
      `<path fill="${color}" d="M1.5 13c0-2.6 1.8-4 4-4s4 1.4 4 4zM9.6 13c0-1.6-.5-2.8-1.3-3.6.8-.6 1.7-.9 2.7-.9 1.9 0 3.5 1.3 3.5 3.6z"/>`,
  )
}

export function relayIcon(color: string): string {
  return wrap(
    `<g fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M2.5 5.5h9.5M9.5 3l2.5 2.5L9.5 8"/><path d="M13.5 10.5H4M6.5 8 4 10.5 6.5 13"/></g>`,
  )
}

export const GAUGE = { width: 54, height: 9 } as const

/**
 * A rounded track with the used share filled in the tone's colour; where
 * usage runs ahead of the clock, the part past the elapsed share is drawn
 * lighter so the lead is visible.
 */
export function gaugeSvg(
  usedPercent: number,
  elapsedPercent: number | null,
  color: string,
): string {
  const { width: w, height: h } = GAUGE
  const clamp = (n: number) => Math.max(0, Math.min(100, n))
  const used = (clamp(usedPercent) / 100) * w
  const elapsed = elapsedPercent === null ? used : (clamp(elapsedPercent) / 100) * w
  const solid = Math.min(used, elapsed)
  const ahead = used > elapsed ? used - elapsed : 0
  const r = h / 2
  const body =
    `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="rgba(127,127,127,0.2)"/>` +
    (solid > 0
      ? `<rect x="0" y="0" width="${solid.toFixed(1)}" height="${h}" rx="${r}" fill="${color}"/>`
      : '') +
    (ahead > 0
      ? `<rect x="${solid.toFixed(1)}" y="0" width="${ahead.toFixed(1)}" height="${h}" fill="${color}" opacity="0.45"/>`
      : '')
  return wrap(body, w, h)
}

export const SPARK = { width: 40, height: 10 } as const

/** One bar per recent turn, scaled to the fullest; the latest in the colour given. */
export function sparklineSvg(deltas: readonly number[], color: string): string {
  const { width: w, height: h } = SPARK
  const n = Math.max(1, deltas.length)
  const max = Math.max(1, ...deltas)
  const slot = w / n
  const bars = deltas
    .map((d, i) => {
      const barH = Math.max(1, Math.round((Math.max(0, d) / max) * h))
      const x = (i * slot + slot * 0.15).toFixed(1)
      const bw = Math.max(1, slot * 0.7).toFixed(1)
      const fill = i === deltas.length - 1 ? color : 'rgba(127,127,127,0.45)'
      return `<rect x="${x}" y="${h - barH}" width="${bw}" height="${barH}" rx="1" fill="${fill}"/>`
    })
    .join('')
  return wrap(bars, w, h)
}
