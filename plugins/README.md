**English** | [Русский](README.ru.md)

# plugins/

One idea = one plugin. Each plugin lives in its own folder here and is listed
in `../.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`.

Two kinds of plugin live side by side:

| Kind | What it ships | Folder layout |
| --- | --- | --- |
| Knowledge plugin | skills, slash commands, agents | `.claude-plugin/plugin.json`, `skills/<skill>/SKILL.md`, `commands/*.md` |
| Mod (interface plugin) | one TypeScript hooks module | `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts(x)`, `types/index.d.ts` |

See `../CLAUDE.md` for the exact steps to add a plugin and `../scripts/validate.ps1`
to check every plugin before committing.
