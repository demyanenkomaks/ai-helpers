**English** | [Русский](README.ru.md)

# AI-helpers

A Claude Code plugin marketplace: one idea per plugin, installable separately.

- **Knowledge plugins**: skills and rules for writing code (Laravel, Filament),
  workflow skills (task tracking, architecture planning), and a meta-skill for
  authoring skills and mods in this repository.
- **Mods**: small TypeScript hooks modules that change Claude Code's own
  interface and behaviour (context-usage weather above the prompt, colour-coded
  agent actions, confirmation before files are deleted).

## Plugins

| Plugin | Kind | Status |
| --- | --- | --- |
| _(none yet; each plugin is added in its own commit)_ | | |

## Install

The repository lives on GitFlic: <https://gitflic.ru/project/demy-maks/ai-helpers>.
Add it as a marketplace once (by its git URL; the short `owner/repo` form is
for GitHub only), then install any plugin by name. At the prompt of a terminal
Claude Code session:

```
/plugin marketplace add https://gitflic.ru/project/demy-maks/ai-helpers.git
/plugin install <plugin>@ai-helpers
```

From a shell:

```bash
claude plugin marketplace add https://gitflic.ru/project/demy-maks/ai-helpers.git
claude plugin install <plugin>@ai-helpers
```

With SSH access to GitFlic the URL `git@gitflic.ru:demy-maks/ai-helpers.git`
works the same way.

In the Claude desktop app, where `/plugin` does not run: click **+** next to the
prompt box, then **Plugins**, **Add marketplace** with the git URL above, then
**Add plugin**.

Updates: `claude plugin update <plugin>@ai-helpers`, then `/reload-plugins`.

## Develop locally

Add the working copy itself as a marketplace so edits are read in place:

```bash
claude plugin marketplace add W:\Projects\AI-helpers
claude plugin install <plugin>@ai-helpers
```

After editing a plugin run `/reload-plugins` in the session. Before committing:

```powershell
.\scripts\validate.ps1
```

Mods are also loaded straight from their folder with `claude --plugin-dir
plugins/<mod>` or, for desktop-app sessions, by listing the folder in
`CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

## Layout

```
.claude-plugin/marketplace.json   lists every plugin under plugins/
plugins/<name>/                   one plugin per folder
templates/                        files plugins copy into projects (rules, CLAUDE.md starters)
scripts/validate.ps1              validates and tests every plugin
docs/                             design notes and screenshots
CLAUDE.md                         conventions for working in this repository (English only; the model reads it)
```

## Documentation in two languages

English is the primary language. Every human-facing document has a Russian twin
beside it with the `.ru.md` suffix (`README.md` and `README.ru.md`), and both
are edited in the same commit. Files the model reads (`CLAUDE.md`, `SKILL.md`,
commands, agents) exist in English only.

## License

MIT unless a plugin folder states otherwise (a plugin derived from another
project keeps that project's LICENSE and NOTICE in its own folder).
