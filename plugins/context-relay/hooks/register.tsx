import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  ModelForkResult,
  Register,
  SessionCompactResult,
  Timer,
} from 'claude-code'

import {
  BAND_STYLE,
  autoHandoffAt,
  bandOf,
  cacheHitPercent,
  countdownSeconds,
  deltasOf,
  formatClock,
  formatTokens,
  modelLabel,
  parseBands,
  warmHours,
} from './bands'
import { drawDesktopBand, drawTextualBand } from './draw'
import type { Handlers, Snapshot } from './draw'
import {
  CONTEXT_BLOCK,
  deleteArgv,
  frameHandoff,
  handoffDirFor,
  handoffFileFor,
  isExpired,
  parsePending,
  projectSlug,
  storeKeyFor,
  transcriptText,
} from './handoff'
import { languageForSurface, languageOf, stringsFor } from './i18n'
import { appendLog, errorText, logFileFor } from './log'
import { HOUR_MS, READINGS_KEPT } from './state'
import {
  PING_PROMPT,
  WARM_PERIOD_MS,
  cacheLeftMs,
  forkFailure,
  pingsFor,
  ttlFromEnv,
} from './warm'
import type {
  ContextRelayAgent,
  ContextRelayCache,
  ContextRelayHandoff,
  ContextRelayLanguage,
  ContextRelayPendingHandoff,
  ContextRelayReading,
} from '../types'

/**
 * context-relay: context weather, prompt-cache warming and a one-click
 * handoff of the conversation into a fresh chat, in one band above the prompt.
 * The design is docs/context-relay-design.md in the repository.
 *
 * Everything that touches `$` is in this file: the engine follows `$` only
 * into functions declared beside the hooks. The pure parts live next door.
 */

const TICK_MS = 30_000

/* ----------------------------------------------------------------- */
/* State: declared here so the engine's scan can read every source     */
/* ----------------------------------------------------------------- */

export const readings = atom(
  { plugin: 'context-relay', key: 'readings' } as const,
  [] as ContextRelayReading[],
)

export const cache = atom({ plugin: 'context-relay', key: 'cache' } as const, {
  requestAt: null,
  ttlMs: HOUR_MS,
  pings: 0,
  nextPingAt: null,
  isPinging: false,
  hitPercent: null,
} as ContextRelayCache)

export const agents = atom(
  { plugin: 'context-relay', key: 'agents' } as const,
  [] as ContextRelayAgent[],
)

export const cost = atom({ plugin: 'context-relay', key: 'cost' } as const, {
  usd: 0,
  lastUsd: 0,
})

export const handoff = atom({ plugin: 'context-relay', key: 'handoff' } as const, {
  phase: 'idle',
  countdownEndsAt: null,
  pending: null,
  error: null,
} as ContextRelayHandoff)

export const lang = atom(
  { plugin: 'context-relay', key: 'lang' } as const,
  'en' as ContextRelayLanguage,
)

export const stormToasted = atom(
  { plugin: 'context-relay', key: 'stormToasted' } as const,
  false,
)

export const isExpanded = atom(
  { plugin: 'context-relay', key: 'isExpanded' } as const,
  false,
)

export const tick = atom({ plugin: 'context-relay', key: 'tick' } as const, 0)


/* ----------------------------------------------------------------- */
/* Readings, language, agents                                         */
/* ----------------------------------------------------------------- */

/**
 * The system's language: the locale variables, else on Windows the culture
 * PowerShell reports. The desktop draws in it; the terminal stays English
 * (languageForSurface), so the surface is read at draw time, never here:
 * a desktop-hosted session has no surface attached yet when it starts.
 */
async function detectSystemLanguage(
  $: EngineInterface,
  cwd: string,
): Promise<ContextRelayLanguage> {
  const fromEnv =
    (await $.env.get('LC_ALL')) ??
    (await $.env.get('LC_MESSAGES')) ??
    (await $.env.get('LANG'))
  if (fromEnv !== undefined && fromEnv !== '') return languageOf(fromEnv)
  if (/^[A-Za-z]:[\\/]/.test(cwd)) {
    const culture = await $.process
      .run(['powershell', '-NoProfile', '-Command', '(Get-Culture).Name'], {
        timeoutMs: 10_000,
      })
      .catch(() => undefined)
    if (culture && culture.exitCode === 0) return languageOf(culture.stdout)
  }
  return 'en'
}

