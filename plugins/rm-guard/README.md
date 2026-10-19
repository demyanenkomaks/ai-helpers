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

Any call stops, not only `rm -rf`: `rm file.txt` asks too. The question is a
dialog that names what would be deleted and shows the command; answer **Allow
once** to let it run, **Deny** to stop it, or type your own words under *Other*
and the agent reads them as the reason. The dialog is the mod's own, so it
opens in every permission mode, auto included (a plain *ask* verdict would go to
the mode's decider, and auto mode answers that itself). Where nobody can be
asked (`claude -p`) the command is refused.

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

## Install

```
/plugin marketplace add demyanenkomaks/ai-helpers
/plugin install rm-guard@ai-helpers
```
