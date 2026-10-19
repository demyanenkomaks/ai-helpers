import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { isAllow, isDeny, isSkip, languageForSurface, languageOf, stringsFor } from './i18n'
import type { Language, Strings } from './i18n'
import { allowFrom, commandsFrom, display, judge } from './parse'
import type { Policy, Shell, Target } from './parse'
import type { RmGuardAsking } from '../types'

const TOOLS: ReadonlyArray<readonly [tool: string, shell: Shell]> = [
  ['Bash', 'bash'],
  ['PowerShell', 'powershell'],
]

const HINT =
  'Do not delete it yourself: move it to the trash or a scratch folder, or tell the user the exact command and let them run it.'

/** The chip of the fallback dialog, which the render hook below recognises it by. */
const HEADER = 'rm-guard'
const RED = '#d64545'
const LISTED = 15
/** A hook has 10 s of its own time per dispatch, a `$` call in flight excepted, so the wait is made of `$` calls. */
const PAUSE_MS = 1000
const WAIT_LIMIT_MS = 10 * 60_000

const asking = atom({ plugin: 'rm-guard', key: 'asking' } as const, null)

const shorten = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

/**
 * The system's language, asked once per load. The desktop draws in it; the
 * terminal stays English (languageForSurface), so the surface is read at
 * the moment of the question, never here.
 */
let systemLanguage: Language | undefined

async function detectSystemLanguage($: EngineInterface, cwd: string): Promise<Language> {
  if (systemLanguage !== undefined) return systemLanguage
  const fromEnv =
    (await $.env.get('LC_ALL')) ?? (await $.env.get('LC_MESSAGES')) ?? (await $.env.get('LANG'))
  if (fromEnv !== undefined && fromEnv !== '') return (systemLanguage = languageOf(fromEnv))
  if (/^[A-Za-z]:[\\/]/.test(cwd)) {
    const culture = await $.process
      .run(['powershell', '-NoProfile', '-Command', '(Get-Culture).Name'], { timeoutMs: 10_000 })
      .catch(() => undefined)
    if (culture && culture.exitCode === 0) return (systemLanguage = languageOf(culture.stdout))
  }
  return 'en'
}

/** One line per path that would be deleted, duplicates folded and the list capped. */
export function itemsFor(t: Strings, targets: readonly Target[], cwd: string): string[] {
  const lines = [
    ...new Set(
      targets.map(x => {
        if (x.kind === 'stdin') return `• ${t.stdin}`
        if (x.kind === 'search') return `• ${t.search(display(x.text, cwd))}`
        if (x.dynamic) return `• ${x.text}  (${t.dynamic})`
        return `• ${display(x.text, cwd)}`
      }),
    ),
  ]
  const shown = lines.slice(0, LISTED)
  if (lines.length > LISTED) shown.push(`• ${t.more(lines.length - LISTED)}`)
  return shown
}

/** The question as one text, for the fallback dialog. */
export function questionFor(t: Strings, targets: readonly Target[], command: string, cwd: string): string {
  const items = itemsFor(t, targets, cwd).map(x => `  ${x}`)
  return [t.intro, '', ...items, '', `${t.command}: ${shorten(command, 400)}`, '', t.question].join('\n')
}

/* ----------------------------------------------------------------- */
/* Asking: two buttons above the prompt, else the engine's dialog     */
/* ----------------------------------------------------------------- */

/** The buttons' callbacks: closures cannot live in `$.state`, so they wait here, by question id. */
const waiting = new Map<number, (isAllowed: boolean) => void>()
let sequence = 0
/** One question at a time: parallel deletions queue behind each other. */
let line: Promise<unknown> = Promise.resolve()

/** A button was pressed: settle the question and take the buttons down. */
async function settle($: EngineInterface, id: number, isAllowed: boolean): Promise<void> {
  const resolve = waiting.get(id)
  if (resolve === undefined) return
  waiting.delete(id)
  resolve(isAllowed)
  await update($, asking, () => null).catch(() => undefined)
}

/** The buttons' answer: the band above the prompt draws the question from `$.state` while it waits. */
async function askAbovePrompt(
  $: EngineInterface,
  view: Omit<RmGuardAsking, 'id'>,
  isWindows: boolean,
): Promise<boolean> {
  const id = ++sequence
  const answer = new Promise<boolean>(resolve => waiting.set(id, resolve))
  await update($, asking, () => ({ id, ...view }))
  $.ui.toast(stringsFor(view.language).waiting)
  const isAllowed = await holdUntil($, isWindows, answer)
  if (waiting.has(id)) await settle($, id, false)
  return isAllowed
}

/**
 * Waits for the answer without spending the hook's own time. Awaiting a
 * promise of the mod's own would: a person who needs more than ten seconds
 * would find the guard failed. A `$` call in flight does not count, so the wait
 * is a one-second sleep raced against the answer, over and over; a sleep that
 * does not hold (a mocked process, a missing `sleep`) falls back to awaiting
 * the answer itself. Past ten minutes the question is dropped as a refusal.
 */