/** The language for a toast or a command's answer: the system's while a desktop surface is attached. */
async function messageLanguage($: EngineInterface): Promise<ContextRelayLanguage> {
  const system = await read($, lang)
  const surfaces = await $.session.surfaces().catch(() => [] as readonly string[])
  return languageForSurface(system, surfaces.includes('desktop') ? 'desktop' : 'terminal')
}

async function detectTtlMs($: EngineInterface): Promise<number> {
  return ttlFromEnv(
    await $.env.get('FORCE_PROMPT_CACHING_5M'),
    await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
  )
}

/* ----------------------------------------------------------------- */
/* The session: begun on session.start, or lazily where none fires    */
/* ----------------------------------------------------------------- */

/**
 * The id of the session the mod last began. Null before the first start
 * and after a /clear: the engine then goes on under a new id and fires no
 * session.start, so the next hook or drawing begins the session instead.
 */
let knownSessionId: string | null = null
let isBeginning = false
let ticker: Timer | undefined

/**
 * One line into ~/.claude/context-relay/context-relay.log (and the engine's
 * debug log): what the mod saw the engine do. Best effort, never throws.
 */
async function logLine($: EngineInterface, text: string): Promise<void> {
  try {
    $.ui.log(`context-relay: ${text}`, { to: 'debug' })
  } catch {
    // a host without a debug log
  }
  try {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home === undefined || home === '') return
    const file = logFileFor(home)
    const existing = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
    const stamp = new Date(await $.clock.now()).toISOString()
    await $.fs.write(file, appendLog(existing, `${stamp} ${text}`))
  } catch {
    // the log is a convenience
  }
}

/**
 * What a session's start does: the language, the cache TTL, the commands,
 * a first reading, the handoff left for this project, the ticker. Run from
 * session.start, and from ensureSession where no session.start comes.
 */
async function beginSession(
  $: EngineInterface,
  cwd: string,
  reason: string,
): Promise<void> {
  const language = await detectSystemLanguage($, cwd)
  const ttlMs = await detectTtlMs($)
  await update($, lang, () => language)
  await update($, cache, c => ({ ...c, ttlMs }))
  const surfaces = await $.session.surfaces().catch(() => [] as readonly string[])
  const t = stringsFor(
    languageForSurface(language, surfaces.includes('desktop') ? 'desktop' : 'terminal'),
  )
  await logLine(
    $,
    `session begun (${reason}): id=${knownSessionId ?? '?'} lang=${language} surfaces=${surfaces.join(',') || 'none'} cwd=${cwd}`,
  )

  await $.command.register({
    name: 'relay',
    description: 'Hand the context over to a fresh chat (context-relay).',
  })
  await $.command.register({
    name: 'relay-warm',
    description: 'Warm the prompt cache now (context-relay).',
  })

  const tokens = await takeReading($, false)
  const turns = await $.session.turns().catch(() => 0)
  await logLine($, `first reading: ${tokens ?? 'unknown'} tokens, ${turns} turns`)

  const slug = projectSlug(cwd)
  let pending = await loadPending($, slug)
  if (pending && pending.isArmed && turns > 0) {
    // A conversation already under way never recomputes its first message,
    // so an armed handoff cannot ride in: offer it with Load/Dismiss instead.
    pending = { ...pending, isArmed: false }
    await savePending($, slug, pending)
  }
  if (pending) {
    const found = pending
    await update($, handoff, (h): ContextRelayHandoff => ({
      ...h,
      pending: found,
      phase: found.isArmed ? 'armed' : 'idle',
    }))
    await logLine(
      $,
      `handoff ${formatClock(found.createdAt)} found: ${found.isArmed ? 'armed for prompt.context' : 'offered with Load/Dismiss'}`,
    )
    if (!found.isArmed) {
      $.ui.toast(t.pendingRow(formatClock(found.createdAt)))
    }
  }

  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => {
    void update($, tick, n => n + 1)
    void reconcileAgents($)
  })
}

