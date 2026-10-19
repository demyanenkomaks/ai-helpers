import { expect, mock, test } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

import { stringsFor } from '../hooks/i18n'
import { allowFrom, commandsFrom, DEFAULT_COMMANDS, display, judge, normalize } from '../hooks/parse'
import { questionFor } from '../hooks/register'
import type { Policy, Shell } from '../hooks/parse'

const PLUGIN = 'rm-guard'
const HOME = 'C:\\Users\\me'
const CWD = 'W:\\Projects\\demo'

function policy(over: Partial<Policy> = {}, shell: Shell = 'bash'): Policy {
  return {
    commands: commandsFrom(DEFAULT_COMMANDS),
    allow: [],
    home: HOME,
    cwd: CWD,
    shell,
    ...over,
  }
}

const decide = (command: string, over: Partial<Policy> = {}, shell: Shell = 'bash') =>
  judge(command, policy(over, shell)).decision

test('a command that deletes nothing passes', async () => {
  expect(decide('ls -la')).toBe('allow')
  expect(decide('echo rm -rf /')).toBe('allow')
  expect(decide('git status && npm test')).toBe('allow')
  expect(decide('cat notes.txt > out.txt')).toBe('allow')
})

test('any plain rm stops with an ask, recursive or not', async () => {
  expect(decide('rm file.txt')).toBe('ask')
  expect(decide('rm -rf node_modules')).toBe('ask')
  expect(decide('rm -rf build/*')).toBe('ask')
  expect(decide('ls && rm x')).toBe('ask')
  expect(decide('rm')).toBe('ask')
})

test('catastrophic targets are refused', async () => {
  for (const command of [
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    'rm -rf ~/',
    'rm -rf ~/*',
    'rm -rf $HOME',
    'rm -rf "${HOME}"/*',
    'rm -rf %USERPROFILE%',
    'rm -rf .',
    'rm -rf ./',
    'rm -rf ./*',
    'rm -rf ..',
    'rm -rf .git',
    'rm -rf ../.git',
    'rm -rf C:\\',
    'rm -rf /c/',
    'rm -rf /usr',
    'rm -rf W:\\Projects\\demo',
    'rm -rf /w/Projects/demo',
    'rm -rf --no-preserve-root /',
  ]) {
    expect(decide(command), command).toBe('deny')
  }
})

test('wrappers and nesting do not hide a deletion', async () => {
  for (const command of [
    'sudo rm -rf /',
    'sudo -u root rm -rf /',
    'env FOO=1 rm -rf /',
    'FOO=1 rm -rf /',
    'command rm -rf /',
    'nohup rm -rf / &',
    'time rm -rf /',
    'timeout 5 rm -rf /',
    'bash -c "rm -rf /"',
    "sh -lc 'cd x; rm -rf /'",
    'eval "rm -rf /"',
    'echo $(rm -rf /)',
    'echo `rm -rf /`',
    '"rm" -rf /',
    "'rm' -rf /",
    '\\rm -rf /',
    '/bin/rm -rf /',
    'cmd /c "rd /s /q C:\\Windows"',
    'powershell -NoProfile -Command "Remove-Item -Recurse -Force C:\\Users\\me"',
    'pwsh -c "rm -r /"',
    'bash -c "bash -c \\"rm -rf /\\""',
  ]) {
    expect(decide(command), command).toBe('deny')
  }
})

test('Windows commands are read with their own switches', async () => {
  expect(decide('rd /s /q C:\\Windows')).toBe('deny')
  expect(decide('del /f/s/q C:\\')).toBe('deny')
  expect(decide('del /q build\\old.log')).toBe('ask')
  expect(decide('rmdir /s /q dist')).toBe('ask')
})

