import { joinPath } from './handoff'

/**
 * The mod's own log, the pure part: where it lives, how a line is added and
 * how an error is spelled. Writing it is register.tsx's job.
 */

/** The log never grows past this many characters; the oldest lines go first. */
export const LOG_CAP = 64_000

/** `~/.claude/context-relay/context-relay.log`. */
export function logFileFor(home: string): string {
  return joinPath(home, '.claude', 'context-relay', 'context-relay.log')
}

/** The log with `line` appended, trimmed from the top to `cap` at a line boundary. */
export function appendLog(existing: string, line: string, cap = LOG_CAP): string {
  const base = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing
  const next = `${base}${line.replace(/\r?\n/g, ' ⏎ ')}\n`
  if (next.length <= cap) return next
  const cut = next.length - cap
  const newline = next.indexOf('\n', Math.max(0, cut - 1))
  return newline === -1 ? next.slice(cut) : next.slice(newline + 1)
}

/** A thrown value as one short line. */
export function errorText(e: unknown, max = 240): string {
  const text =
    e instanceof Error
      ? e.message
      : typeof e === 'string'
        ? e
        : e === undefined
          ? 'undefined'
          : (() => {
              try {
                return JSON.stringify(e)
              } catch {
                return String(e)
              }
            })()
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
