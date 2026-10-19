import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import {
  BAND_STYLE,
  COLOR_DIM,
  TONE_COLOR,
  barsOf,
  formatClock,
  formatDuration,
  formatSpan,
  formatTokens,
  formatUsd,
  textGauge,
  toneOf,
  windowSpanMs,
  withAlpha,
} from './bands'
import type { Tone } from './bands'
import type { Strings } from './i18n'
import {
  boltIcon,
  calendarIcon,
  clockIcon,
  coinIcon,
  gaugeSvg,
  peopleIcon,
  sparklineSvg,
  weatherIcon,
} from './icons'
import type {
  ContextRelayAgent,
  ContextRelayBand,
  ContextRelayHandoff,
  ContextRelayLimit,
} from '../types'

/**
 * Drawing, from values already read: register.tsx gathers the Snapshot and
 * the handlers (it owns `$`), these functions turn them into trees by calling
 * the surface's element constructors (JSX is only available in the hooks
 * module). The desktop band is a row of pills after Token Weather Usage by
 * augiefra; the terminal band is one line of text.
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
  limits: ContextRelayLimit[]
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
}

export type CommonElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

export type LimitView = {
  kind: string
  short: string
  long: string
  used: number
  elapsed: number | null
  leftMs: number | null
  resetsAt: number | null
  tone: Tone
}

export function limitView(
  limit: ContextRelayLimit,
  now: number,
  t: Strings,
): LimitView {
  const span = windowSpanMs(limit.kind)
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  const leftMs =
    Number.isFinite(resetsAt) ? Math.max(0, resetsAt - now) : null
  const elapsed =
    span !== null && leftMs !== null
      ? Math.max(0, Math.min(100, ((span - leftMs) / span) * 100))
      : null
  const isWeek = limit.kind === 'seven_day'
  return {
    kind: limit.kind,
    short: isWeek ? t.limit7d : t.limit5h,
    long: isWeek ? t.limit7dLong : t.limit5hLong,
    used: limit.percentUsed,
    elapsed,
    leftMs,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    tone: toneOf(limit.percentUsed, elapsed),
  }
}

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

function weatherPill(els: Elements['desktop'], s: Snapshot): RenderElement {
  const { Text, Svg } = els
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
  return pill(els, 'relay-weather', tintOf(s.color), [
    Svg({ source: weatherIcon(s.band, s.color), alt: t.band[s.band], width: 15, height: 15 }),
    Text({ bold: true, color: s.color, children: tokensText(s) }),
    s.deltas.length > 0 &&
      Svg({ source: sparklineSvg(s.deltas, s.color), alt: t.recentTurns, width: 40, height: 10 }),
    s.lastDelta !== undefined &&
      Text({ dimColor: true, children: `▲ +${formatTokens(s.lastDelta)}` }),
    card(els, rows),
  ])
}

function limitPill(els: Elements['desktop'], s: Snapshot, v: LimitView): RenderElement {
  const { Text, Svg } = els
  const { t } = s
  const color = TONE_COLOR[v.tone]
  const icon = v.kind === 'seven_day' ? calendarIcon(color) : clockIcon(color)
  const timeText =
    v.leftMs === null
      ? ''
      : v.kind === 'seven_day'
        ? formatSpan(v.leftMs)
        : v.elapsed !== null
          ? formatSpan(((v.elapsed / 100) * (windowSpanMs(v.kind) ?? 0)))
          : formatSpan(v.leftMs)
  const rows: Row[] = [
    { label: v.long, value: `${v.used}% ${t.used}`, color },
  ]
  if (v.elapsed !== null) {
    rows.push({ label: '', value: `${Math.round(v.elapsed)}% ${t.elapsed}` })
    const pace = Math.round(v.used - v.elapsed)
    rows.push({
      label: '',
      value: pace > 0 ? t.pace(pace) : t.onPace,
      color: pace > 0 ? color : COLOR_DIM,
    })
  }
  if (v.resetsAt !== null) {
    rows.push({
      label: '',
      value:
        v.kind === 'seven_day'
          ? `${formatSpan(v.leftMs ?? 0)} ${t.left}`
          : t.resetsAt(formatClock(v.resetsAt)),
      color: COLOR_DIM,
    })
  }
  return pill(els, `relay-${v.kind}`, v.tone === 'calm' ? NEUTRAL : tintOf(color), [
    Svg({ source: icon, alt: v.long, width: 14, height: 14 }),
    Text({ children: v.short }),
    Svg({ source: gaugeSvg(v.used, v.elapsed, color), alt: `${v.used}%`, width: 54, height: 9 }),
    Text({ bold: true, color: v.tone === 'alert' ? 'red' : undefined, children: `${v.used}%` }),
    timeText !== '' && Text({ dimColor: true, children: timeText }),
    card(els, rows),
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

function agentsPill(els: Elements['desktop'], s: Snapshot): RenderElement {
  const { Text, Svg } = els
  const { t } = s
  const isBusy = s.running > 0
  const color = isBusy ? TONE_COLOR.alert : TONE_COLOR.neutral
  const rows: Row[] = [
    {
      label: t.agents,
      value:
        s.agents.length === 0
          ? t.agentsNone
          : t.agentsCounts(s.running, s.agents.length - s.running, s.agents.length),
    },
  ]
  for (const agent of s.agents.slice(-6)) {
    const isRunning = agent.endedAt === undefined
    rows.push({
      label: '',
      value: `${isRunning ? '●' : '○'} ${agent.name} · ${agent.type} · ${formatDuration((agent.endedAt ?? s.now) - agent.startedAt)}`,
      color: isRunning ? TONE_COLOR.alert : COLOR_DIM,
    })
  }
  return pill(els, 'relay-agents', isBusy ? tintOf(color) : NEUTRAL, [
    Svg({ source: peopleIcon(color), alt: t.agents, width: 14, height: 14 }),
    Text({ bold: isBusy, color: isBusy ? 'red' : undefined, dimColor: !isBusy, children: `${s.running}/${s.agents.length}` }),
    card(els, rows),
  ])
}

function relayPill(els: Elements['desktop'], s: Snapshot, h: Handlers): RenderElement {
  const { Button } = els
  const hot = isRelayHot(s)
  return pill(els, 'relay-handoff-pill', hot ? tintOf(s.color) : NEUTRAL, [
    Button({ key: 'relay-handoff', label: '⇄', plain: true, dimColor: !hot, onPress: h.relay }),
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
  const limits = s.limits
    .map(l => limitView(l, s.now, t))
    .filter(v => v.kind === 'five_hour' || v.kind === 'seven_day')
    .sort(a => (a.kind === 'five_hour' ? -1 : 1))
  const line = Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 1,
    rowGap: 1,
    children: [
      weatherPill(els, s),
      ...limits.map(v => limitPill(els, s, v)),
      cachePill(els, s, h),
      costPill(els, s),
      agentsPill(els, s),
      relayPill(els, s, h),
      s.handoff.phase === 'collecting' && Text({ dimColor: true, children: t.collecting }),
      s.handoff.phase === 'clearing' && Text({ dimColor: true, children: t.clearing }),
    ],
  })
  return Box({
    flexDirection: 'column',
    children: [line, pendingRow({ Box, Text, Button: els.Button }, s, h)],
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
  for (const l of s.limits) {
    const v = limitView(l, s.now, t)
    if (v.kind !== 'five_hour' && v.kind !== 'seven_day') continue
    const parts = [`${v.used}% ${t.used}`]
    if (v.elapsed !== null) parts.push(`${Math.round(v.elapsed)}% ${t.elapsed}`)
    if (v.resetsAt !== null) {
      parts.push(
        v.kind === 'seven_day'
          ? `${formatSpan(v.leftMs ?? 0)} ${t.left}`
          : t.resetsAt(formatClock(v.resetsAt)).toLowerCase(),
      )
    }
    rows.push({
      label: v.long,
      value: parts.join(' · '),
      ...(v.tone === 'alert' ? { color: TONE_COLOR.alert } : {}),
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
  if (s.cost.usd > 0) {
    rows.push({
      label: t.cost,
      value: `${formatUsd(s.cost.usd)} · ${formatUsd(s.cost.lastUsd)} ${t.lastPrompt}`,
    })
  }
  if (s.agents.length === 0) {
    rows.push({ label: t.agents, value: t.agentsNone, color: COLOR_DIM })
  } else {
    rows.push({
      label: t.agents,
      value: t.agentsCounts(s.running, s.agents.length - s.running, s.agents.length),
    })
    for (const agent of s.agents.slice(-6)) {
      const isRunning = agent.endedAt === undefined
      rows.push({
        label: '',
        value: `${isRunning ? '●' : '○'} ${agent.name} · ${agent.type} · ${formatDuration((agent.endedAt ?? s.now) - agent.startedAt)}`,
        color: isRunning ? TONE_COLOR.alert : COLOR_DIM,
      })
    }
  }
  return rows
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
    Text({ color: s.color, bold: true, children: `${BAND_STYLE[s.band].glyph} ${tokensText(s)}` }),
  ]
  if (s.deltas.length > 0) {
    parts.push(Text({ dimColor: true, children: `${barsOf(s.deltas)} +${formatTokens(s.lastDelta ?? 0)}` }))
  }
  for (const l of s.limits) {
    const v = limitView(l, s.now, t)
    if (v.kind !== 'five_hour' && v.kind !== 'seven_day') continue
    const color = TONE_COLOR[v.tone]
    const time =
      v.leftMs === null
        ? ''
        : v.kind === 'seven_day'
          ? ` ${formatSpan(v.leftMs)}`
          : v.elapsed !== null
            ? ` ${formatSpan((v.elapsed / 100) * (windowSpanMs(v.kind) ?? 0))}`
            : ''
    parts.push(sep)
    parts.push(Text({ children: `${v.short} ` }))
    parts.push(Text({ color, children: textGauge(v.used) }))
    parts.push(
      Text({
        bold: true,
        ...(v.tone === 'alert' ? { color: TONE_COLOR.alert } : {}),
        children: ` ${v.used}%`,
      }),
    )
    if (time !== '') parts.push(Text({ dimColor: true, children: time }))
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
  if (s.cost.usd > 0) {
    parts.push(sep)
    parts.push(Text({ bold: true, children: `≈ ${formatUsd(s.cost.usd)}` }))
    if (s.cost.lastUsd > 0) parts.push(Text({ dimColor: true, children: `+${formatUsd(s.cost.lastUsd)}` }))
  }
  parts.push(sep)
  parts.push(
    Text({
      ...(s.running > 0 ? { color: TONE_COLOR.alert, bold: true } : { dimColor: true }),
      children: `👥 ${s.running}/${s.agents.length}`,
    }),
  )
  parts.push(sep)
  parts.push(Button({ key: 'relay-handoff', label: '⇄', plain: true, dimColor: !isRelayHot(s), onPress: h.relay }))
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
    children: [line, ...details, pendingRow({ Box, Text, Button }, s, h)],
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

export type CountdownView = {
  t: Strings
  tokens: number
  secondsLeft: number
}

/** The countdown pane before an automatic handoff. */
export function drawCountdownPane(
  els: CommonElements,
  view: CountdownView,
  onNow: () => void,
  onCancel: () => void,
): RenderElement {
  const { Box, Text, Button } = els
  const { t } = view
  return Box({
    flexDirection: 'column',
    gap: 1,
    paddingX: 1,
    children: [
      Text({ bold: true, children: t.autoTitle }),
      Text({ children: t.autoBody(formatTokens(view.tokens), view.secondsLeft) }),
      Box({
        flexDirection: 'row',
        gap: 1,
        children: [
          Button({
            key: 'relay-now',
            variant: 'primary',
            hotkey: '1',
            autoFocus: true,
            onPress: onNow,
            children: t.now,
          }),
          Button({ key: 'relay-cancel', hotkey: '2', onPress: onCancel, children: t.cancel }),
        ],
      }),
    ],
  })
}
