**English** | [Русский](rm-guard-design.ru.md)

# rm-guard: design

Status: agreed 2026-10-19, implemented as `plugins/rm-guard` 0.1.0 the
same day; 0.2.0 turned every ask into a deny, which lost the
confirmation; 0.3.0 restored it as the mod's own dialog (see Outcomes);
0.4.0 lists the paths, banners the dialog in red and translates it;
0.5.0 replaced the option list with two buttons above the prompt. This document is the contract
the mod is built against; change it before changing behaviour.

## One line

A guard that stops the agent from deleting files without the user's say-so.
One mod, one idea: file deletion. Git-destructive commands are a separate mod.

## Origins

Studied, not copied; the code is written fresh against this build's API.

- `kenryu42/claude-code-safety-net`: parses what a command does instead of
  matching text, unwraps `bash -c`; presets and custom rules. Taken: the
  parsing idea. Left: git, cloud and secrets coverage (several ideas in one),
  Node-only install, fail-open on a broken config.
- `dicklesworthstone/destructive-command-guard` (dcg): safe patterns first,
  and a safe alternative in every block message. Taken: the hint in the
  denial text.
- `guardhook`: three outcomes (deny, ask, allow). Taken: the outcome levels.
- Most others are bash or Node scripts with weak Windows support; this mod
  runs in the plugin engine and works the same on Windows, macOS and Linux.

## Decisions

### What stops

**Any** call of a guarded command stops, not only recursive or forced ones.
The guarded commands are a list in `userConfig` (`commands`) that ships with
every command filled in:

`rm,rmdir,unlink,shred,del,erase,rd,Remove-Item,ri,find`, matched as typed
(lower-cased). `find` guards `find -delete`; `xargs` and `find -exec` are not
names of their own, they follow the command they run, so removing `rm` also
lets `xargs rm` through.

There is **no off switch**, and an empty list means the defaults. To let a
command through, the user deletes it from the list in the plugin settings.
The agent has no tool for plugin settings, but the settings live in
`settings.json`, which a file tool can edit unless a permission rule denies it;
the README says so and recommends such a rule.

### Reading the command

A tokenizer, not regular expressions. It unwraps and inspects:

- wrappers: `bash -c`, `sh -c`, `sudo`, `env`, `command`, `nohup`, `time`,
  `cmd /c`, `powershell -Command`, `pwsh -Command`;
- chains and substitutions: `;`, `&&`, `||`, `|`, `$( )`, backticks, `xargs`;
- quoting, `~`, `$HOME`, `%USERPROFILE%`, `$env:...`, relative and Windows
  paths (`C:\...`, `\\server\share`).

Hooks run on both the Bash and the PowerShell tool.

### Outcomes

| Outcome | When |
| --- | --- |
| deny, with a hint | catastrophic targets: a disk root, a top-level system folder (depth 1), the home folder or a folder above it, the project root or a folder above it (`.`, `..`, `./*`), a `.git` folder; `allowPaths` never overrides these |
| ask (own dialog) | any other call of a guarded command, a call with no checkable target, and any target the guard cannot resolve (`$VAR/*`, `$(...)`, paths piped in) |
| allow | the command is not in the list, or every target is inside `allowPaths` |

