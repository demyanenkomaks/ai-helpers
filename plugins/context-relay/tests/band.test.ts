import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const PLUGIN = 'context-relay'
const CWD = 'W:\\Projects\\demo'

const USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 362_400, window: 1_000_000, percent: 36 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-19T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-21T12:00:00Z' },
  ],
  cost: { usd: 1.5 },
}

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const TURN = {
  answer: 'ok',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

let sessions = 0

/** The engine beneath the plugin: what every test answers the same way. */
function bottom(on: On, usage: SessionUsage = USAGE) {
  const toasts: string[] = []
  const commands: string[] = []
  const ids = { current: `s${++sessions}` }
  on('session.id', () => ({ value: ids.current }))
  on('session.usage', () => ({ value: usage }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: [] }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('command.run', ($, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  return { toasts, commands, ids }
}

async function start($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.session.start({ cwd: CWD, surface, isInteractive: true })
}

test('the band shows the tokens, the storm colour on the icon alone and no limits', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, {})
  const { toasts } = bottom(on)

  await start($)
  await $.turn.complete(TURN)

  expect(toasts.some(t => t.includes('362k'))).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const tokens = await ui.find({ type: 'Text', text: /362k/ })
    expect(tokens).toBeDefined()
    expect(tokens?.props['color']).toBe(undefined)
    if (surface === 'desktop') {
      const icons = await ui.findAll({ type: 'Svg' })
      const storm = icons.find(x => x.props['alt'] === 'Storm')
      expect(storm).toBeDefined()
      expect(String(storm?.props['source'])).toContain('#d64545')
    } else {
      const glyph = await ui.find({ type: 'Text', text: /⛈/ })
      expect(glyph?.props['color']).toBe('#d64545')
    }
    expect(await ui.find({ text: /95%/ })).toBe(undefined)
    expect(await ui.find({ type: 'Button', key: 'relay-handoff' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'relay-ping' })).toBeDefined()
    await ui.unmount()
  }
})

test('the terminal band expands its details on ▾ and shows the cost and subagents', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, {})
  bottom(on)
  await start($)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /No subagents yet/ })).toBe(undefined)
  await ui.press({ key: 'relay-expand' })
  expect(await ui.find({ text: /No subagents yet/ })).toBeDefined()
  expect(await ui.find({ text: /\$1\.50/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent is listed with its model first, then its name and type', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, {})
  bottom(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await start($)
  await $.turn.complete(TURN)
  await $.agent.spawn({ prompt: 'Find the login bug', description: 'P19: login bug', subagentType: 'general-purpose' })
  await clock.advance(60_000)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'relay-expand' })
  expect(await ui.find({ text: /Sonnet 5\.5 · P19: login bug · general-purpose/ })).toBeDefined()
  await ui.unmount()
})

test('Russian labels on the desktop under a ru locale, English in the terminal', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { LANG: 'ru_RU.UTF-8' })
  bottom(on)

  await start($, 'desktop')
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.some(x => x.props['alt'] === 'Гроза')).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'кэш' })).toBeDefined()
  await ui.unmount()

  const term = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: /⚡ cache/ })).toBeDefined()
  await term.unmount()
})

test('the band yields to a survey', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  mock.env(on, {})
  bottom(on)
  let drawn = 0
  on('ui.render', { component: 'AbovePrompt' }, () => {
    drawn += 1
    return { type: 'Text', props: {}, children: ['below'] }
  })
  await start($)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(drawn).toBe(1)
  expect(await ui.find({ key: 'relay-handoff' })).toBe(undefined)
  await ui.unmount()
})

