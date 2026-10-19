import type { ContextRelayBand, ContextRelayLanguage } from '../types'

export type Strings = {
  band: Record<ContextRelayBand, string>
  window: string
  recentTurns: string
  lastTurn: string
  limit5h: string
  limit7d: string
  limit5hLong: string
  limit7dLong: string
  used: string
  elapsed: string
  left: string
  resetsAt: (clock: string) => string
  pace: (points: number) => string
  onPace: string
  cache: string
  cacheLong: string
  cacheCold: string
  cacheHit: (percent: number) => string
  ping: string
  pinging: string
  pingFailed: (reason: string) => string
  pings: (used: number, max: number) => string
  pingCost: string
  warmOff: string
  cost: string
  lastPrompt: string
  agents: string
  agentsNone: string
  agentsCounts: (running: number, finished: number, total: number) => string
  handoff: string
  collecting: string
  clearing: string
  compacting: string
  loaded: (clock: string) => string
  replaced: (clock: string) => string
  handoffFailed: (reason: string) => string
  clearUnavailable: string
  pendingRow: (clock: string) => string
  load: string
  dismiss: string
  readyRow: string
  autoTitle: string
  autoBody: (tokens: string, seconds: number) => string
  now: string
  cancel: string
  stormToast: (tokens: string) => string
  expand: string
  collapse: string
}

const en: Strings = {
  band: { clear: 'Clear', overcast: 'Overcast', rain: 'Rain', storm: 'Storm' },
  window: 'window',
  recentTurns: 'Recent turns',
  lastTurn: 'last turn',
  limit5h: '5h',
  limit7d: '7d',
  limit5hLong: '5-hour limit',
  limit7dLong: '7-day limit',
  used: 'used',
  elapsed: 'elapsed',
  left: 'left',
  resetsAt: clock => `Resets at ${clock}`,
  pace: points => `${points} pts ahead of the clock`,
  onPace: 'behind the clock, fine',
  cache: 'cache',
  cacheLong: 'Prompt cache',
  cacheCold: 'expired',
  cacheHit: percent => `${percent}% of the last prompt served from cache`,
  ping: 'Warm the cache now',
  pinging: 'warming…',
  pingFailed: reason => `Cache warm-up failed: ${reason}`,
  pings: (used, max) => `Warm-up pings ${used}/${max}`,
  pingCost: 'one ping reads the whole context from cache',
  warmOff: 'Warm-up off',
  cost: 'Session cost',
  lastPrompt: 'last prompt',
  agents: 'Subagents',
  agentsNone: 'No subagents yet',
  agentsCounts: (running, finished, total) =>
    `${running} running · ${finished} finished · ${total} total`,
  handoff: 'Hand the context over to a fresh chat',
  collecting: 'Collecting the handoff…',
  clearing: 'Handoff saved, clearing the chat…',
  compacting: 'Chat not cleared here; replacing the conversation with the handoff…',
  loaded: clock => `Context loaded from the ${clock} handoff`,
  replaced: clock => `Conversation replaced with the ${clock} handoff`,
  handoffFailed: reason => `Handoff failed: ${reason}`,
  clearUnavailable: 'the chat could not be cleared or compacted here',
  pendingRow: clock => `Handoff from ${clock} is waiting`,
  load: 'Load',
  dismiss: 'Dismiss',
  readyRow: 'Handoff ready: it loads with your next message',
  autoTitle: 'Automatic handoff',
  autoBody: (tokens, seconds) =>
    `Context is at ${tokens} tokens. In ${seconds}s the handoff is collected and the chat cleared.`,
  now: 'Now',
  cancel: 'Cancel',
  stormToast: tokens =>
    `Storm: ${tokens} tokens in context. Consider handing over (⇄).`,
  expand: 'Show details',
  collapse: 'Hide details',
}

const ru: Strings = {
  band: { clear: 'Ясно', overcast: 'Пасмурно', rain: 'Дождь', storm: 'Гроза' },
  window: 'окно',
  recentTurns: 'Последние ходы',
  lastTurn: 'последний ход',
  limit5h: '5ч',
  limit7d: '7д',
  limit5hLong: 'Лимит 5 часов',
  limit7dLong: 'Лимит 7 дней',
  used: 'израсходовано',
  elapsed: 'прошло',
  left: 'осталось',
  resetsAt: clock => `Сброс в ${clock}`,
  pace: points => `на ${points} п. впереди времени`,
  onPace: 'позади времени, норма',
  cache: 'кэш',
  cacheLong: 'Кэш промпта',
  cacheCold: 'остыл',
  cacheHit: percent => `${percent}% последнего запроса из кэша`,
  ping: 'Подогреть кэш сейчас',
  pinging: 'подогрев…',
  pingFailed: reason => `Подогрев кэша не удался: ${reason}`,
  pings: (used, max) => `Пинги подогрева ${used}/${max}`,
  pingCost: 'один пинг читает весь контекст из кэша',
  warmOff: 'Подогрев выключен',
  cost: 'Стоимость сессии',
  lastPrompt: 'последний запрос',
  agents: 'Субагенты',
  agentsNone: 'Субагентов ещё не было',
  agentsCounts: (running, finished, total) =>
    `${running} работает · ${finished} завершено · ${total} всего`,
  handoff: 'Передать контекст в новый чат',
  collecting: 'Собираю сводку…',
  clearing: 'Сводка сохранена, очищаю чат…',
  compacting: 'Чат здесь не очищается; заменяю беседу сводкой…',
  loaded: clock => `Контекст загружен из сводки ${clock}`,
  replaced: clock => `Беседа заменена сводкой ${clock}`,
  handoffFailed: reason => `Передача не удалась: ${reason}`,
  clearUnavailable: 'чат здесь не удалось ни очистить, ни сжать',
  pendingRow: clock => `Ждёт сводка от ${clock}`,
  load: 'Загрузить',
  dismiss: 'Убрать',
  readyRow: 'Сводка готова: загрузится с вашим следующим сообщением',
  autoTitle: 'Автоматическая передача',
  autoBody: (tokens, seconds) =>
    `В контексте ${tokens} токенов. Через ${seconds} с сводка будет собрана, а чат очищен.`,
  now: 'Сейчас',
  cancel: 'Отмена',
  stormToast: tokens =>
    `Гроза: ${tokens} токенов в контексте. Подумайте о передаче (⇄).`,
  expand: 'Показать детали',
  collapse: 'Скрыть детали',
}

export const STRINGS: Record<ContextRelayLanguage, Strings> = { en, ru }

export function stringsFor(language: ContextRelayLanguage): Strings {
  return STRINGS[language] ?? en
}

/** `ru*` → Russian, anything else English. */
export function languageOf(locale: string | undefined): ContextRelayLanguage {
  return locale !== undefined && /^ru/i.test(locale.trim()) ? 'ru' : 'en'
}

/** The desktop draws in the system's language; every other surface in English. */
export function languageForSurface(
  system: ContextRelayLanguage,
  surface: string | null | undefined,
): ContextRelayLanguage {
  return surface === 'desktop' ? system : 'en'
}
