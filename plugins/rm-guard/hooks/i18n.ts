/**
 * The words of the question put to the person. What the model reads (the
 * refusal texts) stays English; only this dialog is translated.
 */

export type Language = 'en' | 'ru'

export type Strings = {
  header: string
  banner: string
  intro: string
  dynamic: string
  stdin: string
  search: (where: string) => string
  more: (n: number) => string
  command: string
  question: string
  /** The pane's two buttons. */
  yes: string
  no: string
  /** The toast that says a question waits above the prompt. */
  waiting: string
  /** The fallback dialog's two options. */
  allow: string
  deny: string
}

const en: Strings = {
  header: 'rm-guard',
  banner: 'rm-guard: deleting files needs your approval',
  intro: 'The agent wants to delete:',
  dynamic: 'path is unknown until it runs',
  stdin: 'paths produced by another command',
  search: where => `everything found under ${where}`,
  more: n => `and ${n} more`,
  command: 'Command',
  question: 'Allow it?',
  yes: 'Delete',
  no: 'Cancel',
  waiting: 'rm-guard: confirm the deletion above the prompt',
  allow: 'Allow once',
  deny: 'Deny',
}

const ru: Strings = {
  header: 'rm-guard',
  banner: 'rm-guard: удаление файлов требует вашего согласия',
  intro: 'Агент хочет удалить:',
  dynamic: 'путь станет известен только при запуске',
  stdin: 'пути, которые выдаст другая команда',
  search: where => `всё, что найдётся в ${where}`,
  more: n => `и ещё ${n}`,
  command: 'Команда',
  question: 'Разрешить?',
  yes: 'Удалить',
  no: 'Отменить',
  waiting: 'rm-guard: подтвердите удаление над полем ввода',
  allow: 'Разрешить один раз',
  deny: 'Запретить',
}

export function stringsFor(language: Language): Strings {
  return language === 'ru' ? ru : en
}

export function languageOf(locale: string | undefined): Language {
  return locale !== undefined && /^ru/i.test(locale.trim()) ? 'ru' : 'en'
}

/** The desktop draws in the system's language; every other surface in English. */
export function languageForSurface(system: Language, isDesktop: boolean): Language {
  return isDesktop ? system : 'en'
}

/** Both answers a person may give, in either language, so a language change never misreads one. */
export function isAllow(answer: string): boolean {
  return answer === en.allow || answer === ru.allow
}

export function isDeny(answer: string): boolean {
  return answer === en.deny || answer === ru.deny
}

/** The dialog's Skip button answers `[No preference]`; it is a refusal without words. */
export function isSkip(answer: string): boolean {
  return /^\[No preference\]/i.test(answer.trim()) || answer.trim() === ''
}