/**
 * Begins the session the engine is in now, unless the mod already has: the
 * case after a /clear (no session.start follows it) and of a mod loaded into
 * a running session (its start is long past).
 */
async function ensureSession($: EngineInterface, reason: string): Promise<void> {
  if (isBeginning) return
  const id = await $.session.id().catch(() => null)
  if (typeof id !== 'string' || id === knownSessionId) return
  isBeginning = true
  try {
    knownSessionId = id
    await beginSession($, await $.session.cwd(), reason)
  } catch (e) {
    await logLine($, `session begin failed (${reason}): ${errorText(e)}`)
  } finally {
    isBeginning = false
  }
}

/** Reads the session's figures and appends a reading; answers the tokens read. */
async function takeReading(
  $: EngineInterface,
  isCompaction: boolean,
  given?: number,
): Promise<number | undefined> {
  const usage = await $.session.usage()
  const now = await $.clock.now()
  const tokens = given ?? usage.context.tokens
  if (tokens !== undefined) {
    const reading: ContextRelayReading = {
      at: now,
      tokens,
      window: usage.context.window,
      ...(isCompaction ? { isCompaction: true as const } : {}),
    }
    await update($, readings, list =>
      [...list, reading].slice(-READINGS_KEPT),
    )
  }
  if (usage.cost !== undefined) {
    const usd = usage.cost.usd
    await update($, cost, c => ({ usd, lastUsd: Math.max(0, usd - c.usd) }))
  }
  return tokens
}

/** Marks the subagents the engine no longer lists as running. */
async function reconcileAgents($: EngineInterface): Promise<void> {
  const listed = await $.agent.list().catch(() => undefined)
  if (!listed) return
  const now = await $.clock.now()
  const running = new Set(
    listed.filter(a => a.status === 'running').map(a => a.id),
  )
  await update($, agents, list =>
    list.map(a =>
      a.endedAt === undefined && !running.has(a.id)
        ? { ...a, endedAt: now }
        : a,
    ),
  )
}

/* ----------------------------------------------------------------- */
/* Prompt-cache warming                                               */
/* ----------------------------------------------------------------- */

/** The chain's timer; a reload drops it, the next turn starts it again. */
let warmTimer: Timer | undefined
let maxPings = 0

function cancelWarm(): void {
  warmTimer?.cancel()
  warmTimer = undefined
}

function armWarm($: EngineInterface): void {
  warmTimer = $.clock.after(WARM_PERIOD_MS, () => {
    warmTimer = undefined
    void pingOnce($, false)
  })
}

/** A main-loop turn completed: the cache was just written, the idle period starts. */
async function restartWarm($: EngineInterface, hours: number): Promise<void> {
  cancelWarm()
  maxPings = pingsFor(hours)
  const now = await $.clock.now()
  await update($, cache, c => ({
    ...c,
    requestAt: now,
    pings: 0,
    nextPingAt: maxPings > 0 ? now + WARM_PERIOD_MS : null,
  }))
  if (maxPings > 0) armWarm($)
}

/** The person started a turn: their request warms the cache; the chain waits. */
async function pauseWarm($: EngineInterface): Promise<void> {
  cancelWarm()
  await update($, cache, c => ({ ...c, nextPingAt: null }))
}

/**
 * One ping: a fork over the transcript as last sent, served from cache. On
 * an answer the cache's clock restarts; a manual ping re-arms the chain too.
 */
