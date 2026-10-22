import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import {
  BAND_STYLE,
  COLOR_DIM,
  TONE_COLOR,
  barsOf,
  formatClock,
  formatDuration,
  formatTokens,
  formatUsd,
  withAlpha,
} from './bands'
import type { Tone } from './bands'
import type { Strings } from './i18n'
import {
  boltIcon,
  coinIcon,
  peopleIcon,
  sparklineSvg,
  weatherIcon,
} from './icons'
import type {
  ContextRelayAgent,
  ContextRelayBand,
  ContextRelayHandoff,
} from '../types'

/**
 * Drawing, from values already read: register.tsx gathers the Snapshot and
 * the handlers (it owns `$`), these functions turn them into trees by calling
 * the surface's element constructors (JSX is only available in the hooks
 * module). The desktop band is a row of pills after Token Weather Usage by
 * augiefra, in the order weather (with ⇄), cost, cache, subagents;
 * the terminal band is one line of text in the same order.
 */

export type Snapshot = {
  tokens: number | undefined
  window: number | undefined
  band: ContextRelayBand
  color: string
  deltas: number[]
  lastDelta: number | undefined
  cacheLeft: number | null
  cacheHit: number | null
  isPinging: boolean
  pings: number
  maxPings: number
  warmIsOn: boolean
  agents: ContextRelayAgent[]
  running: number
  cost: { usd: number; lastUsd: number }
  handoff: ContextRelayHandoff
  isExpanded: boolean
  t: Strings
  now: number
}

export type Handlers = {
  relay: () => void
  ping: () => void
  load: () => void
  dismiss: () => void
  toggle: () => void
  /** The automatic handoff's question: Yes collects now, No cancels. */
  yes: () => void
  no: () => void
}

export type CommonElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

type CacheView = { text: string; tone: Tone; isCold: boolean }

export function cacheView(s: Snapshot): CacheView {
  if (s.isPinging) return { text: s.t.pinging, tone: 'fast', isCold: false }
  if (s.cacheLeft === null) return { text: '—', tone: 'neutral', isCold: false }
  if (s.cacheLeft <= 0) return { text: s.t.cacheCold, tone: 'alert', isCold: true }
  const tone: Tone = s.cacheLeft < 10 * 60_000 ? 'fast' : 'calm'
  return { text: formatDuration(s.cacheLeft), tone, isCold: false }
}

function isRelayHot(s: Snapshot): boolean {
  return s.band === 'rain' || s.band === 'storm'
}

function tokensText(s: Snapshot): string {
  return s.tokens === undefined ? '—' : formatTokens(s.tokens)
}

type Row = { label: string; value: string; color?: string }

/** One entry of a list pill: a subagent. */
type ListItem = { text: string; startedAt: number; endedAt?: number }

/** What the subagents pill draws from. */
type ListView = {
  key: string
  icon: (color: string) => string
  glyph: string
  label: string
  running: number
  total: number
  /** The first card row: the counts, or the "none yet" line. */
  headline: string
  items: ListItem[]
}

const ITEMS_SHOWN = 6

export function agentsView(s: Snapshot): ListView {
  const { t } = s
  const total = s.agents.length
  return {
    key: 'relay-agents',
    icon: peopleIcon,
    glyph: '👥',
    label: t.agents,
    running: s.running,
    total,
    headline: total === 0 ? t.agentsNone : t.agentsCounts(s.running, total - s.running, total),
    items: s.agents.slice(-ITEMS_SHOWN).map(a => ({
      text: [a.model, a.name, a.type].filter(Boolean).join(' · '),
      startedAt: a.startedAt,
      ...(a.endedAt !== undefined ? { endedAt: a.endedAt } : {}),
    })),
  }
}