test('idle pings warm the cache at minute 55, as many times as the hours allow', { options: { warm: '2h' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  mock.env(on, {})
  bottom(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return {
      value: {
        isAnswered: true,
        text: 'OK',
        usage: {
          input_tokens: 0,
          output_tokens: 1,
          cache_read_input_tokens: 360_000,
          cache_creation_input_tokens: 0,
        },
      },
    }
  })

  await start($)
  await $.turn.complete(TURN)
  const PERIOD = 55 * 60 * 1000
  await clock.advance(PERIOD - 1000)
  expect(forks).toBe(0)
  await clock.advance(1000)
  expect(forks).toBe(1)
  await clock.advance(PERIOD)
  expect(forks).toBe(2)
  await clock.advance(PERIOD * 3)
  expect(forks).toBe(2)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'relay-expand' })
  expect(await ui.find({ text: /Warm-up pings 2\/2/ })).toBeDefined()
  await ui.press({ key: 'relay-ping' })
  expect(forks).toBe(3)
  await ui.unmount()
})

test('⇄ collects a handoff, clears the chat and delivers the note into the next conversation', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 19, 12, 30) })
  mock.store(on)
  mock.env(on, { HOME: 'C:\\Users\\me' })
  const { commands, toasts } = bottom(on)
  const written: { path: string; text: string }[] = []
  on('fs.read', () => ({ value: 'HANDOFF PROMPT' }))
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('model.fork', ($, e) => ({
    value: {
      isAnswered: true,
      text: e.prompt === 'HANDOFF PROMPT' ? '# Handoff\n\n## Goal\nShip it' : 'OK',
      usage: {
        input_tokens: 0,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }))
  const deleted: string[][] = []
  on('process.run', ($, e) => {
    deleted.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.turns', () => ({ value: 0 }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))

  await start($)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'relay-handoff' })
  await ui.unmount()

  expect(commands).toEqual(['clear'])
  const notes = written.filter(w => w.path.endsWith('.md'))
  expect(notes).toHaveLength(1)
  expect(notes[0]?.path).toMatch(/^C:\\Users\\me\\\.claude\\context-relay\\handoff\\demo\\2026-10-19-\d{4}\.md$/)
  expect(notes[0]?.text).toContain('Ship it')

  const context = await $.prompt.context({
    blocks: [{ name: 'currentDate', text: 'today' }],
  })
  expect(context.blocks[0]?.name).toBe('contextRelayHandoff')
  expect(context.blocks[0]?.text).toContain('Ship it')
  expect(context.blocks[1]?.name).toBe('currentDate')

  expect(deleted.some(argv => argv[0] === 'cmd' && argv.includes('/c'))).toBe(true)
  expect(toasts.some(t => /Context loaded/.test(t))).toBe(true)

  const after = await $.prompt.context({ blocks: [] })
  expect(after.blocks).toEqual([])
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ text: /📥/ })).toBe(undefined)
  await band.unmount()
})