async function pingOnce($: EngineInterface, isManual: boolean): Promise<boolean> {
  const before = await read($, cache)
  if (before.isPinging) return false
  if (!isManual && before.pings >= maxPings) return false

  await update($, cache, c => ({ ...c, isPinging: true }))
  const reply = await $.model.fork({ prompt: PING_PROMPT })
  const now = await $.clock.now()

  if (reply.isAnswered) {
    const pings = before.pings + (isManual ? 0 : 1)
    const hasMore = maxPings > 0 && pings < maxPings
    await update($, cache, c => ({
      ...c,
      isPinging: false,
      requestAt: now,
      pings,
      nextPingAt: hasMore ? now + WARM_PERIOD_MS : null,
    }))
    cancelWarm()
    if (hasMore) armWarm($)
    return true
  }

  await update($, cache, c => ({ ...c, isPinging: false, nextPingAt: null }))
  cancelWarm()
  const t = stringsFor(await messageLanguage($))
  $.ui.toast(`${t.pingFailed(forkFailure(reply))} (${formatClock(now)})`)
  return false
}

/* ----------------------------------------------------------------- */
/* Handoff                                                            */
/* ----------------------------------------------------------------- */

let countdownTimer: Timer | undefined
let countdownTicker: Timer | undefined

async function currentSlug($: EngineInterface): Promise<string> {
  return projectSlug(await $.session.cwd())
}

async function storedPending(
  $: EngineInterface,
  slug: string,
): Promise<ContextRelayPendingHandoff | null> {
  return parsePending(await $.store.get(storeKeyFor(slug)))
}

async function savePending(
  $: EngineInterface,
  slug: string,
  pending: ContextRelayPendingHandoff,
): Promise<void> {
  await $.store.set(storeKeyFor(slug), pending)
}

/** Forgets a handoff: the store entry and the file, best effort. */
async function cleanupPending(
  $: EngineInterface,
  slug: string,
  pending: ContextRelayPendingHandoff | null,
): Promise<void> {
  await $.store.delete(storeKeyFor(slug))
  if (pending) {
    await $.process
      .run(deleteArgv(pending.file), { timeoutMs: 10_000 })
      .catch(() => undefined)
  }
  await update($, handoff, (h): ContextRelayHandoff => ({ ...h, pending: null }))
}

/** The handoff waiting for this project, younger than 7 days; an older one is deleted. */
async function loadPending(
  $: EngineInterface,
  slug: string,
): Promise<ContextRelayPendingHandoff | null> {
  const pending = await storedPending($, slug)
  if (!pending) return null
  if (isExpired(pending, await $.clock.now())) {
    await cleanupPending($, slug, pending)
    return null
  }
  return pending
}

/** Whether the conversation was cleared: a new session id, or no turn left; logged. */
async function isCleared(
  $: EngineInterface,
  idBefore: string | null,
  step: string,
  outcome: string,
): Promise<boolean> {
  const id = await $.session.id().catch(() => null)
  const turns = await $.session.turns().catch(() => undefined)
  const isNewSession = typeof id === 'string' && idBefore !== null && id !== idBefore
  const cleared = isNewSession || turns === 0
  await logLine(
    $,
    `relay: ${step} ${outcome}; id=${typeof id === 'string' ? id : '?'} turns=${turns ?? '?'} -> ${cleared ? 'cleared' : 'not cleared'}`,
  )
  return cleared
}

/**
 * Collects the handoff and clears the chat. The delivery into the new
 * conversation happens in the `prompt.context` hook once `/clear` has run.
 */
/**
 * The handoff a `session.compact` of the mod's own replaces the conversation
 * with, framed in the language of the moment. The call is the mod's own, so
 * its session.compact hook is not run for it (re-entry); the registration's
 * `.catch` answers in its place from these two values alone.
 */
let relaying: string | null = null

const NOTE_TOKENS = 8000

/**
 * The note, asked over the cached transcript. A fork has nothing to run on
 * while the main thread has sent no request in this process (a resumed
 * session before its first new turn), so then the transcript is read with
 * `$.session.messages()` and sent whole, uncached, to the session's model.
 */
async function askForNote($: EngineInterface, prompt: string): Promise<ModelForkResult> {
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered || forked.reason !== 'nothing-to-fork') return forked

  const messages = await $.session.messages().catch(() => [])
  if ('deny' in messages || messages.length === 0) return forked
  const model = await $.session.model()
  const transcript = transcriptText(messages)
  await logLine(
    $,
    `relay: nothing to fork (resumed session?), asking ${model} over ${messages.length} transcript messages (${transcript.length} chars)`,
  )
  return $.model.complete({ model, prompt: `The conversation so far:\n\n${transcript}\n\n${prompt}`, maxTokens: NOTE_TOKENS })
}