/** The rows of a list pill's card (desktop) or its expanded details (terminal). */
function listRows(s: Snapshot, v: ListView): Row[] {
  const rows: Row[] = [
    { label: v.label, value: v.headline, ...(v.total === 0 ? { color: COLOR_DIM } : {}) },
  ]
  for (const item of v.items) {
    const isRunning = item.endedAt === undefined
    rows.push({
      label: '',
      value: `${isRunning ? '●' : '○'} ${item.text} · ${formatDuration((item.endedAt ?? s.now) - item.startedAt)}`,
      color: isRunning ? TONE_COLOR.alert : COLOR_DIM,
    })
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Desktop: pills                                                      */
/* ------------------------------------------------------------------ */

type Tint = { bg: string; line: string }

function tintOf(color: string): Tint {
  return { bg: withAlpha(color, 0.12), line: withAlpha(color, 0.45) }
}

const NEUTRAL: Tint = tintOf(TONE_COLOR.neutral)
const CARD_LINE = 'rgba(127,127,127,0.5)'
const CARD_BG = '#1c2128'
const CARD_FG = '#e6edf3'

/** One pill: a rounded box with a tint, its parts in a row; `key` scopes its hover card. */
function pill(
  els: Elements['desktop'],
  key: string,
  tint: Tint,
  parts: RenderChildren[],
): RenderElement {
  const { Box } = els
  return Box({
    key,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 1,
    paddingX: 1,
    paddingY: 0,
    borderStyle: 'round',
    borderColor: tint.line,
    backgroundColor: tint.bg,
    children: parts,
  })
}

/** The card a pill reveals while hovered: placed above it, out of the flow. */
function card(els: Elements['desktop'], rows: Row[]): RenderElement {
  const { Box, Text } = els
  return Box({
    position: 'absolute',
    bottom: 1,
    left: 0,
    display: 'none',
    hover: { display: 'flex' },
    flexDirection: 'column',
    paddingX: 1,
    paddingY: 0,
    borderStyle: 'round',
    borderColor: CARD_LINE,
    backgroundColor: CARD_BG,
    children: rows.map(row =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          row.label !== '' && Text({ color: CARD_FG, bold: true, children: row.label }),
          Text({ color: row.color ?? CARD_FG, children: row.value }),
        ],
      }),
    ),
  })
}

/** Weather: the icon alone carries the band's colour; ⇄ sits at the end, bright from Rain upward. */
function weatherPill(els: Elements['desktop'], s: Snapshot, h: Handlers): RenderElement {
  const { Text, Svg, Button } = els
  const { t } = s
  const rows: Row[] = [
    {
      label: t.band[s.band],
      value: `${tokensText(s)} / ${formatTokens(s.window ?? 0)} ${t.window}`,
      color: s.color,
    },
  ]
  if (s.deltas.length > 0) {
    rows.push({
      label: t.recentTurns,
      value: `${barsOf(s.deltas)}  +${formatTokens(s.lastDelta ?? 0)} ${t.lastTurn}`,
    })
  }
  return pill(els, 'relay-weather', NEUTRAL, [
    Svg({ source: weatherIcon(s.band, s.color), alt: t.band[s.band], width: 15, height: 15 }),
    Text({ bold: true, children: tokensText(s) }),
    s.deltas.length > 0 &&
      Svg({ source: sparklineSvg(s.deltas, COLOR_DIM), alt: t.recentTurns, width: 40, height: 10 }),
    s.lastDelta !== undefined &&
      Text({ dimColor: true, children: `▲ +${formatTokens(s.lastDelta)}` }),
    Button({
      key: 'relay-handoff',
      label: '⇄',
      plain: true,
      dimColor: !isRelayHot(s),
      onPress: h.relay,
    }),
    card(els, rows),
  ])
}

function costPill(els: Elements['desktop'], s: Snapshot): RenderElement | false {
  const { Text, Svg } = els
  const { t } = s
  if (s.cost.usd <= 0) return false
  return pill(els, 'relay-cost', NEUTRAL, [
    Svg({ source: coinIcon(TONE_COLOR.fast), alt: t.cost, width: 14, height: 14 }),
    Text({ bold: true, children: `≈ ${formatUsd(s.cost.usd)}` }),
    s.cost.lastUsd > 0 && Text({ dimColor: true, children: `+${formatUsd(s.cost.lastUsd)}` }),
    card(els, [
      { label: t.cost, value: formatUsd(s.cost.usd) },
      { label: '', value: `${formatUsd(s.cost.lastUsd)} ${t.lastPrompt}`, color: COLOR_DIM },
    ]),
  ])
}

function cachePill(els: Elements['desktop'], s: Snapshot, h: Handlers): RenderElement {
  const { Text, Svg, Button } = els
  const { t } = s
  const v = cacheView(s)
  const color = TONE_COLOR[v.tone]
  const rows: Row[] = [
    { label: t.cacheLong, value: v.isCold ? t.cacheCold : v.text, color },
  ]
  if (s.cacheHit !== null) rows.push({ label: '', value: t.cacheHit(s.cacheHit) })
  rows.push({
    label: '',
    value: s.warmIsOn ? t.pings(s.pings, s.maxPings) : t.warmOff,
    color: COLOR_DIM,
  })
  if (s.warmIsOn) rows.push({ label: '', value: t.pingCost, color: COLOR_DIM })
  const parts: RenderChildren[] = [
    Svg({ source: boltIcon(color), alt: t.cacheLong, width: 14, height: 14 }),
    Text({ children: t.cache }),
  ]
  if (s.cacheHit !== null && s.cacheHit < 90 && !v.isCold) {
    parts.push(Text({ bold: true, children: `${s.cacheHit}%` }))
  }
  parts.push(
    Text({
      bold: v.isCold,
      color: v.tone === 'alert' ? 'red' : v.tone === 'fast' ? TONE_COLOR.fast : undefined,
      dimColor: v.tone === 'calm' || v.tone === 'neutral',
      children: v.text,
    }),
  )
  if (s.warmIsOn && s.maxPings > 0) {
    parts.push(Text({ dimColor: true, children: `${s.pings}/${s.maxPings}` }))
  }
  parts.push(Button({ key: 'relay-ping', label: '↻', plain: true, dimColor: true, onPress: h.ping }))
  parts.push(card(els, rows))
  return pill(els, 'relay-cache', v.tone === 'calm' || v.tone === 'neutral' ? NEUTRAL : tintOf(color), parts)
}