test('PowerShell parameters carry paths and values', async () => {
  const ps = (c: string, over: Partial<Policy> = {}) => decide(c, over, 'powershell')
  expect(ps('Remove-Item -Recurse -Force dist')).toBe('ask')
  expect(ps('Remove-Item -Path a,b -Recurse')).toBe('ask')
  expect(ps('Remove-Item -Path a,b -Recurse', { allow: ['a', 'b'] })).toBe('allow')
  expect(ps('Remove-Item -Path a,b -Recurse', { allow: ['a'] })).toBe('ask')
  expect(ps('ri -LiteralPath:C:\\ -Recurse')).toBe('deny')
  expect(ps('Remove-Item -Filter *.log -Path logs', { allow: ['logs'] })).toBe('allow')
  expect(ps('Remove-Item -Recurse $env:TEMP\\x')).toBe('ask')
  expect(ps('Get-ChildItem | Remove-Item')).toBe('ask')
})

test('find and xargs stop through the command they run', async () => {
  expect(decide("find . -name '*.o' -delete")).toBe('ask')
  expect(decide('find . -type f -exec rm {} \\;')).toBe('ask')
  expect(decide('find . -type f -exec rm {} +')).toBe('ask')
  expect(decide('find . -name x')).toBe('allow')
  expect(decide('find . -name x -exec grep y {} \\;')).toBe('allow')
  expect(decide('ls | xargs rm -rf')).toBe('ask')
  expect(decide('ls | xargs -I {} rm {}')).toBe('ask')
  expect(decide('ls | xargs -n1 echo')).toBe('allow')
  expect(decide('find build -delete', { allow: ['build'] })).toBe('allow')
})

test('paths built from variables cannot be checked, so they ask', async () => {
  expect(decide('rm -rf $TARGET/x')).toBe('ask')
  expect(decide('rm -rf "$(pwd)/x"')).toBe('ask')
  expect(decide('rm -rf %TEMP%\\x')).toBe('ask')
})

test('allowPaths let a target through and never a catastrophic one', async () => {
  const allow = ['node_modules', 'dist', 'C:/scratch']
  expect(decide('rm -rf node_modules', { allow })).toBe('allow')
  expect(decide('rm -rf ./dist/assets', { allow })).toBe('allow')
  expect(decide('rm -rf node_modules/.cache/x', { allow })).toBe('allow')
  expect(decide('rm -rf node_modules dist', { allow })).toBe('allow')
  expect(decide('rm -rf node_modules src', { allow })).toBe('ask')
  expect(decide('rm -rf dist/../src', { allow })).toBe('ask')
  expect(decide('rm -rf distillery', { allow })).toBe('ask')
  expect(decide('rm -rf C:\\scratch\\a', { allow })).toBe('allow')
  expect(decide('rm -rf .', { allow: ['.'] })).toBe('deny')
  expect(decide('rm -rf ~', { allow: ['C:/Users/me'] })).toBe('deny')
})

test('a command removed from the list passes', async () => {
  const commands = commandsFrom('rm,Remove-Item')
  expect(decide('rmdir x', { commands })).toBe('allow')
  expect(decide('rm x', { commands })).toBe('ask')
  expect(decide('find . -delete', { commands })).toBe('allow')
})

test('settings parse into names and paths, and empty means the defaults', async () => {
  expect([...commandsFrom('RM, Del;find')]).toEqual(['rm', 'del', 'find'])
  expect(commandsFrom('').has('rm')).toBe(true)
  expect(commandsFrom(undefined).has('remove-item')).toBe(true)
  expect(allowFrom('node_modules; dist\nC:/a b')).toEqual(['node_modules', 'dist', 'C:/a b'])
  expect(allowFrom(42)).toEqual([])
})

test('paths fold to one shape across Windows, git-bash and WSL', async () => {
  expect(normalize('C:\\Users\\Me\\x\\..\\y', CWD).path).toBe('c:/users/me/y')
  expect(normalize('/c/Users/me', CWD).path).toBe('c:/users/me')
  expect(normalize('/mnt/c/Users/me', CWD).path).toBe('c:/users/me')
  expect(normalize('sub/./a', CWD).path).toBe('w:/projects/demo/sub/a')
  expect(normalize('build/*', CWD)).toEqual({ path: 'w:/projects/demo/build', hasGlob: true })
})