async function collectHandoff(
  $: EngineInterface,
  handoffDir: unknown,
): Promise<boolean> {
  const language = await messageLanguage($)
  const t = stringsFor(language)
  const state = await read($, handoff)
  if (state.phase === 'collecting' || state.phase === 'clearing') return false

  await update($, handoff, (h): ContextRelayHandoff => ({
    ...h,
    phase: 'collecting',
    countdownEndsAt: null,
    error: null,
  }))
  $.ui.toast(t.collecting)

  const prompt = await $.fs.read(`${$.plugin.root}/assets/handoff-prompt.md`)
  const reply = await askForNote($, prompt)
  if (!reply.isAnswered) {
    const reason = forkFailure(reply)
    await logLine($, `relay: the note was not written: ${reason}`)
    await update($, handoff, (h): ContextRelayHandoff => ({
      ...h,
      phase: 'idle',
      error: reason,
    }))
    $.ui.toast(t.handoffFailed(reason))
    return false
  }

  const now = await $.clock.now()
  const slug = await currentSlug($)
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
  const file = handoffFileFor(handoffDirFor(handoffDir, home), slug, now)
  // One pending handoff per project: an older record and its file would
  // otherwise outlive this one and surface in some later conversation.
  await cleanupPending($, slug, await storedPending($, slug))
  await $.fs.write(file, reply.text)

  const pending: ContextRelayPendingHandoff = {
    file,
    text: reply.text,
    createdAt: now,
    isArmed: true,
  }
  await savePending($, slug, pending)
  await update($, handoff, (h): ContextRelayHandoff => ({
    ...h,
    phase: 'clearing',
    pending,
  }))
  $.ui.toast(t.clearing)
  const idBefore = await $.session.id().catch(() => null)
  const turnsBefore = await $.session.turns().catch(() => undefined)
  await logLine(
    $,
    `relay: handoff saved to ${file} (${reply.text.length} chars); id=${idBefore ?? '?'} turns=${turnsBefore ?? '?'}`,
  )

  // First the command itself, as the person would run it.
  const ran = await $.command.run({ command: 'clear' }).then(
    r => `ok${r.text ? ` (${errorText(r.text, 120)})` : ''}`,
    e => `failed: ${errorText(e)}`,
  )
  if (await isCleared($, idBefore, '$.command.run clear', ran)) return true

  // Then the same line submitted as a prompt: the path a typed /clear takes.
  const submitted = await $.prompt.submit({ text: '/clear', asUser: true }).then(
    r => `ok (${errorText(r, 160)})`,
    e => `failed: ${errorText(e)}`,
  )
  if (await isCleared($, idBefore, '$.prompt.submit /clear', submitted)) return true

  // Neither took here: replace the conversation with the handoff through a
  // compaction of the mod's own, which the session.compact registration's
  // .catch below answers with the note alone.
  $.ui.toast(t.compacting)
  relaying = frameHandoff(pending, language)
  const compacted: SessionCompactResult = await $.session.compact().then(
    r => r,
    e => ({ skip: `$.session.compact: ${errorText(e)}` }),
  )
  relaying = null
  if (compacted.messages === undefined) {
    const reason = compacted.skip || t.clearUnavailable
    await logLine($, `relay: compaction did not take: ${reason}`)
    await update($, handoff, (h): ContextRelayHandoff => ({
      ...h,
      phase: 'armed',
      error: reason,
    }))
    $.ui.toast(t.handoffFailed(reason))
    return false
  }
  await logLine(
    $,
    `relay: conversation replaced by compaction (${compacted.messages.length} messages, ${compacted.tokensAfter ?? '?'} tokens after)`,
  )
  await cleanupPending($, slug, pending)
  await update($, readings, () => [])
  await update($, stormToasted, () => false)
  await update($, handoff, (h): ContextRelayHandoff => ({
    ...h,
    phase: 'idle',
    pending: null,
    error: null,
  }))
  $.ui.toast(t.replaced(formatClock(now)), { timeoutMs: 6000 })
  return true
}