test('with nothing to fork, the note is asked over the transcript read from the session', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 19, 12, 30) })
  mock.store(on)
  mock.env(on, { HOME: 'C:\Users\me' })
  const { commands } = bottom(on)
  const written: { path: string; text: string }[] = []
  on('fs.read', () => ({ value: 'HANDOFF PROMPT' }))
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('model.fork', () => ({
    value: {
      isAnswered: false,
      reason: 'nothing-to-fork',
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Fix the login bug', toolUses: [] },
      {
        role: 'assistant',
        text: 'Done.',
        toolUses: [{ tool_use_id: 'u1', tool: 'Bash', input: { command: 'git status' }, text: 'clean' }],
      },
    ],
  }))
  const asked: { model: string; prompt: string }[] = []
  on('model.complete', ($, e) => {
    asked.push({ model: e.model, prompt: e.prompt })
    return {
      value: {
        isAnswered: true,
        text: '# Handoff\n\n## Goal\nLogin bug',
        usage: { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.turns', () => ({ value: 0 }))

  await start($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'relay-handoff' })
  await ui.unmount()

  expect(asked).toHaveLength(1)
  expect(asked[0]?.model).toBe('claude-fable-5-1')
  expect(asked[0]?.prompt).toContain('Fix the login bug')
  expect(asked[0]?.prompt).toContain('[Bash] {"command":"git status"}')
  expect(asked[0]?.prompt).toContain('HANDOFF PROMPT')
  expect(commands).toEqual(['clear'])
  expect(written.filter(w => w.path.endsWith('.md'))[0]?.text).toContain('Login bug')
})

test('a handoff left by another session waits for Load and rides into the next first message', async ($, on) => {
  const now = 1_000_000
  mock.clock(on, { now })
  mock.store(on, {
    'handoff:demo': {
      file: '/home/me/h/demo/old.md',
      text: '# Handoff\n\n## Goal\nResume',
      createdAt: now - 60_000,
      isArmed: false,
    },
  })
  mock.env(on, { HOME: '/home/me' })
  bottom(on)
  on('session.turns', () => ({ value: 0 }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))

  await start($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Button', key: 'relay-load' })).toBeDefined()
  await ui.press({ key: 'relay-load' })
  expect(await ui.find({ text: /loads with your next message/ })).toBeDefined()
  await ui.unmount()

  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks[0]?.name).toBe('contextRelayHandoff')
  expect(context.blocks[0]?.text).toContain('Resume')
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Button', key: 'relay-load' })).toBe(undefined)
  await band.unmount()
})

test('automation asks under the band at the threshold; No keeps the chat, silence is Yes', { options: { autoHandoffAt: 300000, countdownSeconds: 10 } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  mock.env(on, {})
  bottom(on)
  on('fs.read', () => ({ value: 'HANDOFF PROMPT' }))
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })

  await start($)
  await $.turn.complete(TURN)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ text: /Automatic handoff/ })).toBeDefined()
  expect(await band.find({ text: /Yes in 10s/ })).toBeDefined()
  await clock.advance(3000)
  expect(await band.find({ text: /Yes in 7s/ })).toBeDefined()
  await band.press({ key: 'relay-no' })
  expect(await band.find({ type: 'Button', key: 'relay-yes' })).toBe(undefined)
  await band.unmount()

  await clock.advance(20_000)
  expect(forks).toBe(0)

  // The next crossing asks again; left alone, the countdown collects the handoff.
  await $.turn.complete({ ...TURN, turnId: 't2' })
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await again.find({ type: 'Button', key: 'relay-yes' })).toBeDefined()
  await again.unmount()
  await clock.advance(10_000)
  expect(forks).toBe(1)
})

test('when /clear does not take, the conversation is replaced with the handoff by compaction', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 19, 12, 30) })
  mock.store(on)
  mock.env(on, { HOME: 'C:\\Users\\me' })
  const { commands, toasts } = bottom(on)
  on('fs.read', () => ({ value: 'HANDOFF PROMPT' }))
  on('fs.write', () => ({ value: undefined }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '# Handoff\n\n## Goal\nShip it',
      usage: { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.turns', () => ({ value: 7 }))
  let compacted: string | undefined
  on('session.compact', ($, e) => {
    compacted = e.trigger
    return { messages: [{ role: 'user', text: 'bottom', toolUses: [] }] }
  })

  await start($)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'relay-handoff' })
  await ui.unmount()

  expect(commands).toEqual(['clear'])
  expect(compacted).toBe(undefined)
  expect(toasts.some(t => /Conversation replaced/.test(t))).toBe(true)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ text: /📥/ })).toBe(undefined)
  expect(await band.find({ type: 'Text', text: /—/ })).toBeDefined()
  await band.unmount()
})

test('after /clear the band starts over, although no session.start follows', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { LANG: 'ru_RU.UTF-8' })
  const { ids } = bottom(on)
  on('session.turns', () => ({ value: 0 }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))

  await start($, 'desktop')
  await $.turn.complete(TURN)
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await before.find({ type: 'Text', text: /362k/ })).toBeDefined()
  await before.unmount()

  // The engine goes on under a new id and fires no session.start for it.
  const ended = ids.current
  ids.current = `${ended}-after-clear`
  await $.session.end({ reason: 'clear', sessionId: ended, resume: { id: ended } })
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await after.find({ type: 'Text', text: /362k/ })).toBe(undefined)
  await clock.advance(1)
  expect(await after.find({ type: 'Text', text: /362k/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: 'кэш' })).toBeDefined()
  await after.unmount()
})
