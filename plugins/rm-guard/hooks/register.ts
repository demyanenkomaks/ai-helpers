import type { Register } from 'claude-code'

import { allowFrom, commandsFrom, judge } from './parse'
import type { Policy, Shell } from './parse'

const TOOLS: ReadonlyArray<readonly [tool: string, shell: Shell]> = [
  ['Bash', 'bash'],
  ['PowerShell', 'powershell'],
]

const HINT =
  'Do not delete it yourself: move it to the trash or a scratch folder, or tell the user the exact command and let them run it.'

const ALLOW = 'Allow once'
const DENY = 'Deny'

const shorten = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

export const register: Register = (on, options) => {
  const commands = commandsFrom(options['commands'])
  const allow = allowFrom(options['allowPaths'])

  for (const [tool, shell] of TOOLS) {
    // A tool.call hook, not tool.check: an `ask` verdict goes to the permission
    // mode's decider, which auto mode answers itself, so the question to the
    // person is put here, in the engine's own dialog, in every mode.
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

      let answer: string
      try {
        answer = await $.ui.ask(
          `The agent wants to delete: ${why}.\n\nCommand: ${shorten(command, 400)}\n\nAllow it?`,
          { options: [ALLOW, DENY], header: 'rm-guard' },
        )
      } catch {
        return { deny: `${$.plugin.name}: ${why}. The user could not be asked, so nothing was deleted. ${HINT}` }
      }
      if (answer === ALLOW) return next(e)

      const note = answer === DENY ? '' : ` Their words: ${shorten(answer, 300)}`
      return { deny: `${$.plugin.name}: the user refused this deletion (${why}).${note} Do not retry it.` }
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: the guard failed, so the command is refused. ${HINT}` },
    )
  }
}