/** Subagents: running/total, red while any runs; the card lists the last few. */
function listPill(els: Elements['desktop'], s: Snapshot, v: ListView): RenderElement {
  const { Text, Svg } = els
  const isBusy = v.running > 0
  const color = isBusy ? TONE_COLOR.alert : TONE_COLOR.neutral
  return pill(els, v.key, isBusy ? tintOf(color) : NEUTRAL, [
    Svg({ source: v.icon(color), alt: v.label, width: 14, height: 14 }),
    Text({
      bold: isBusy,
      color: isBusy ? 'red' : undefined,
      dimColor: !isBusy,
      children: `${v.running}/${v.total}`,
    }),
    card(els, listRows(s, v)),
  ])
}

/** The band on the desktop: a wrapping row of pills, each with a hover card. */
export function drawDesktopBand(
  els: Elements['desktop'],
  s: Snapshot,
  h: Handlers,
): RenderElement {
  const { Box, Text } = els
  const { t } = s
  const line = Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 1,
    rowGap: 1,
    children: [
      weatherPill(els, s, h),
      costPill(els, s),
      cachePill(els, s, h),
      listPill(els, s, agentsView(s)),
      s.handoff.phase === 'collecting' && Text({ dimColor: true, children: t.collecting }),
      s.handoff.phase === 'clearing' && Text({ dimColor: true, children: t.clearing }),
    ],
  })
  const common = { Box, Text, Button: els.Button }
  return Box({
    flexDirection: 'column',
    children: [line, pendingRow(common, s, h), countdownRow(common, s, h)],
  })
}

/* ------------------------------------------------------------------ */
/* Terminal: one line                                                  */
/* ------------------------------------------------------------------ */

/** The hover cards' rows, for the terminal's expanded view. */
export function detailRows(s: Snapshot): Row[] {
  const { t } = s
  const rows: Row[] = []
  rows.push({
    label: t.band[s.band],
    value: `${tokensText(s)} / ${formatTokens(s.window ?? 0)} ${t.window}`,
    color: s.color,
  })
  if (s.deltas.length > 0) {
    rows.push({
      label: t.recentTurns,
      value: `${barsOf(s.deltas)}  +${formatTokens(s.lastDelta ?? 0)} ${t.lastTurn}`,
    })
  }
  if (s.cost.usd > 0) {
    rows.push({
      label: t.cost,
      value: `${formatUsd(s.cost.usd)} · ${formatUsd(s.cost.lastUsd)} ${t.lastPrompt}`,
    })
  }
  const c = cacheView(s)
  const cacheParts = [c.text]
  if (s.cacheHit !== null) cacheParts.push(t.cacheHit(s.cacheHit))
  cacheParts.push(s.warmIsOn ? t.pings(s.pings, s.maxPings) : t.warmOff)
  rows.push({
    label: t.cacheLong,
    value: cacheParts.join(' · '),
    ...(c.isCold ? { color: TONE_COLOR.alert } : {}),
  })
  rows.push(...listRows(s, agentsView(s)))
  return rows
}

/** A list's compact part on the terminal: its glyph and running/total. */
function listText(els: CommonElements, v: ListView): RenderElement {
  const { Text } = els
  return Text({
    ...(v.running > 0 ? { color: TONE_COLOR.alert, bold: true } : { dimColor: true }),
    children: `${v.glyph} ${v.running}/${v.total}`,
  })
}