/**
 * The Load press on a handoff found at session start. With turns already in
 * the conversation the note is appended as a hidden user row at once; before
 * the first turn it is armed for the `prompt.context` delivery.
 */
async function armPending($: EngineInterface): Promise<void> {
  const slug = await currentSlug($)
  const pending = await loadPending($, slug)
  if (!pending) {
    await update($, handoff, (h): ContextRelayHandoff => ({ ...h, pending: null }))
    return
  }
  const language = await messageLanguage($)
  const t = stringsFor(language)
  if ((await $.session.turns()) > 0) {
    const result = await $.session.append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: frameHandoff(pending, language) }],
      },
    })
    if ('deny' in result && result.deny !== undefined) {
      $.ui.toast(t.handoffFailed(result.deny))
      return
    }
    await cleanupPending($, slug, pending)
    $.ui.toast(t.loaded(formatClock(pending.createdAt)))
    return
  }
  const armed: ContextRelayPendingHandoff = { ...pending, isArmed: true }
  await savePending($, slug, armed)
  await update($, handoff, (h): ContextRelayHandoff => ({ ...h, pending: armed }))
  $.ui.invalidate('prompt.context')
}

async function dismissPending($: EngineInterface): Promise<void> {
  const slug = await currentSlug($)
  await cleanupPending($, slug, await storedPending($, slug))
}

function stopCountdownTimers(): void {
  countdownTimer?.cancel()
  countdownTicker?.cancel()
  countdownTimer = undefined
  countdownTicker = undefined
}

/**
 * Puts the question under the band and arms the automatic handoff: the
 * countdown row draws from `$.state` and the ticker redraws it each second.
 * Silence is Yes: when the time runs out the handoff is collected.
 */
async function startCountdown(
  $: EngineInterface,
  seconds: number,
  handoffDir: unknown,
): Promise<void> {
  const now = await $.clock.now()
  const t = stringsFor(await messageLanguage($))
  await update($, handoff, (h): ContextRelayHandoff => ({
    ...h,
    phase: 'countdown',
    countdownEndsAt: now + seconds * 1000,
  }))
  stopCountdownTimers()
  countdownTicker = $.clock.every(1000, () => {
    void update($, tick, n => n + 1)
  })
  countdownTimer = $.clock.after(seconds * 1000, () => {
    void finishCountdown($, handoffDir)
  })
  $.ui.toast(`${t.autoTitle}: ${t.autoBody(formatTokens(await lastTokens($)))}`, { timeoutMs: 8000 })
}

async function lastTokens($: EngineInterface): Promise<number> {
  const readingList = await read($, readings)
  return readingList[readingList.length - 1]?.tokens ?? 0
}

/** Yes pressed, or the countdown ran out: collect the handoff, clear the chat, load it in the new one. */
async function finishCountdown($: EngineInterface, handoffDir: unknown): Promise<void> {
  stopCountdownTimers()
  const state = await read($, handoff)
  if (state.phase !== 'countdown') return
  await collectHandoff($, handoffDir)
}

/** No pressed: the chat stays as it is; automation waits for the next crossing of the threshold. */
async function cancelCountdown($: EngineInterface): Promise<void> {
  stopCountdownTimers()
  const state = await read($, handoff)
  if (state.phase === 'countdown') {
    await update($, handoff, (h): ContextRelayHandoff => ({
      ...h,
      phase: 'idle',
      countdownEndsAt: null,
    }))
  }
}

/* ----------------------------------------------------------------- */
/* Drawing                                                            */
/* ----------------------------------------------------------------- */

