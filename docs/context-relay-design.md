**English** | [Русский](context-relay-design.ru.md)

# context-relay: design

Status: agreed 2026-10-19, implemented as `plugins/context-relay` 0.1.0 the
same day. This document is the contract the mod is built against; change it
before changing behaviour. Deviations found while implementing are listed at
the end.

## One line

Context weather, prompt-cache warming and one-click handoff of the conversation
into a fresh chat. One mod, one band above the prompt.

## Origins

- Weather bands, readings and recent-turn bars come from Anthropic's
  `token-weather` example in `anthropics/claude-code-playground`
  (`claude-code/mods/token-weather`, Apache-2.0).
- Cache timer, rate limits, cost and subagent display are modelled on
  `token-weather-usage` by augiefra (`augiefra/claude-mods`, Apache-2.0).
- Both are reference designs; the code is written fresh against this build's
  API. Anything copied keeps its LICENSE and NOTICE in the mod folder.

## Decisions

### Measurement

- The measure is **absolute tokens**, not percent: `context.tokens` from
  `$.session.usage()` (input tokens of the last response, cached included; the
  status line's `total_input_tokens`). Read on `session.start`,
  `turn.complete` (main loop only) and `session.compact`.
- No scaling to the model's window. On a 200k model the band never reaches
  Storm and Claude Code's own auto-compact fires first; accepted.
- Agent quality degrades with input length (Chroma, "Context Rot", 2025); the
  bands encode the practical rule "stay under ~300k".

### Weather bands (4)

| Band | Tokens | Glyph (terminal) | Icon (desktop) | Colour |
| --- | --- | --- | --- | --- |
| Clear | < 100k | ☀ | sun | green |
| Overcast | 100k–250k | ☁ | cloud | yellow |
| Rain | 250k–350k | 🌧 | rain cloud | orange |
| Storm | ≥ 350k | ⛈ | storm cloud | red |

Thresholds are the `bands` setting (three numbers). The colour scale runs
green → red so it reads without words.

### The band above the prompt

Always compact, one line:

```
⛈ 362k · 🔥 41m · 👥 1/3 · ⇄
```

- weather icon + tokens (a red dot appears after the tokens while any rate
  limit is above 90%)
- 🔥 minutes until the prompt cache cools, red "cold" once it has
- 👥 subagents: running/total; the icon is red while any runs, grey otherwise
- ⇄ the handoff button: an icon only, no label, no tooltip text, always shown.
  From Rain upward it takes the band's colour.

Hover card (desktop) / expanded view (terminal): model window, tokens per
recent turn as bars (last 12, relative to the fullest), 5-hour and 7-day
limits with reset times, session cost and the last prompt's share, warm-up
pings used this idle period and the approximate cost of one ping, the
subagent list with names and durations.

The hook draws its own line and passes the rest of the chain through
(`next(e)`), so other AbovePrompt mods still draw below it.

Toast: once on entering Storm, not repeated until the band drops and rises
again.

### Prompt-cache warming

- Timer from the start of the last main-loop request; TTL is 1 hour on this
  plan (detect as augiefra does: traffic, then `CLAUDE_CODE_PROMPT_CACHE_TTL`,
  default 1h).
- A **ping** is `$.model.fork({ prompt: "Reply with the single word OK." })`:
  one tool-less question over the transcript as last sent, served from cache,
  never appended to the conversation.
- Auto-warm: while the session is idle, ping at **minute 55** after the last
  request (margin for latency and TTL uncertainty), repeat each 55 minutes,
  stop after the configured hours. Any prompt from the person refreshes the
  cache by itself and restarts the chain.
- Manual ping: a small control beside the 🔥 timer.
- Pings spend the 5-hour limit and cost a cache read of the whole context; the
  hover card shows pings used and the per-ping estimate.
- Setting `warm`: picker `off / 2h / 4h / 8h`, default `4h`.

### Handoff (the ⇄ button)

Primary scenario, entirely inside the mod:

1. Ask the model over the cached transcript (`$.model.fork`) for a handoff
   following `templates/handoff.md`: goal, current state, decisions made,
   files changed, open tasks and next step, gotchas.
2. Write it to `~/.claude/context-relay/handoff/<project-slug>/<yyyy-mm-dd-hhmm>.md`
   and record a pointer in `$.store`.
3. Run `/clear` via `$.command.run`.
4. On the `prompt.context` re-read that `/clear` causes, prepend the handoff as
   a context block of the first message; show one notice line
   "Context loaded from handoff <time>".
5. Delete the file once the block has been delivered (never earlier).

Secondary scenario (fresh session opened by hand): on `session.start`, if a
handoff for this project is younger than 7 days and not yet delivered, show a
toast with a **Load** button; nothing is injected without the press. Undelivered
handoffs are deleted after 7 days.

Storage is local to the user (not in the project, not shared); sharing is a
later change to the mod if ever needed.

### Automation

- Trigger: `turn.complete` of the main loop with `context.tokens ≥ autoHandoffAt`
  (default **500000**; `0` disables).
- Before clearing: a question under the band, in the chat above the prompt
  (the way rm-guard asks), with what is about to happen, a **30-second
  countdown** (setting `countdownSeconds`) and buttons **Yes** / **No**. Yes, or
  the countdown running out, collects the handoff, clears the chat and loads the
  note into the new conversation. No keeps the current chat untouched and skips
  automation until the next turn crosses the threshold again. A separate pane
  (0.5.0) was dropped: the person asked for the question in the chat.
- Never fires mid-turn: commands queue until the session is idle anyway.

### Subagents

Per session: running / finished / total, from `agent.spawn` and the subagent
loop's `turn.complete`. Hover list with names and durations.

### Language

- No setting. `desktop` surface: system culture read once at `session.start`
  (Windows `Get-Culture`, otherwise `LANG`/`LC_ALL`); `ru*` → Russian labels,
  anything else English.
- `terminal` surface: always English.

### Surfaces

Desktop first (the author's daily surface); terminal fully supported and
tested by the implementer (glyphs and colours only, no SVG, no hover).

### Settings (`userConfig`, shown by Claude Code in `/config`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `warm` | picker `off/2h/4h/8h` | `4h` | hours of idle time to keep the cache warm |
| `autoHandoffAt` | number (tokens) | `500000` | automation threshold, 0 disables |
| `countdownSeconds` | number | `30` | time to cancel before an automatic clear |
| `bands` | three numbers | `100000, 250000, 350000` | band boundaries |
| `handoffDir` | path | `~/.claude/context-relay/handoff` | where handoff files live |

### State

Everything a drawing reads lives in `$.state` under the contract in
`types/index.d.ts` (readings, cache timer, subagents, pending handoff);
cross-session facts (pending handoff pointer, TTL learned) in `$.store`.
Module variables hold nothing a reload may lose.

## Out of scope for v1

Sharing handoffs through the project, scaling bands to the window, a status
line entry, sounds, per-subagent token accounting.

## Open risks to verify while implementing

- Whether `$.model.fork` right after a long idle period is served from cache
  (if not, the ping still warms it; cost is one full read).
- Whether `prompt.context` is raised after a plugin-initiated `/clear` in a
  desktop-hosted session as it is in the terminal.
- Hover cards on the desktop surface for an AbovePrompt tree (augiefra draws
  them, so the primitives exist).

## Deviations found while implementing (0.1.0)

- The engine follows `$` only inside one file, so every hook and every
  function that touches `$` lives in `hooks/register.tsx`; atoms are declared
  there with literal `plugin` and `key`. Pure helpers stay in their own files.
- JSX works only in the hooks module; `draw.ts` builds trees by calling the
  surface's element constructors directly.
- A Button takes one string label only, so the ⇄ button signals the band by
  being dim below Rain and bright from Rain upward, not by colour.
- The desktop surface refuses `weight`, `tabular` and named `gap` steps in this
  build; the band uses `bold` and numeric gaps.
- The "Load" press with turns already in the conversation appends a hidden
  user row; the test kit of this build has no bottom for `session.append`, so
  that path is covered by reasoning, not by a test. The before-first-turn
  path (delivery through `prompt.context`) is tested.
- Cache TTL comes from the environment only (5 minutes when forced, else 1
  hour); the traffic heuristic of the augiefra mod is not ported.

### 0.2.0, after the first live run

- **Language.** A desktop-hosted session starts with no surface attached, so
  the surface is read at draw time, not at start: the system language is
  detected once (locale variables, else the Windows culture), the desktop
  draws in it and the terminal in English.
- **Clearing.** In the desktop app `$.command.run({ command: "clear" })` did
  not clear the chat. The flow now verifies with the turn count and, where the
  chat still has turns, calls `$.session.compact()` and answers that compaction
  with the handoff alone, so the conversation becomes the note in place. The
  mod's own `session.compact` hook is not run for its own call (re-entry); the
  registration's `.catch` answers instead, from module values and no `$` call.
- **Look.** The compact line with a hover card gave way to a row of pills in
  the style of Token Weather Usage: weather with sparkline and last-turn
  delta, 5-hour and 7-day gauges with pacing colours and elapsed/left time,
  cache with hit share and warm-up pings, session cost, subagents, ⇄. Each
  pill still has its hover card on the desktop; the terminal draws one line
  with text gauges and ▾ for the details.

### 0.3.0, after the second live run

- **No `session.start` after `/clear`.** The engine ends the session with
  reason `clear`, goes on under a new session id and fires no `session.start`
  for it (its own documentation says so). After a clear the band therefore
  stayed empty and English: the readings had been reset and the language was
  never detected again. The start work now lives in one routine that
  `session.start` runs and that every other entry point (a turn, a command,
  the first drawing through a 1 ms timer) runs too when the session id is not
  the one it last began; `session.end` with reason `clear` forgets the id.
  The same routine covers a mod loaded into a running session, which never
  saw a start either.
- **Clearing, again.** `$.command.run({ command: "clear" })` only queues the
  line `/clear` as a prompt. Whether it took is now checked by the session id
  and the turn count, and the line is next submitted through
  `$.prompt.submit` before the compaction fallback. The compaction's refusal
  (the engine rejects a plugin's compact while a turn runs, or while an
  external turn drives the conversation) is shown in the engine's own words
  instead of a generic line, and the line clears at the next turn.
- **A log.** `~/.claude/context-relay/context-relay.log` (64 KB, oldest lines
  dropped) records what the mod saw the engine do: session begin and end,
  readings, each step of a handoff and its outcome, compactions. It exists so
  the next live run can be read without a debugger.

### 0.4.0, the band rearranged

- **Order and colour.** The pills now read weather, cost, cache, subagents,
  background commands. The weather pill stays neutral: only its icon takes
  the band's colour, so the line does not flood red in a Storm. The ⇄ button
  moved into the weather pill, after the last-turn delta, the way ↻ sits in
  the cache pill; its own pill is gone.
- **No rate-limit pills.** The 5-hour and 7-day gauges were dropped: the
  band is about this conversation, and the limits are shown elsewhere. Their
  state (`limits`), strings, icons and pacing helpers went with them.
- **Commands.** A new pill in the shape of the subagents pill, counting what
  the app's background-tasks panel counts: every Bash call of the main
  conversation, running from `tool.call` until its answer; the last six in
  the card by their description, with status and duration. A call whose
  answer carries a `backgroundTaskId` (`run_in_background`, ctrl+b or a
  timeout) keeps running under that id until its `<task-notification>` block
  arrives in the text of the next `turn.start` or `session.receive`, parsed
  for its `<task-id>` and `<status>`. Subagents' own commands are not listed:
  their notifications never reach the main conversation.
- **One pending handoff per project.** A fresh session on 19 October 2026
  received the 10:06 handoff of the morning, long after the 10:32 and 11:01
  ones had been delivered: a stale record with its file had outlived the newer
  ones. Saving a handoff now deletes the project's previous record and file
  first.

### 0.5.0, the commands pill removed

- The ⚙ pill and everything behind it are gone: the `tool.call` Bash
  tracking, the `<task-notification>` parsing (`tasks.ts`), the `tasks` state
  and its strings. The band reads weather, cost, cache, subagents.
