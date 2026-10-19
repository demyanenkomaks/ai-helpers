import type { Register } from 'claude-code'

import { allowFrom, commandsFrom, judge } from './parse'
import type { Policy, Shell } from './parse'

const TOOLS: ReadonlyArray<readonly [tool: string, shell: Shell]> = [
  ['Bash', 'bash'],
  ['PowerShell', 'powershell'],
]

const HINT =
  'Do not delete it yourself: move it to the trash or a scratch folder, or tell the user the exact command and let them run it.'

const ASK_HINT =
  'Deleting needs the user\'s approval: tell the user what you want to delete and why, and let them run the command themselves or add the path to the rm-guard "Allowed paths" setting.'

export const register: Register = (on, options) => {
  const commands = commandsFrom(options['commands'])
  const allow = allowFrom(options['allowPaths'])

  for (const [tool, shell] of TOOLS) {
    on('tool.check', { tool }, async ($, e, next) => {
      const input = e.input as { command?: unknown } | null
      if (typeof input?.command !== 'string') return next(e)

      const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
      const cwd = await $.session.cwd()
      const policy: Policy = { commands, allow, home, cwd, shell }

      const verdict = judge(input.command, policy)
      if (verdict.decision === 'allow') return next(e)
      // An `ask` would go to the mode's decider, which auto mode answers
      // itself, so every stop is a deny that tells the model what to do next.
      return {
        decision: 'deny',
        reason: `${$.plugin.name}: ${verdict.reason ?? 'deletion'}. ${verdict.decision === 'deny' ? HINT : ASK_HINT}`,
      }
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: the guard failed, so the command is refused. ${HINT}` },
    )
  }
}
