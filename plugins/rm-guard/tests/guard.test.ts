import { expect, mock, test } from 'claude-code/testing'

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

test('the hook refuses every stop, with the right hint, and passes the rest', async ($, on) => {
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: CWD }))
  on('tool.check', () => ({ decision: 'allow' }))

  const bash = (command: string) => $.tool.check({ tool: 'Bash', input: { command } })
  const shell = (command: string) => $.tool.check({ tool: 'PowerShell', input: { command } })

  expect((await bash('ls')).decision).toBe('allow')
  const gray = await bash('rm -rf node_modules')
  expect(gray.decision).toBe('deny')
  expect(gray.reason).toContain('rm-guard')
  expect(gray.reason).toContain('Allowed paths')
  const worst = await bash('rm -rf /')
  expect(worst.decision).toBe('deny')
  expect(worst.reason).toContain('trash')
  expect((await shell('Remove-Item -Recurse dist')).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: 'x' } })).decision).toBe('allow')
})

test(
  'allowPaths from settings reach the hook',
  { options: { allowPaths: 'node_modules', commands: 'rm' } },
  async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))
    on('tool.check', () => ({ decision: 'allow' }))

    const bash = (command: string) => $.tool.check({ tool: 'Bash', input: { command } })
    expect((await bash('rm -rf node_modules')).decision).toBe('allow')
    expect((await bash('rm -rf src')).decision).toBe('deny')
    expect((await bash('rmdir src')).decision).toBe('allow')
  },
)