async function holdUntil($: EngineInterface, isWindows: boolean, answer: Promise<boolean>): Promise<boolean> {
  let decided: boolean | undefined
  void answer.then(value => {
    decided = value
  })
  const startedAt = await $.clock.now()
  const pause = async (): Promise<void> => {
    const before = await $.clock.now()
    await $.process
      .run(isWindows ? ['ping', '-n', '2', '127.0.0.1'] : ['sleep', '1'], { timeoutMs: 5000 })
      .catch(() => undefined)
    if ((await $.clock.now()) - before < PAUSE_MS / 2) await answer
  }
  while (decided === undefined && (await $.clock.now()) - startedAt < WAIT_LIMIT_MS) {
    await Promise.race([answer, pause()])
  }
  return decided ?? false
}

type Answer = { isAllowed: boolean; words?: string }

/** Asks the person; rejects when nobody can be asked. */
async function ask(
  $: EngineInterface,
  t: Strings,
  language: Language,
  targets: readonly Target[],
  command: string,
  cwd: string,
  isDrawn: boolean,
): Promise<Answer> {
  if (isDrawn) {
    const isAllowed = await askAbovePrompt(
      $,
      { items: itemsFor(t, targets, cwd), command: shorten(command, 400), language },
      /^[A-Za-z]:[\\/]/.test(cwd),
    )
    return { isAllowed }
  }

  const answer = await $.ui.ask(questionFor(t, targets, command, cwd), {
    options: [t.allow, t.deny],
    header: HEADER,
  })
  if (isAllow(answer)) return { isAllowed: true }
  return isDeny(answer) || isSkip(answer) ? { isAllowed: false } : { isAllowed: false, words: answer }
}

export const register: Register = (on, options) => {
  const commands = commandsFrom(options['commands'])
  const allow = allowFrom(options['allowPaths'])

  for (const [tool, shell] of TOOLS) {
    // A tool.call hook, not tool.check: an `ask` verdict goes to the permission
    // mode's decider, which auto mode answers itself, so the question to the
    // person is put here, with buttons of the mod's own, in every mode.
    on('tool.call', { tool }, async ($, e, next) => {
      const command = (e as { command?: unknown }).command
      if (typeof command !== 'string') return next(e)

      const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
      const cwd = await $.session.cwd()
      const policy: Policy = { commands, allow, home, cwd, shell }

      const verdict = judge(command, policy)
      if (verdict.decision === 'allow') return next(e)

      const why = verdict.reason ?? 'deletion'
      if (verdict.decision === 'deny') {
        return { deny: `${$.plugin.name}: ${why}. ${HINT}` }
      }

      const surfaces = await $.session.surfaces().catch(() => [] as readonly string[])
      const language = languageForSurface(
        await detectSystemLanguage($, cwd),
        surfaces.includes('desktop'),
      )
      const t = stringsFor(language)

      const turn = line.then(() =>
        ask($, t, language, verdict.targets ?? [], command, cwd, surfaces.length > 0),
      )
      line = turn.catch(() => undefined)
      let answer: Answer
      try {
        answer = await turn
      } catch {
        return { deny: `${$.plugin.name}: ${why}. The user could not be asked, so nothing was deleted. ${HINT}` }
      }
      if (answer.isAllowed) return next(e)

      const note = answer.words === undefined ? '' : ` Their words: ${shorten(answer.words, 300)}`
      return { deny: `${$.plugin.name}: the user refused this deletion (${why}).${note} Do not retry it.` }
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: the guard failed, so the command is refused. ${HINT}` },
    )
  }

  // The question, in the chat just above the prompt, under whatever band
  // other plugins draw there. It draws while `$.state` holds a question.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const view = await read($, asking)
    if (view === null || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = stringsFor(view.language)
    const rest = await next(e).catch(() => undefined)

    const question = (
      <Box flexDirection="column" borderStyle="round" borderColor={RED} paddingX={1}>
        <Text bold color={RED}>
          ⚠ {t.banner}
        </Text>
        <Text>{t.intro}</Text>
        <Text>{view.items.join('\n')}</Text>
        <Text dimColor>
          {t.command}: {view.command}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="rm-guard-allow" variant="primary" hotkey="1" onPress={() => void settle($, view.id, true)}>
            {t.yes}
          </Button>
          <Button key="rm-guard-deny" autoFocus hotkey="2" onPress={() => void settle($, view.id, false)}>
            {t.no}
          </Button>
        </Box>
      </Box>
    )
    if (!rest) return question

    return (
      <Box flexDirection="column">
        {rest}
        {question}
      </Box>
    )
  })

  // The fallback dialog (a session with no surface to draw the buttons on)
  // gets a red banner over the engine's own drawing; any other question is
  // left alone.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = e.props.questions as Array<{ header?: unknown } | undefined>
    if (questions[0]?.header !== HEADER) return next(e)

    const dialog = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const cwd = await $.session.cwd().catch(() => '')
    const language = languageForSurface(await detectSystemLanguage($, cwd), e.surface === 'desktop')
    const t = stringsFor(language)

    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={RED} paddingX={1}>
          <Text bold color={RED}>
            ⚠ {t.banner}
          </Text>
        </Box>
        {dialog}
      </Box>
    )
  })
}