/** The engine's clock: frozen unless a test needs time to pass. */
let clockNow = () => 0

/** The engine beneath the plugin: tools that run, and a person who answers the dialog. */
function bottom(
  on: On,
  answer: string | undefined,
  env: Record<string, string> = {},
  surfaces: readonly string[] = [],
) {
  const asked: string[] = []
  const ran: string[] = []
  mock.env(on, { HOME, ...env })
  on('clock.now', () => ({ value: clockNow() }) as never)
  on('session.cwd', () => ({ value: CWD }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const questions = (e as unknown as { questions: Array<{ question: string }> }).questions
    asked.push(questions[0]?.question ?? '')
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions, answers: { [questions[0]?.question ?? '']: answer } } } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    ran.push((e as unknown as { command: string }).command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  on('tool.call', { tool: 'PowerShell' }, (_$, e) => {
    ran.push((e as unknown as { command: string }).command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  return { asked, ran }
}

const call = ($: Engine, tool: 'Bash' | 'PowerShell', command: string) =>
  $.tool.call({ tool, command } as never)

test('a plain deletion opens the dialog, and Allow once lets it run', async ($, on) => {
  const { asked, ran } = bottom(on, 'Allow once')
  const result = await call($, 'Bash', 'rm -rf node_modules')
  expect(result.deny).toBe(undefined)
  expect(ran).toEqual(['rm -rf node_modules'])
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('node_modules')
  expect(asked[0]).toContain('rm -rf node_modules')
})

test('Deny stops it and the model reads the refusal', async ($, on) => {
  const denied = bottom(on, 'Deny')
  const first = await call($, 'Bash', 'rm file.txt')
  expect(first.deny).toContain('refused')
  expect(denied.ran).toEqual([])
})

test('Other text is the reason the model reads', async ($, on) => {
  const { ran } = bottom(on, 'keep it, I still need that')
  const result = await call($, 'Bash', 'rm file.txt')
  expect(result.deny).toContain('keep it, I still need that')
  expect(ran).toEqual([])
})

test('an unanswerable dialog denies, never passes', async ($, on) => {
  const { ran } = bottom(on, undefined)
  const result = await call($, 'Bash', 'rm file.txt')
  expect(result.deny).toContain('could not be asked')
  expect(ran).toEqual([])
})

test('a catastrophic target is refused without a dialog', async ($, on) => {
  const { asked, ran } = bottom(on, 'Allow once')
  const result = await call($, 'Bash', 'rm -rf /')
  expect(result.deny).toContain('trash')
  expect(asked).toEqual([])
  expect(ran).toEqual([])
})

test('commands that delete nothing run without a dialog, PowerShell included', async ($, on) => {
  const { asked, ran } = bottom(on, 'Deny')
  expect((await call($, 'Bash', 'ls -la')).deny).toBe(undefined)
  expect((await call($, 'PowerShell', 'Get-ChildItem')).deny).toBe(undefined)
  expect(asked).toEqual([])
  expect(ran).toEqual(['ls -la', 'Get-ChildItem'])
  expect((await call($, 'PowerShell', 'Remove-Item -Recurse dist')).deny).toContain('refused')
  expect(asked).toHaveLength(1)
})

test(
  'allowPaths from settings skip the dialog',
  { options: { allowPaths: 'node_modules', commands: 'rm' } },
  async ($, on) => {
    const { asked, ran } = bottom(on, 'Deny')
    expect((await call($, 'Bash', 'rm -rf node_modules')).deny).toBe(undefined)
    expect(asked).toEqual([])
    expect((await call($, 'Bash', 'rm -rf src')).deny).toContain('refused')
    expect((await call($, 'Bash', 'rmdir src')).deny).toBe(undefined)
    expect(ran).toEqual(['rm -rf node_modules', 'rmdir src'])
  },
)

test('find under a disk root is refused, under a folder it names the search', async () => {
  expect(judge('find / -delete', policy())).toMatchObject({ decision: 'deny' })
  const found = judge('find build -name x -delete', policy())
  expect(found.decision).toBe('ask')
  expect(found.targets).toEqual([{ text: 'build', dynamic: false, kind: 'search' }])
})

test('a stopped command lists what it would delete', async () => {
  const verdict = judge('rm a.txt "sub dir/b.txt"; rm $X/c; ls | xargs rm', policy())
  expect(verdict.decision).toBe('ask')
  expect(verdict.targets).toEqual([
    { text: 'a.txt', dynamic: false },
    { text: 'sub dir/b.txt', dynamic: false },
    { text: '$X/c', dynamic: true },
    { text: '', dynamic: true, kind: 'stdin' },
  ])
})

test('paths read as the person would write them', async () => {
  expect(display('a.txt', CWD)).toBe('W:\\Projects\\demo\\a.txt')
  expect(display('./sub/b.txt', CWD)).toBe('W:\\Projects\\demo\\sub\\b.txt')
  expect(display('C:\\x\\y', CWD)).toBe('C:\\x\\y')
  expect(display('/tmp/x', '/home/me/app')).toBe('/tmp/x')
  expect(display('src/a', '/home/me/app/')).toBe('/home/me/app/src/a')
})

test('the question is a list of paths, the command and the ask', async () => {
  const targets = [
    { text: 'a.txt', dynamic: false },
    { text: 'a.txt', dynamic: false },
    { text: '$X/c', dynamic: true },
    { text: '', dynamic: true, kind: 'stdin' as const },
    { text: 'build', dynamic: false, kind: 'search' as const },
  ]
  const text = questionFor(stringsFor('en'), targets, 'rm a.txt', CWD)
  expect(text).toContain('The agent wants to delete:')
  expect(text).toContain('  • W:\\Projects\\demo\\a.txt\n')
  expect(text.split('  • W:\\Projects\\demo\\a.txt').length - 1).toBe(1)
  expect(text).toContain('$X/c  (path is unknown until it runs)')
  expect(text).toContain('paths produced by another command')
  expect(text).toContain('everything found under W:\\Projects\\demo\\build')
  expect(text).toContain('Command: rm a.txt')
  expect(text.endsWith('Allow it?')).toBe(true)

  const many = Array.from({ length: 20 }, (_, i) => ({ text: `f${i}`, dynamic: false }))
  const capped = questionFor(stringsFor('ru'), many, 'rm f*', CWD)
  expect(capped.split('\n').filter(x => x.startsWith('  • '))).toHaveLength(16)
  expect(capped).toContain('и ещё 5')
  expect(capped).toContain('Агент хочет удалить:')
  expect(capped.endsWith('Разрешить?')).toBe(true)
})

test('the desktop under a Russian system asks in Russian and lists the files', async ($, on) => {
  const { asked, ran } = bottom(on, 'Deny', { LANG: 'ru_RU.UTF-8' }, ['desktop'])
  const { wasAsked } = toastBottom(on)

  const pending = call($, 'Bash', 'rm one.txt two.txt')
  await wasAsked()
  const band = await mountBand($, 'desktop')
  expect(await band.find({ text: /Агент хочет удалить:/ })).toBeDefined()
  expect(await band.find({ text: /W:\\Projects\\demo\\one\.txt/ })).toBeDefined()
  expect(await band.find({ text: /W:\\Projects\\demo\\two\.txt/ })).toBeDefined()
  expect(await band.find({ text: /Команда: rm one\.txt two\.txt/ })).toBeDefined()
  await band.press({ key: 'rm-guard-allow' })
  expect((await pending).deny).toBe(undefined)
  expect(ran).toEqual(['rm one.txt two.txt'])
  expect(asked).toEqual([])
})

test('the terminal asks in English even under a Russian system', async ($, on) => {
  bottom(on, 'Deny', { LANG: 'ru_RU.UTF-8' }, ['terminal'])
  const { wasAsked } = toastBottom(on)

  const pending = call($, 'Bash', 'rm one.txt')
  await wasAsked()
  const band = await mountBand($, 'terminal')
  expect(await band.find({ text: /The agent wants to delete:/ })).toBeDefined()
  await band.press({ key: 'rm-guard-deny' })
  expect((await pending).deny).toContain('refused')
})

test('only the rm-guard dialog gets the red banner, in the surface language', async ($, on) => {
  bottom(on, 'Deny', { LANG: 'ru_RU.UTF-8' })
  on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine', ref: 0 }) as never)

  const banners = { terminal: /needs your approval/, desktop: /требует вашего согласия/ } as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const mine = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AskUserQuestion',
      props: {
        tool: 'AskUserQuestion',
        questions: [{ question: 'Allow it?', header: 'rm-guard', options: [], multiSelect: false }],
      },
    } as never)
    const frame = await mine.find({ type: 'Box', props: { borderColor: '#d64545' } } as never)
    expect(frame).toBeDefined()
    const banner = await mine.find({ type: 'Text', text: banners[surface] })
    expect(banner?.props['color']).toBe('#d64545')
    await mine.unmount()

    const other = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AskUserQuestion',
      props: {
        tool: 'AskUserQuestion',
        questions: [{ question: 'Which?', header: 'Approach', options: [], multiSelect: false }],
      },
    } as never)
    expect(await other.find({ type: 'Box' })).toBe(undefined)
    await other.unmount()
  }
})

