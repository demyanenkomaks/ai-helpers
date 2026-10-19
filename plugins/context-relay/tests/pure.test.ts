import { describe, expect, test } from 'claude-code/testing'

import {
  autoHandoffAt,
  bandOf,
  barsOf,
  cacheHitPercent,
  countdownSeconds,
  deltasOf,
  formatDuration,
  formatTokens,
  parseBands,
  warmHours,
  withAlpha,
} from '../hooks/bands'
import {
  frameHandoff,
  handoffDirFor,
  handoffFileFor,
  parsePending,
  projectSlug,
} from '../hooks/handoff'
import { languageOf } from '../hooks/i18n'
import { appendLog, errorText, logFileFor } from '../hooks/log'
import { shortCommand, taskName, taskNotes } from '../hooks/tasks'
import { cacheLeftMs, pingsFor, ttlFromEnv } from '../hooks/warm'

describe('bands', () => {
  test('the four bands follow the three boundaries', async () => {
    const bands = parseBands('100000,250000,350000')
    expect(bandOf(0, bands)).toBe('clear')
    expect(bandOf(99_999, bands)).toBe('clear')
    expect(bandOf(100_000, bands)).toBe('overcast')
    expect(bandOf(249_999, bands)).toBe('overcast')
    expect(bandOf(250_000, bands)).toBe('rain')
    expect(bandOf(349_999, bands)).toBe('rain')
    expect(bandOf(350_000, bands)).toBe('storm')
    expect(bandOf(900_000, bands)).toBe('storm')
  })

  test('a bad bands setting falls back to the defaults', async () => {
    expect(parseBands('')).toEqual([100_000, 250_000, 350_000])
    expect(parseBands('300000,200000,100000')).toEqual([100_000, 250_000, 350_000])
    expect(parseBands('1,2')).toEqual([100_000, 250_000, 350_000])
    expect(parseBands(42)).toEqual([100_000, 250_000, 350_000])
    expect(parseBands('50000; 120000; 200000')).toEqual([50_000, 120_000, 200_000])
  })

  test('tokens and durations read short', async () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(362_400)).toBe('362k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
    expect(formatDuration(30_000)).toBe('< 1m')
    expect(formatDuration(41 * 60_000)).toBe('41m')
    expect(formatDuration(65 * 60_000)).toBe('1h 05m')
  })

  test('recent-turn bars scale to the fullest turn and a compaction is 0', async () => {
    const deltas = deltasOf([
      { tokens: 10_000 },
      { tokens: 30_000 },
      { tokens: 90_000 },
      { tokens: 20_000, isCompaction: true },
      { tokens: 25_000 },
    ])
    expect(deltas).toEqual([20_000, 60_000, 0, 5_000])
    expect(barsOf(deltas)).toBe('▃█▁▂')
  })

  test('settings parse with safe fallbacks', async () => {
    expect(warmHours('4h')).toBe(4)
    expect(warmHours('off')).toBe(0)
    expect(warmHours(undefined)).toBe(4)
    expect(autoHandoffAt(500000)).toBe(500000)
    expect(autoHandoffAt('0')).toBe(0)
    expect(autoHandoffAt('nope')).toBe(0)
    expect(countdownSeconds(30)).toBe(30)
    expect(countdownSeconds(1)).toBe(5)
    expect(countdownSeconds('x')).toBe(30)
  })
})