/** Reads every value the band draws from; while drawing, that subscribes the band. */
async function snapshot(
  $: EngineInterface,
  surface: string,
  bandsSetting: unknown,
  warmSetting: unknown,
): Promise<Snapshot> {
  const readingList = await read($, readings)
  const cacheState = await read($, cache)
  const agentList = await read($, agents)
  const costState = await read($, cost)
  const handoffState = await read($, handoff)
  const language = await read($, lang)
  const isExpandedNow = await read($, isExpanded)
  await read($, tick)
  const now = await $.clock.now()
  const bands = parseBands(bandsSetting)
  const last = readingList[readingList.length - 1]
  const tokens = last?.tokens
  const band = bandOf(tokens ?? 0, bands)
  const deltas = deltasOf(readingList).slice(-12)
  const hours = warmHours(warmSetting)
  return {
    tokens,
    window: last?.window,
    band,
    color: BAND_STYLE[band].color,
    deltas,
    lastDelta: deltas[deltas.length - 1],
    cacheLeft: cacheLeftMs(cacheState, now),
    cacheHit: cacheState.hitPercent,
    isPinging: cacheState.isPinging,
    pings: cacheState.pings,
    maxPings: pingsFor(hours),
    warmIsOn: hours > 0,
    agents: agentList,
    running: agentList.filter(a => a.endedAt === undefined).length,
    cost: costState,
    handoff: handoffState,
    isExpanded: isExpandedNow,
    t: stringsFor(languageForSurface(language, surface)),
    now,
  }
}

/* ----------------------------------------------------------------- */
/* The hooks                                                          */
/* ----------------------------------------------------------------- */

