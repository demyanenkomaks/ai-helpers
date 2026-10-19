**English** | [Русский](context-relay-design.ru.md)

# context-relay: design

Status: agreed 2026-10-19, not implemented. This document is the contract the
mod is built against; change it before changing behaviour.

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
- Before clearing: a dialog pane with a **30-second countdown** (setting
  `countdownSeconds`) and buttons **Now** / **Cancel**. Cancel skips automation
  until the next turn crosses the threshold again.
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
