import { HOUR_MS, MINUTE_MS } from './state'

/**
 * Prompt-cache warming, the pure part: the period, the prompt and the
 * arithmetic. The chain itself (timers, the fork) lives in register.tsx,
 * where the engine can follow every `$` call.
 */

/** Ping at minute 55: a margin for latency and TTL uncertainty. */
export const WARM_PERIOD_MS = 55 * MINUTE_MS

export const PING_PROMPT = 'Reply with the single word OK.'

/** How many pings one idle period may send for the configured hours. */
export function pingsFor(hours: number): number {
  return hours > 0 ? Math.floor((hours * HOUR_MS) / WARM_PERIOD_MS) : 0
}

/** The TTL the environment asks for: FORCE_PROMPT_CACHING_5M or CLAUDE_CODE_PROMPT_CACHE_TTL=5m give 5 minutes, else 1 hour. */
export function ttlFromEnv(
  forced5m: string | undefined,
  ttl: string | undefined,
): number {
  if (forced5m !== undefined && forced5m !== '' && forced5m !== '0') {
    return 5 * MINUTE_MS
  }
  if (ttl === '5m') return 5 * MINUTE_MS
  return HOUR_MS
}

/** Milliseconds until the cache cools, or 0 once it has; null before the first request. */
export function cacheLeftMs(
  c: { requestAt: number | null; ttlMs: number },
  now: number,
): number | null {
  if (c.requestAt === null) return null
  return Math.max(0, c.requestAt + c.ttlMs - now)
}

/** A short reason for a fork that did not answer. */
export function forkFailure(reply: {
  isAnswered: false
  reason: string
  status?: number | null
}): string {
  if (reply.reason === 'api-error') return `API ${reply.status ?? '?'}`
  if (reply.reason === 'nothing-to-fork') return 'nothing in the conversation yet'
  return reply.reason
}