export const register: Register = (on, options) => {
  const bands = parseBands(options['bands'])
  const hours = warmHours(options['warm'])
  const autoAt = autoHandoffAt(options['autoHandoffAt'])
  const seconds = countdownSeconds(options['countdownSeconds'])
  const handoffDir = options['handoffDir']

  on('session.start', async ($, e, next) => {
    const id = await $.session.id().catch(() => null)
    if (typeof id === 'string') knownSessionId = id
    isBeginning = true
    try {
      await beginSession($, e.cwd, `session.start, surface ${e.surface ?? 'none'}`)
    } finally {
      isBeginning = false
    }
    return next(e)
  })

  on('command.run', { command: 'relay' }, async $ => {
    await ensureSession($, '/relay')
    const t = stringsFor(await messageLanguage($))
    const started = await collectHandoff($, handoffDir)
    return { text: started ? t.clearing : t.handoffFailed('busy') }
  })

  on('command.run', { command: 'relay-warm' }, async $ => {
    await ensureSession($, '/relay-warm')
    const t = stringsFor(await messageLanguage($))
    const isWarm = await pingOnce($, true)
    return { text: isWarm ? `${t.cache}: OK` : t.pingFailed('see the band') }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      void ensureSession($, 'turn.start')
      await pauseWarm($)
    } else {
      const id = e.agentId
      const now = await $.clock.now()
      await update($, agents, list =>
        list.some(a => a.id === id)
          ? list.map(a => (a.id === id ? { ...a, endedAt: undefined } : a))
          : [
              ...list,
              { id, name: e.text.slice(0, 40), type: 'agent', startedAt: now },
            ].slice(-50),
      )
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result && result.agentId !== undefined) {
      const id = result.agentId
      const now = await $.clock.now()
      const model = result.model || e.model || e.parentModel
      await update($, agents, list =>
        [
          ...list.filter(a => a.id !== id),
          {
            id,
            name: e.description,
            type: e.subagentType,
            ...(model ? { model: modelLabel(model) } : {}),
            startedAt: now,
          },
        ].slice(-50),
      )
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const now = await $.clock.now()
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, endedAt: now } : a)),
      )
      return next(e)
    }

    await ensureSession($, 'turn.complete')
    const tokens = await takeReading($, false)
    await restartWarm($, hours)
    if (e.usage !== undefined) {
      const hit = cacheHitPercent(e.usage)
      await update($, cache, c => ({ ...c, hitPercent: hit }))
    }
    await update($, handoff, (h): ContextRelayHandoff =>
      h.error === null ? h : { ...h, error: null },
    )

    if (tokens !== undefined) {
      const t = stringsFor(await messageLanguage($))
      const band = bandOf(tokens, bands)
      const toasted = await read($, stormToasted)
      if (band === 'storm' && !toasted) {
        $.ui.toast(t.stormToast(formatTokens(tokens)), { timeoutMs: 8000 })
        await update($, stormToasted, () => true)
      } else if (band !== 'storm' && toasted) {
        await update($, stormToasted, () => false)
      }

      const handoffState = await read($, handoff)
      if (
        autoAt > 0 &&
        tokens >= autoAt &&
        handoffState.phase === 'idle' &&
        !e.isAborted
      ) {
        await startCountdown($, seconds, handoffDir)
      }
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined && relaying !== null) {
      return { messages: [{ role: 'user' as const, text: relaying, toolUses: [] }] }
    }
    if (e.agentId === undefined) {
      await logLine($, `session.compact: trigger=${e.trigger}, ${e.messages.length} messages`)
    }
    const result = await next(e)
    if (e.agentId === undefined && result.messages !== undefined) {
      await takeReading($, true, result.tokensAfter)
      await update($, stormToasted, () => false)
    }
    return result
  }).catch(($, e, next) => {
    // Asked in the hook's place on re-entry (the mod's own $.session.compact):
    // answer the handoff alone, with no call on `$`.
    if (e.agentId === undefined && relaying !== null) {
      return { messages: [{ role: 'user' as const, text: relaying, toolUses: [] }] }
    }
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const slug = await currentSlug($)
    const pending = await loadPending($, slug)
    if (!pending || !pending.isArmed) return next(e)
    const language = await messageLanguage($)
    const t = stringsFor(language)
    const result = await next(e)
    const block = { name: CONTEXT_BLOCK, text: frameHandoff(pending, language) }
    await logLine($, `prompt.context: handoff ${formatClock(pending.createdAt)} delivered`)
    await cleanupPending($, slug, pending)
    await update($, handoff, (h): ContextRelayHandoff => ({
      ...h,
      phase: 'idle',
      pending: null,
    }))
    $.ui.toast(t.loaded(formatClock(pending.createdAt)), { timeoutMs: 6000 })
    return { ...result, blocks: [block, ...result.blocks] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (!isBeginning) {
      // After a /clear no session.start comes; the first drawing begins it.
      const id = await $.session.id().catch(() => null)
      if (typeof id === 'string' && id !== knownSessionId) {
        $.clock.after(1, () => {
          void ensureSession($, 'ui.render')
        })
      }
    }
    const s = await snapshot($, e.surface, options['bands'], options['warm'])
    const handlers: Handlers = {
      relay: () => {
        void collectHandoff($, handoffDir)
      },
      ping: () => {
        void pingOnce($, true)
      },
      load: () => {
        void armPending($)
      },
      dismiss: () => {
        void dismissPending($)
      },
      toggle: () => {
        void update($, isExpanded, v => !v)
      },
      yes: () => {
        void finishCountdown($, handoffDir)
      },
      no: () => {
        void cancelCountdown($)
      },
    }
    const ours =
      e.surface === 'desktop'
        ? drawDesktopBand($.ui.resolve(e), s, handlers)
        : drawTextualBand($.ui.resolve(e), s, handlers)
    const rest = await next(e).catch(() => undefined)
    if (!rest) return ours
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {ours}
        {rest}
      </Box>
    )
  })

  on('session.end', async ($, e, next) => {
    cancelWarm()
    stopCountdownTimers()
    ticker?.cancel()
    ticker = undefined
    await logLine($, `session.end: reason=${e.reason} id=${e.sessionId}`)
    if (e.reason === 'clear') {
      // The process goes on under a new session id with no session.start:
      // forget this one, so the next hook or drawing begins the new one.
      knownSessionId = null
      await update($, readings, () => [])
      await update($, agents, () => [])
      await update($, cost, c => ({ ...c, lastUsd: 0 }))
      await update($, stormToasted, () => false)
      await update($, cache, c => ({
        ...c,
        requestAt: null,
        pings: 0,
        nextPingAt: null,
        isPinging: false,
        hitPercent: null,
      }))
      await update($, handoff, (h): ContextRelayHandoff => ({
        ...h,
        phase: h.phase === 'clearing' ? 'armed' : 'idle',
        countdownEndsAt: null,
        error: null,
      }))
    }
    return next(e)
  })
}
