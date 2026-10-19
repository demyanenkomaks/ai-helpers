**English** | [Русский](rm-guard-design.ru.md)

# rm-guard: design

Status: agreed 2026-10-19, implemented as `plugins/rm-guard` 0.1.0 the
same day; 0.2.0 turned every ask into a deny (see Outcomes). This document is the contract
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
| deny, "needs the user's approval" | any other call of a guarded command, a call with no checkable target, and any target the guard cannot resolve (`$VAR/*`, `$(...)`, paths piped in) |
| allow | the command is not in the list, or every target is inside `allowPaths` |

The denial text names the rule that fired and a safer move (for example "move
it to the trash or a scratch folder, or ask the user to run it").

Every stop is delivered as a `deny`, never as an `ask`: an ask goes to the
permission mode's decider, and auto mode answers it on its own (found in use:
a plain `rm` of a temp file in a project passed unasked). The reason text
tells the model what to do next: for a catastrophic target, do not delete it;
for the rest, tell the user what and why and let them run the command or add
the path to `allowPaths`. The analogs studied also block rather than ask,
except `guardhook`'s ask on force-push.

### Exceptions

`allowPaths` in `userConfig`: a list of paths (empty by default). Targets that
resolve inside one of them pass without asking, for example a project's
`node_modules`. Nothing is allowed implicitly: no automatic cwd or temp
exception.

### Failure behaviour

Per the repository rule, the hook carries
`.catch(($, e, next) => next.called ? next(e) : { deny: '...' })`: if the guard
itself breaks, the call is denied, never passed. An unreadable construct (an encoded PowerShell command, nesting
deeper than 6) is denied as needing approval.

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
├── .claude-plugin/plugin.json     name, version 0.1.0, types, userConfig
├── hooks/hooks.json               { "modules": ["./register.ts"] }
├── hooks/register.ts              the hook on Bash and PowerShell
├── hooks/parse.ts                 tokenizer, wrapper unwrapping, path resolve
├── tests/guard.test.ts            run by `claude plugin test`
└── README.md, README.ru.md
```

Tests cover: each guarded command, each wrapper, quoted and Windows paths,
catastrophic targets, unresolved variables, `allowPaths`, a removed command,
and a thrown error turning into deny.

## Open items

- Resolved while implementing: the hook is on `tool.check` (verdicts: `deny` with a
  reason; the parser still tells the two cases apart for the wording) for the `Bash` and `PowerShell` tools; the `.catch`
  answers `{ deny }`.
- A *deny* holds in every permission mode; an *ask* does not (auto mode).
- `find -delete` roots are never refused as catastrophic (they are search
  roots), only flagged as needing approval, except a disk root or a top-level folder.
- The file layout is `hooks/register.ts`, `hooks/parse.ts` and
  `tests/guard.test.ts`; no `$.state`, so no `types/` folder.