test('the Skip button is a refusal without words for the model to read', async ($, on) => {
  const { ran } = bottom(on, '[No preference]')
  const result = await call($, 'Bash', 'rm file.txt')
  expect(result.deny).toContain('refused')
  expect(result.deny).not.toContain('Their words')
  expect(ran).toEqual([])
})

/** Resolves once the guard has put a question up (it raises a toast); the band is drawn from `$.state`. */
function toastBottom(on: On) {
  const toasts: string[] = []
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
  let raised!: () => void
  let wasAsked = new Promise<void>(resolve => (raised = resolve))
  on('ui.toast', (_$, e) => {
    toasts.push((e as unknown as { text: string }).text)
    raised()
    return { value: undefined } as never
  })
  return {
    toasts,
    wasAsked: () => wasAsked,
    reset: () => {
      wasAsked = new Promise<void>(resolve => (raised = resolve))
    },
  }
}

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const mountBand = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: PLUGIN, surface, ...BAND } as never)

test('the question draws above the prompt with the paths and two buttons; Delete runs the command', async ($, on) => {
  const { asked, ran } = bottom(on, 'Deny', {}, ['terminal'])
  const { wasAsked, toasts } = toastBottom(on)

  const quiet = await mountBand($, 'terminal')
  expect(await quiet.find({ text: /needs your approval/ })).toBe(undefined)
  await quiet.unmount()

  const pending = call($, 'Bash', 'rm one.txt two.txt')
  await wasAsked()
  expect(toasts).toEqual(['rm-guard: confirm the deletion above the prompt'])
  const band = await mountBand($, 'terminal')
  expect(await band.find({ text: /one\.txt/ })).toBeDefined()
  expect(await band.find({ text: /two\.txt/ })).toBeDefined()
  expect(await band.find({ text: /needs your approval/ })).toBeDefined()
  expect(await band.findAll({ type: 'Button' })).toHaveLength(2)
  expect(await band.find({ type: 'Button', text: 'Delete' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'Cancel' })).toBeDefined()
  await band.press({ key: 'rm-guard-allow' })
  const result = await pending
  expect(result.deny).toBe(undefined)
  expect(ran).toEqual(['rm one.txt two.txt'])
  expect(asked).toEqual([])
  expect(await band.find({ text: /needs your approval/ })).toBe(undefined)
})

