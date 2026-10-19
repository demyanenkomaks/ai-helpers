**English** | [Русский](README.ru.md)

# context-relay

Context weather, prompt-cache warming and a one-click handoff of the
conversation into a fresh chat. One Claude Code mod, one row of pills above
the prompt (the look follows Token Weather Usage by augiefra):

```
⛈ 362k ▁▃█ +5k ⇄ │ ≈ $1.84 +$0.12 │ ⚡ cache 41m 1/4 ↻ │ 👥 1/3 │ ⚙ 0/2 ▾
```

| Pill | What it shows | Hover card (desktop) / ▾ (terminal) |
| --- | --- | --- |
| Weather | tokens in context; only the icon takes the band's colour: ☀ under 100k, ☁ to 250k, 🌧 to 350k, ⛈ above; the bars are the last turns, ▲ the last turn's cost; ⇄ at the end is the handoff button, bright from Rain upward | band, window, recent turns |
| ≈ $ | session cost and the last prompt's share | the same |
| ⚡ cache | minutes until the prompt cache cools, the hit share when below 90%, warm-up pings used; ↻ warms it now | cache state, hit share, pings and their cost |
| 👥 | subagents running / total, red while any runs | each with its type and duration |
| ⚙ | commands running / total, as the app's background-tasks panel counts them: every Bash call from its start to its answer, a backgrounded one until its notification; red while any runs | each by its description, with status and duration |

## Handoff

Press ⇄ (or type `/relay`). The mod asks the model, over the cached
transcript, for a note in the shape of `templates/handoff.md` (goal, state,
decisions, files, next step, gotchas), writes it to
`~/.claude/context-relay/handoff/<project>/<date-time>.md`, clears the chat
and puts the note into the first message of the new conversation.

Clearing is tried three ways in turn, each checked by the session id and the
turn count: the `/clear` command run by the mod, the same line submitted as a
prompt, and, where neither takes, a compaction of the mod's own that it
answers with the note alone, so the context becomes the handoff in place. If
all three fail, the band shows the engine's reason in red until your next
message and the handoff stays armed: it loads with the first message after
you clear the chat yourself. The file is deleted once the note has been
delivered.

If you open a new session by hand instead, the band shows **Load** and
**Dismiss** for a handoff younger than 7 days.

Automation: when the context reaches 500k tokens after a turn, a pane counts
down 30 seconds with **Now** and **Cancel**, then does the same.

## Settings

In `/config` (or the plugin's settings in the desktop app):

| Setting | Default | Meaning |
| --- | --- | --- |
| Keep the prompt cache warm | `4h` | `off`, `2h`, `4h` or `8h` of idle pings |
| Automatic handoff at | `500000` | tokens; `0` disables |
| Countdown before an automatic clear | `30` | seconds |
| Weather band boundaries | `100000,250000,350000` | three rising numbers |
| Handoff folder | empty | empty means `~/.claude/context-relay/handoff` |

Labels follow the system language on the desktop (Russian or English: on
Windows the culture PowerShell reports, elsewhere `LANG`) and are English in
the terminal.

## Costs

A warm-up ping is one request answered from the prompt cache: it reads the
whole context at the cache-read rate and counts against the 5-hour limit.
The details card shows how many pings the current idle period has used.

## Install

```
/plugin marketplace add https://gitflic.ru/project/demy-maks/ai-helpers.git
/plugin install context-relay@ai-helpers
```

Requires a Claude Code build with function hooks (2.1.287 or later).

## Development

```
claude plugin validate plugins/context-relay
claude plugin test plugins/context-relay
```

The hooks module is `hooks/register.tsx`; everything that touches `$` lives
there because the engine follows `$` only within one file. Pure helpers are
in `bands.ts`, `handoff.ts`, `warm.ts`, `i18n.ts`, `icons.ts`, `log.ts`, and
the trees in `draw.ts`. The design is `docs/context-relay-design.md`.

The mod writes what it saw the engine do to
`~/.claude/context-relay/context-relay.log` (64 KB, oldest lines dropped):
when a session begins and ends, the readings at start, every step of a
handoff with its outcome, compactions. Attach it to a bug report.

## Origins

Weather bands, readings and recent-turn bars follow Anthropic's
`token-weather` example (claude-code-playground, Apache-2.0). The cache
timer, cost, subagent and background-command display follow `token-weather-usage` by
augiefra (Apache-2.0). The code here is written fresh against this build's API.