The denial text names the rule that fired and a safer move (for example "move
it to the trash or a scratch folder, or ask the user to run it").

The point of the mod is control, not prohibition: the person sees what is
about to be deleted and decides. So the question is put by the mod itself, in
a `tool.call` hook through `$.ui.ask`, the engine's own dialog: it names the
targets, shows the command and offers **Allow once** or **Deny**; free text
under *Other* goes back to the model as the reason. A `tool.check` verdict of
`ask` is not used: it goes to the permission mode's decider, and auto mode
answers it on its own (found in use: a plain `rm` of a temp file passed
unasked). Where the dialog cannot be shown (`claude -p`, dismissed) the call is
denied. A catastrophic target is a plain deny with no dialog. The analogs
studied block rather than ask, except `guardhook`'s ask on force-push; this
mod asks because confirmation is the requirement.

The dialog lists every path that would be deleted (relative ones made
absolute from the project folder, duplicates folded, at most 15 lines and "and
N more"); a path built from a variable is marked as unknown until it runs, paths
another command pipes in and the folder a `find -delete` searches are named as
such. A `ui.render` hook on the `AskUserQuestion` component wraps the engine's own
drawing of this one dialog (recognised by its `rm-guard` chip) under a red
banner; every other question is left as it is. That dialog is now only the
fallback: it is the engine's own, with a radio list, *Other* and *Skip*, which
is more than a yes or no needs. The dialog follows the language
of the app the way `context-relay` does: the desktop draws in the system language
(Russian or English), every other surface in English. What the model reads (the
refusal texts) is always English.

### The two buttons above the prompt

The primary question is a block the mod draws itself in the chat, above the
prompt (a `ui.render` hook on `{ component: 'AbovePrompt' }`, under whatever
band other mods draw there, the way `context-relay` composes): a red frame with a
heading, the list, the command, and two `Button`s, **Delete** (key `1`) and **Cancel** (key `2`, with
focus so a stray Enter refuses); Russian labels **Удалить** and **Отменить**. What it
draws is held in `$.state` (`rm-guard.asking`); the buttons' callbacks wait in a
module map by question id, since a closure cannot be state. A toast says a
question waits. Questions asked at the same time queue behind each other. A
session with no surface to draw on (`$.session.surfaces()` empty) uses the
engine dialog above; if that rejects (`claude -p`), the call is denied. A
right-hand pane (0.5.0 first cut) was dropped: the person asked for the question
in the chat.

### Waiting for the answer

A hook runs under a budget of 10 s of its own time per dispatch (`HookBudget`);
the clock stops only while a `next` or `$` call is in flight. Awaiting a promise
of the mod's own counts, so a person who pressed a button after ten seconds met
`the guard failed` (found in use, 0.5.0 first run). The wait is therefore made of
`$` calls: a one-second sleep (`ping -n 2 127.0.0.1` on Windows, `sleep 1`
elsewhere, through `$.process.run`) raced against the answer, repeated; the race
makes the reaction immediate. A sleep that does not hold (shorter than half a
second, or refused) falls back to awaiting the answer itself. Ten minutes
without an answer is a refusal.

### Exceptions

`allowPaths` in `userConfig`: a list of paths (empty by default). Targets that
resolve inside one of them pass without asking, for example a project's
`node_modules`. Nothing is allowed implicitly: no automatic cwd or temp
exception.

### Failure behaviour

Per the repository rule, the hook carries
`.catch(($, e, next) => next.called ? next(e) : { deny: '...' })`: if the guard
itself breaks, the call is denied, never passed. An unreadable construct (an encoded PowerShell command, nesting
deeper than 6) falls to the dialog.

### Out of scope

Git commands, database drops, secrets and `.env` reads, cloud CLIs, writes
through editor tools. It is not a sandbox: a program the agent writes and
runs can still delete files, which the guard sees only as an unknown command.

## Settings (`userConfig`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `commands` | list | all guarded commands | commands that stop; delete one to allow it |
| `allowPaths` | list | empty | paths where deletion passes without asking |

## Layout

```
plugins/rm-guard/
├── .claude-plugin/plugin.json     name, version, userConfig
├── hooks/hooks.json               { "modules": ["./register.tsx"] }
├── hooks/register.tsx             the hook on Bash and PowerShell, the red frame
├── hooks/parse.ts                 tokenizer, wrapper unwrapping, path resolve
├── hooks/i18n.ts                  the dialog's words in English and Russian
├── types/index.d.ts               PluginState contract (rm-guard.asking)
├── tests/guard.test.ts            run by `claude plugin test`
└── README.md, README.ru.md
```

Tests cover: each guarded command, each wrapper, quoted and Windows paths,
catastrophic targets, unresolved variables, `allowPaths`, a removed command,
and a thrown error turning into deny.

## Open items

- Resolved while implementing: the hook is a `tool.call` hook on the `Bash` and
  `PowerShell` tools; the dialog is `$.ui.ask`, a refusal is `{ deny }`, and the
  `.catch` answers `{ deny }`.
- The dialog and a deny hold in every permission mode; a `tool.check` ask does
  not (auto mode).
- The reader does not know heredocs: a heredoc body line that starts with a
  guarded command is read as that command, a false alarm on the safe side.
- `find -delete` roots are never refused as catastrophic (they are search
  roots), only flagged as needing approval, except a disk root or a top-level folder.
- The file layout is `hooks/register.tsx`, `hooks/parse.ts`, `hooks/i18n.ts`,
  `types/index.d.ts` and `tests/guard.test.ts`; no `$.state`, so no `types/` folder.
