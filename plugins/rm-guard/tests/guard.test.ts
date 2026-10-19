import { expect, mock, test } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

import { allowFrom, commandsFrom, DEFAULT_COMMANDS, judge, normalize } from '../hooks/parse'
import type { Policy, Shell } from '../hooks/parse'

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

/** The engine beneath the plugin: tools that run, and a person who answers the dialog. */
function bottom(on: On, answer: string | undefined) {
  const asked: string[] = []
  const ran: string[] = []
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: CWD }))
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
