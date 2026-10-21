import { formatClock, formatStamp } from './bands'
import type { ContextRelayLanguage, ContextRelayPendingHandoff } from '../types'

/**
 * The handoff, the pure part: names, paths, the store record and the text
 * the model reads. The flow (fork, file, /clear, delivery) is in
 * register.tsx, where the engine can follow every `$` call.
 */

export const STORE_PREFIX = 'handoff:'
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
/** The name of the context block the handoff rides in. */
export const CONTEXT_BLOCK = 'contextRelayHandoff'

/** The last path segment, made safe for a file name. */
export function projectSlug(cwd: string): string {
  const segment = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'project'
  const slug = segment.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'project'
}

export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')
}

export function joinPath(base: string, ...parts: string[]): string {
  const sep = isWindowsPath(base) ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

/** The folder handoffs go to: the setting, or ~/.claude/context-relay/handoff. */
export function handoffDirFor(configured: unknown, home: string): string {
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/[\\/]+$/, '')
  }
  return joinPath(home, '.claude', 'context-relay', 'handoff')
}

export function handoffFileFor(dir: string, slug: string, at: number): string {
  return joinPath(dir, slug, `${formatStamp(at)}.md`)
}

export function storeKeyFor(slug: string): string {
  return `${STORE_PREFIX}${slug}`
}

/** The argv that deletes a file on this platform. */
export function deleteArgv(path: string): string[] {
  return isWindowsPath(path)
    ? ['cmd', '/c', 'del', '/q', path]
    : ['rm', '-f', path]
}

/** Reads a store record back, or null when it is not one. */
export function parsePending(raw: unknown): ContextRelayPendingHandoff | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<ContextRelayPendingHandoff>
  if (typeof p.file !== 'string' || typeof p.text !== 'string') return null
  return {
    file: p.file,
    text: p.text,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
    isArmed: p.isArmed === true,
  }
}

export function isExpired(pending: ContextRelayPendingHandoff, now: number): boolean {
  return now - pending.createdAt > SEVEN_DAYS_MS
}

/** The text as the model reads it: headed, dated, with the note whole. */
export function frameHandoff(
  pending: ContextRelayPendingHandoff,
  language: ContextRelayLanguage,
): string {
  const clock = formatClock(pending.createdAt)
  const head =
    language === 'ru'
      ? `Сводка предыдущего чата (собрана в ${clock}). Продолжай работу с этого состояния; не пересказывай сводку, если тебя не просят.`
      : `Handoff from the previous chat (collected at ${clock}). Continue the work from this state; do not recite the handoff unless asked.`
  return `${head}\n\n${pending.text.trim()}\n`
}