/** The band on the terminal (and any surface without SVG): glyphs, and details on a toggle. */
export function drawTextualBand(
  els: CommonElements,
  s: Snapshot,
  h: Handlers,
): RenderElement {
  const { Box, Text, Button } = els
  const { t } = s
  const c = cacheView(s)
  const sep = Text({ dimColor: true, children: '│' })
  const parts: RenderChildren[] = [
    Text({ color: s.color, bold: true, children: BAND_STYLE[s.band].glyph }),
    Text({ bold: true, children: tokensText(s) }),
  ]
  if (s.deltas.length > 0) {
    parts.push(Text({ dimColor: true, children: `${barsOf(s.deltas)} +${formatTokens(s.lastDelta ?? 0)}` }))
  }
  parts.push(Button({ key: 'relay-handoff', label: '⇄', plain: true, dimColor: !isRelayHot(s), onPress: h.relay }))
  if (s.cost.usd > 0) {
    parts.push(sep)
    parts.push(Text({ bold: true, children: `≈ ${formatUsd(s.cost.usd)}` }))
    if (s.cost.lastUsd > 0) parts.push(Text({ dimColor: true, children: `+${formatUsd(s.cost.lastUsd)}` }))
  }
  parts.push(sep)
  parts.push(Text({ children: `⚡ ${t.cache}` }))
  if (s.cacheHit !== null && s.cacheHit < 90 && !c.isCold) {
    parts.push(Text({ bold: true, children: ` ${s.cacheHit}%` }))
  }
  parts.push(
    Text({
      ...(c.tone === 'alert' || c.tone === 'fast' ? { color: TONE_COLOR[c.tone] } : {}),
      dimColor: c.tone === 'calm' || c.tone === 'neutral',
      children: ` ${c.text}`,
    }),
  )
  if (s.warmIsOn && s.maxPings > 0) {
    parts.push(Text({ dimColor: true, children: `${s.pings}/${s.maxPings}` }))
  }
  parts.push(Button({ key: 'relay-ping', label: '↻', plain: true, dimColor: true, onPress: h.ping }))
  parts.push(sep)
  parts.push(listText(els, agentsView(s)))
  parts.push(
    Button({
      key: 'relay-expand',
      label: s.isExpanded ? '▴' : '▾',
      plain: true,
      dimColor: true,
      onPress: h.toggle,
    }),
  )
  if (s.handoff.phase === 'collecting') parts.push(Text({ dimColor: true, children: t.collecting }))
  if (s.handoff.phase === 'clearing') parts.push(Text({ dimColor: true, children: t.clearing }))

  const line = Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: parts })
  const rows = s.isExpanded ? detailRows(s) : []
  const details: RenderChildren[] = rows.map(row =>
    Box({
      flexDirection: 'row',
      gap: 1,
      paddingLeft: 2,
      children: [
        row.label !== '' && Text({ bold: true, children: row.label }),
        Text({
          ...(row.color !== undefined ? { color: row.color } : {}),
          dimColor: row.color === COLOR_DIM,
          children: row.value,
        }),
      ],
    }),
  )
  return Box({
    flexDirection: 'column',
    children: [
      line,
      ...details,
      pendingRow({ Box, Text, Button }, s, h),
      countdownRow({ Box, Text, Button }, s, h),
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Shared rows                                                         */
/* ------------------------------------------------------------------ */

/** The row under the band while a handoff waits or is about to load. */
function pendingRow(
  { Box, Text, Button }: CommonElements,
  s: Snapshot,
  h: Handlers,
): RenderElement | null {
  const { t } = s
  const pending = s.handoff.pending
  if (s.handoff.error) {
    return Text({ color: TONE_COLOR.alert, children: t.handoffFailed(s.handoff.error) })
  }
  if (!pending) return null
  if (pending.isArmed || s.handoff.phase === 'armed') {
    return Text({ color: COLOR_DIM, children: `📥 ${t.readyRow}` })
  }
  return Box({
    flexDirection: 'row',
    gap: 1,
    alignItems: 'center',
    children: [
      Text({
        color: BAND_STYLE.overcast.color,
        children: `📥 ${t.pendingRow(formatClock(pending.createdAt))}`,
      }),
      Button({ key: 'relay-load', variant: 'primary', onPress: h.load, children: t.load }),
      Button({ key: 'relay-dismiss', onPress: h.dismiss, children: t.dismiss }),
    ],
  })
}

/**
 * The automatic handoff's question, under the band while the countdown runs:
 * what is about to happen, the seconds left, and Yes / No. Silence is Yes.
 */
export function countdownRow(
  { Box, Text, Button }: CommonElements,
  s: Snapshot,
  h: Handlers,
): RenderElement | null {
  const { t } = s
  if (s.handoff.phase !== 'countdown') return null
  const endsAt = s.handoff.countdownEndsAt ?? s.now
  const secondsLeft = Math.max(0, Math.ceil((endsAt - s.now) / 1000))
  const color = TONE_COLOR.alert
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: color,
    paddingX: 1,
    children: [
      Text({ bold: true, color, children: `⇄ ${t.autoTitle}` }),
      Text({ children: t.autoBody(formatTokens(s.tokens ?? 0)) }),
      Text({ dimColor: true, children: t.autoCountdown(secondsLeft) }),
      Box({
        flexDirection: 'row',
        gap: 1,
        children: [
          Button({
            key: 'relay-yes',
            variant: 'primary',
            hotkey: '1',
            autoFocus: true,
            onPress: h.yes,
            children: t.yes,
          }),
          Button({ key: 'relay-no', hotkey: '2', onPress: h.no, children: t.no }),
        ],
      }),
    ],
  })
}