test('the Cancel button refuses and says so to the model', async ($, on) => {
  const { ran } = bottom(on, 'Allow once', {}, ['terminal'])
  const { wasAsked } = toastBottom(on)

  const pending = call($, 'Bash', 'rm file.txt')
  await wasAsked()
  const band = await mountBand($, 'terminal')
  await band.press({ key: 'rm-guard-deny' })
  const result = await pending
  expect(result.deny).toContain('refused')
  expect(result.deny).not.toContain('Their words')
  expect(ran).toEqual([])
})

test('the desktop band under a Russian system carries Russian buttons', async ($, on) => {
  bottom(on, 'Deny', { LANG: 'ru_RU.UTF-8' }, ['desktop'])
  const { wasAsked, toasts } = toastBottom(on)

  const pending = call($, 'Bash', 'rm file.txt')
  await wasAsked()
  expect(toasts).toEqual(['rm-guard: подтвердите удаление над полем ввода'])
  const band = await mountBand($, 'desktop')
  expect(await band.find({ type: 'Button', text: 'Удалить' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'Отменить' })).toBeDefined()
  expect(await band.find({ text: /требует вашего согласия/ })).toBeDefined()
  const frame = await band.find({ type: 'Box', props: { borderColor: '#d64545' } } as never)
  expect(frame).toBeDefined()
  await band.press({ key: 'rm-guard-deny' })
  expect((await pending).deny).toContain('refused')
})

