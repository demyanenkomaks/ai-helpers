import type { ContextRelayBand } from '../types'

/** The three rising boundaries between the four bands, in tokens. */
export type Bands = readonly [number, number, number]

export const DEFAULT_BANDS: Bands = [100_000, 250_000, 350_000]

/**
 * Reads the `bands` setting ("100000,250000,350000"). Anything that is not
 * three rising positive numbers falls back to the defaults.
 */
export function parseBands(text: unknown): Bands {
  if (typeof text !== 'string') return DEFAULT_BANDS
  const parts = text
    .split(/[,\s;]+/)
    .filter(part => part.length > 0)
    .map(part => Number(part.replace(/[_']/g, '')))
  if (parts.length !== 3) return DEFAULT_BANDS
  const [a, b, c] = parts as [number, number, number]
  const isValid =
    [a, b, c].every(n => Number.isFinite(n) && n > 0) && a < b && b < c
  return isValid ? [a, b, c] : DEFAULT_BANDS
}

export function bandOf(tokens: number, bands: Bands): ContextRelayBand {
  if (tokens < bands[0]) return 'clear'
  if (tokens < bands[1]) return 'overcast'
  if (tokens < bands[2]) return 'rain'
  return 'storm'
}

export const BAND_ORDER: readonly ContextRelayBand[] = [
  'clear',
  'overcast',
  'rain',
  'storm',
]

/** How each band looks: the terminal glyph and the colour on every surface. */
export const BAND_STYLE: Record<
  ContextRelayBand,
  { glyph: string; color: string }
> = {
  clear: { glyph: '☀', color: '#3fb950' },
  overcast: { glyph: '☁', color: '#d4a72c' },
  rain: { glyph: '🌧', color: '#e8793a' },
  storm: { glyph: '⛈', color: '#d64545' },
}

export const COLOR_DIM = '#8b949e'
export const COLOR_HOT = '#f0883e'
export const COLOR_COLD = '#d64545'
export const COLOR_RUNNING = '#d64545'
export const COLOR_ALERT = '#d64545'

/** 362k, 1.2M, 950. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0'
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(Math.round(tokens))
}

/** "41m", "1h 05m", "< 1m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return '< 1m'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours}h ${String(rest).padStart(2, '0')}m`
}

/** "3h00" under a day, "2d23h" from a day up; "0h00" for nothing. */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(total / (24 * 60))
  const hours = Math.floor((total % (24 * 60)) / 60)
  const minutes = total % 60
  if (days > 0) return `${days}d${String(hours).padStart(2, '0')}h`
  return `${hours}h${String(minutes).padStart(2, '0')}`
}

/** "#3fb950" at an alpha, as "rgba(63,185,80,0.12)"; a non-hex colour is returned as is. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x ?? '00', 16))
  return `rgba(${r},${g},${b},${alpha})`
}

export type Tone = 'calm' | 'fast' | 'alert' | 'neutral'

export const TONE_COLOR: Record<Tone, string> = {
  calm: '#3fa66b',
  fast: '#d9962b',
  alert: '#d64545',
  neutral: '#8b949e',
}

/** The pacing rule: red at 90% used or 15 points ahead of the clock, yellow when any ahead. */
export function toneOf(usedPercent: number, elapsedPercent: number | null): Tone {
  const pace = elapsedPercent === null ? 0 : usedPercent - elapsedPercent
  if (usedPercent >= 90 || pace > 15) return 'alert'
  if (pace > 0) return 'fast'
  return 'calm'
}

/** A rate-limit window's length in ms by its kind; null for an unknown kind. */
export function windowSpanMs(kind: string): number | null {
  if (kind === 'five_hour') return 5 * 60 * 60 * 1000
  if (kind === 'seven_day') return 7 * 24 * 60 * 60 * 1000
  return null
}

/** The share of a prompt the cache served, 0..100. */
export function cacheHitPercent(usage: {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}): number | null {
  const total =
    usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (total <= 0) return null
  return Math.round((usage.cache_read_input_tokens / total) * 100)
}

/** A terminal gauge of `cells` cells: filled blocks for the used share. */
export function textGauge(usedPercent: number, cells = 8): string {
  const filled = Math.round((Math.max(0, Math.min(100, usedPercent)) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/** "14:30" in the local clock. */
export function formatClock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "2026-10-19-1430", for a file name. */
export function formatStamp(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** "$1.23", "$0.004". */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0'
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`
}

/** One bar glyph per reading: the tokens the turn added, scaled to the fullest. */
export function barsOf(deltas: readonly number[]): string {
  const glyphs = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  const max = Math.max(0, ...deltas)
  if (max === 0) return deltas.map(() => glyphs[0]).join('')
  return deltas
    .map(delta => {
      const level = Math.min(
        glyphs.length - 1,
        Math.round((Math.max(0, delta) / max) * (glyphs.length - 1)),
      )
      return glyphs[level] ?? glyphs[0]
    })
    .join('')
}

/**
 * The tokens each turn added: the difference between consecutive readings,
 * floored at 0; a compaction's reading counts as 0.
 */
export function deltasOf(
  readings: readonly { tokens: number; isCompaction?: true }[],
): number[] {
  const deltas: number[] = []
  for (let i = 1; i < readings.length; i += 1) {
    const prev = readings[i - 1]
    const cur = readings[i]
    if (!prev || !cur) continue
    deltas.push(cur.isCompaction ? 0 : Math.max(0, cur.tokens - prev.tokens))
  }
  return deltas
}

/** The `warm` setting as hours: off → 0. */
export function warmHours(value: unknown): number {
  if (typeof value !== 'string') return 4
  const match = /^(\d+)h$/.exec(value.trim())
  if (!match) return 0
  return Number(match[1])
}

/** The `autoHandoffAt` setting; 0 or anything invalid disables. */
export function autoHandoffAt(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

/** The `countdownSeconds` setting, clamped to 5..600. */
export function countdownSeconds(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return 30
  return Math.min(600, Math.max(5, Math.round(n)))
}
