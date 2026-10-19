**English** | [Русский](handoff.ru.md)

# Handoff format

The shape of a context handoff: the note the `context-relay` mod asks the
model to write before a chat is cleared, and the one a person writes by hand
when they move work to a new session. The mod's own copy of the prompt is
`plugins/context-relay/assets/handoff-prompt.md`; keep the two in step.

```markdown
# Handoff

## Goal
What the person is trying to achieve, in one or two sentences.

## Current state
Done and verified / done but not verified / half-done. Branch and whether
there are uncommitted changes.

## Decisions made
One bullet per decision, with its reason.

## Files changed or important
Paths, one line each.

## Open tasks and next step
Ordered; the very next step first, precise enough to start on immediately.

## Gotchas
Traps, failed approaches, environment quirks. "None noted" if none.
```

Rules that make a handoff useful:

- Describe the state of the work, not the conversation.
- Name things: files, commands, numbers, branch names.
- Written in the language the work was discussed in.