describe('cache', () => {
  test('the cache hit share', async () => {
    expect(cacheHitPercent({ input_tokens: 2_000, cache_read_input_tokens: 98_000, cache_creation_input_tokens: 0 })).toBe(98)
    expect(cacheHitPercent({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(null)
    expect(withAlpha('#3fb950', 0.12)).toBe('rgba(63,185,80,0.12)')
    expect(withAlpha('red', 0.5)).toBe('red')
  })
})

describe('tasks', () => {
  test('task notifications give the id and status, one per block', async () => {
    const text = [
      '<task-notification>',
      '<task-id>bg1</task-id>',
      '<output-file>/tmp/bg1.log</output-file>',
      '<status>completed</status>',
      '<summary>Background command "npm test" completed (exit code 0)</summary>',
      '</task-notification>',
      'and <task-notification><task-id>bg2</task-id></task-notification>',
    ].join('\n')
    expect(taskNotes(text)).toEqual([
      { id: 'bg1', status: 'completed' },
      { id: 'bg2', status: 'completed' },
    ])
    expect(taskNotes('<task-notification><task-id>x</task-id><status>failed</status></task-notification>')).toEqual([
      { id: 'x', status: 'failed' },
    ])
    expect(taskNotes('plain text')).toEqual([])
  })

  test('a command line is shown on one line, cut short', async () => {
    expect(shortCommand('npm   run\n  build')).toBe('npm run build')
    expect(shortCommand('x'.repeat(60))).toBe(`${'x'.repeat(47)}…`)
    expect(taskName('Build the project', 'npm run build')).toBe('Build the project')
    expect(taskName('  ', 'npm run build')).toBe('npm run build')
    expect(taskName(undefined, 'npm run build')).toBe('npm run build')
  })
})

describe('warm', () => {
  test('pings per idle period come from the hours', async () => {
    expect(pingsFor(0)).toBe(0)
    expect(pingsFor(2)).toBe(2)
    expect(pingsFor(4)).toBe(4)
    expect(pingsFor(8)).toBe(8)
  })

  test('the TTL follows the environment and defaults to an hour', async () => {
    expect(ttlFromEnv(undefined, undefined)).toBe(60 * 60 * 1000)
    expect(ttlFromEnv(undefined, '5m')).toBe(5 * 60 * 1000)
    expect(ttlFromEnv('1', '1h')).toBe(5 * 60 * 1000)
  })

  test('cache left counts down from the last request and stops at 0', async () => {
    const ttlMs = 60 * 60 * 1000
    expect(cacheLeftMs({ requestAt: null, ttlMs }, 5)).toBe(null)
    expect(cacheLeftMs({ requestAt: 0, ttlMs }, 19 * 60_000)).toBe(41 * 60_000)
    expect(cacheLeftMs({ requestAt: 0, ttlMs }, 2 * ttlMs)).toBe(0)
  })
})

describe('handoff', () => {
  test('the project slug is the last path segment, made safe', async () => {
    expect(projectSlug('W:\\Projects\\AI-helpers')).toBe('AI-helpers')
    expect(projectSlug('/home/me/my app/')).toBe('my-app')
    expect(projectSlug('')).toBe('project')
  })

  test('the handoff folder is the setting or the home default', async () => {
    expect(handoffDirFor('', 'C:\\Users\\me')).toBe(
      'C:\\Users\\me\\.claude\\context-relay\\handoff',
    )
    expect(handoffDirFor('  ', '/home/me')).toBe('/home/me/.claude/context-relay/handoff')
    expect(handoffDirFor('D:\\notes\\', '/home/me')).toBe('D:\\notes')
    expect(handoffFileFor('/home/me/h', 'app', Date.UTC(2026, 9, 19, 12, 30))).toMatch(
      /^\/home\/me\/h\/app\/2026-10-19-\d{4}\.md$/,
    )
  })

  test('a store record is read back or rejected', async () => {
    expect(parsePending(null)).toBe(null)
    expect(parsePending({ file: 'x' })).toBe(null)
    expect(parsePending({ file: 'f', text: 't' })).toEqual({
      file: 'f',
      text: 't',
      createdAt: 0,
      isArmed: false,
    })
  })

  test('the framed handoff is headed in the language and keeps the note whole', async () => {
    const pending = { file: 'f', text: '# Handoff\n\n## Goal\nShip', createdAt: 0, isArmed: true }
    expect(frameHandoff(pending, 'en')).toContain('Handoff from the previous chat')
    expect(frameHandoff(pending, 'en')).toContain('## Goal\nShip')
    expect(frameHandoff(pending, 'ru')).toContain('Сводка предыдущего чата')
  })
})

describe('language', () => {
  test('ru locales give Russian, everything else English', async () => {
    expect(languageOf('ru-RU')).toBe('ru')
    expect(languageOf('ru_RU.UTF-8')).toBe('ru')
    expect(languageOf('en-US')).toBe('en')
    expect(languageOf(undefined)).toBe('en')
  })
})

describe('log', () => {
  test('lines append and the oldest go first past the cap', async () => {
    expect(appendLog('', 'a')).toBe('a\n')
    expect(appendLog('a\n', 'b\nc')).toBe('a\nb ⏎ c\n')
    expect(appendLog('a', 'b')).toBe('a\nb\n')
    expect(appendLog('1111\n2222\n', '3333', 10)).toBe('2222\n3333\n')
    expect(appendLog('1111\n2222\n', '3333', 8)).toBe('3333\n')
  })

  test('errors are spelled in one short line, the log sits under ~/.claude', async () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText('x  \n y')).toBe('x y')
    expect(errorText({ skip: 'no' })).toBe('{"skip":"no"}')
    expect(errorText(undefined)).toBe('undefined')
    expect(errorText('a'.repeat(300)).length).toBe(240)
    expect(logFileFor('C:\\Users\\me')).toBe('C:\\Users\\me\\.claude\\context-relay\\context-relay.log')
    expect(logFileFor('/home/me')).toBe('/home/me/.claude/context-relay/context-relay.log')
  })
})
