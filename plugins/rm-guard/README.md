**English** | [Русский](README.ru.md)

# rm-guard

A Claude Code mod that stops the agent from deleting files without your
say-so. It reads each Bash and PowerShell command before it runs, finds every
deletion in it, and shows you what would be deleted and asks before it runs.

Design and the reasons behind it: [docs/rm-guard-design.md](../../docs/rm-guard-design.md).

## What it does

| Outcome | When |
| --- | --- |
| **refused** | the target is a disk root, a top-level system folder, your home folder or a folder above it, the project folder or a folder above it (`.`, `..`, `./*`), or a `.git` folder |
| **asked** | any other call of a guarded command, and any path it cannot work out (`$VAR/x`, `$(...)`, `%TEMP%`, paths piped in) |
| **passed** | the command is not guarded, or every target is inside an allowed path |

Any call stops, not only `rm -rf`: `rm file.txt` asks too. The question is a red-framed
block in the chat, just above the prompt (under any band other mods draw there),
with a list of every path that would be deleted (relative ones made absolute; a
path built from a variable is marked as unknown, `find -delete` names the folder
it searches), the command, and two buttons only: **Delete** (key `1`) and
**Cancel** (key `2`, focused, so a stray Enter refuses). A toast tells you it is
waiting. Parallel deletions queue, one question after the other. The block is the
mod's own, so it appears in every permission mode, auto included (a plain *ask*
verdict would go to the mode's decider, and auto mode answers that itself).

Where there is no screen to draw on, the engine's own question dialog is used
instead, with options Allow once and Deny and a red banner above it. Where nobody
can be asked (`claude -p`) the command is refused.

The question speaks Russian on the desktop app when the system language is Russian
(**Удалить** / **Отменить**), and English everywhere else, the terminal included.

The reader is a tokenizer, not a text search. It looks through `sudo`, `env`,
`command`, `nohup`, `time`, `timeout`, `bash -c`, `eval`, `cmd /c`,
`powershell -Command`, `wsl`, `xargs`, `find -exec`, `$( )` and backticks,
understands quotes, `~`, `$HOME`, `%USERPROFILE%`, Windows, git-bash and WSL
paths, `cmd` switches (`rd /s /q`) and PowerShell parameters (`-Path a,b`).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Commands that stop | `rm,rmdir,unlink,shred,del,erase,rd,Remove-Item,ri,find` | Comma-separated names, matched as typed (lower-cased). `find` guards `find -delete`; `xargs` and `find -exec` follow the command they run. Delete a name to let that command through. Empty means the defaults. |
| Allowed paths | empty | Semicolon-separated paths where deletion passes without asking, e.g. `node_modules;dist`. Relative paths count from the project folder. The always-refused targets above stay refused. |

There is deliberately no off switch.

## Limits

- It is a guard, not a sandbox. A script or program the agent writes and runs
  can delete files; the guard sees only the command that starts it.
- Refusals and the dialog hold in every permission mode, auto and bypass included.
- The reader does not know heredocs: a heredoc body whose line starts with a
  guarded command is read as that command (a false alarm, on the safe side).
- Plugin settings live in `settings.json`. A file tool can edit that file
  unless you deny it in your permission rules; add a deny rule for your
  settings files if the agent must not loosen this guard.
- If the guard itself fails, the command is refused, never passed.
- A question left unanswered for ten minutes is dropped as a refusal.

## Install

```
/plugin marketplace add demyanenkomaks/ai-helpers
/plugin install rm-guard@ai-helpers
```