test('a session with no surface to draw on gets the engine dialog instead', async ($, on) => {
  const { asked, ran } = bottom(on, 'Allow once', {}, [])
  toastBottom(on)

  const result = await call($, 'Bash', 'rm file.txt')
  expect(result.deny).toBe(undefined)
  expect(asked).toHaveLength(1)
  expect(ran).toEqual(['rm file.txt'])
})

test('deletions asked at the same time queue, one question after the other', async ($, on) => {
  const { ran } = bottom(on, 'Deny', {}, ['terminal'])
  const { wasAsked, reset } = toastBottom(on)

  const first = call($, 'Bash', 'rm a.txt')
  const second = call($, 'Bash', 'rm b.txt')
  await wasAsked()
  reset()
  const bandOne = await mountBand($, 'terminal')
  expect(await bandOne.find({ text: /a\.txt/ })).toBeDefined()
  expect(await bandOne.find({ text: /b\.txt/ })).toBe(undefined)
  await bandOne.press({ key: 'rm-guard-allow' })
  await first
  await wasAsked()
  await bandOne.unmount()
  const bandTwo = await mountBand($, 'terminal')
  expect(await bandTwo.find({ text: /b\.txt/ })).toBeDefined()
  await bandTwo.press({ key: 'rm-guard-deny' })
  expect((await second).deny).toContain('refused')
  expect(ran).toEqual(['rm a.txt'])
})

test('a slow answer waits in process pauses, not in the hook\'s own time', async ($, on) => {
  clockNow = () => Date.now()
  const { ran } = bottom(on, 'Deny', {}, ['terminal'])
  const { wasAsked } = toastBottom(on)
  const pauses: string[][] = []
  on('process.run', (_$, e) => {
    pauses.push((e as unknown as { argv: string[] }).argv)
    return new Promise(resolve =>
      setTimeout(() => resolve({ value: { exitCode: 0, stdout: '', stderr: '' } } as never), 700),
    )
  })

  const pending = call($, 'Bash', 'rm slow.txt')
  await wasAsked()
  await new Promise(resolve => setTimeout(resolve, 1600))
  const band = await mountBand($, 'terminal')
  await band.press({ key: 'rm-guard-allow' })
  const result = await pending
  expect(result.deny).toBe(undefined)
  expect(ran).toEqual(['rm slow.txt'])
  expect(pauses.some(argv => argv[0] === 'ping')).toBe(true)
  clockNow = () => 0
})
