/**
 * Commands: every Bash call of the main conversation is a task, the way the
 * app's background-tasks panel lists them. A call that went to the background
 * answers with a `backgroundTaskId`; when it ends, the engine delivers a
 * `<task-notification>` block (as a turn of its own or into a running one).
 * These helpers are pure; register.tsx keeps the list in `$.state`.
 */

export type TaskNote = { id: string; status: string }

/** Every task notification in a delivery's text: its task id and status. */
export function taskNotes(text: string): TaskNote[] {
  const notes: TaskNote[] = []
  for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const body = m[1] ?? ''
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(body)?.[1]
    if (id === undefined) continue
    const status = /<status>\s*([^<]*?)\s*<\/status>/.exec(body)?.[1]
    notes.push({ id, status: status === undefined || status === '' ? 'completed' : status })
  }
  return notes
}

export const COMMAND_SHOWN = 48

/** A command line on one line, cut to what the card can show. */
export function shortCommand(command: string): string {
  const line = command.replace(/\s+/g, ' ').trim()
  return line.length > COMMAND_SHOWN ? `${line.slice(0, COMMAND_SHOWN - 1)}…` : line
}

/** What the card calls a command: the call's description when it has one, else the command line. */
export function taskName(description: unknown, command: string): string {
  const given = typeof description === 'string' ? description.trim() : ''
  return shortCommand(given !== '' ? given : command)
}
