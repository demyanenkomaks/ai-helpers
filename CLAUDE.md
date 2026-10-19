# AI-helpers: conventions for working in this repository

This repository is a Claude Code plugin marketplace. Read this file before
adding or changing anything.

## Rules

1. **One idea, one plugin.** A plugin does one thing and installs on its own.
   Never merge two ideas into one plugin to save a manifest.
2. **Every plugin is listed** in `.claude-plugin/marketplace.json` with
   `"source": "./plugins/<name>"`. A folder under `plugins/` that is not listed
   is a bug.
3. **Nothing project-specific.** No client names, hostnames, keys or code copied
   from a work project. Templates are generic starters.
4. **Validate before committing.** Run `scripts/validate.ps1` (it runs
   `claude plugin validate` and `claude plugin test` for every plugin).
5. **Versions live in each plugin's `plugin.json`** (semver). Bump the version
   in the same commit as the change. The marketplace file has no versions.
6. **Names are kebab-case**, folders match the `name` in `plugin.json`.
7. **Language.** Code, manifests and everything the model reads (this file,
   `SKILL.md`, commands, agents) are English only and have no translation.
   Human-facing docs are bilingual: English is primary, and every `X.md`
   (README, docs/, plugin READMEs) has a Russian twin `X.ru.md` beside it.
   Both open with a language switcher line (`**English** | [Русский](X.ru.md)`
   and the mirror). When you change one, change the other in the same commit;
   a twin left behind is a bug (`scripts/validate.ps1` checks this).

## Adding a knowledge plugin (skills, commands, agents)

Use the `skill-creator` skill for each SKILL.md and the `plugin-dev` skills
(`plugin-structure`, `command-development`, `agent-development`) for the rest.

```
plugins/<name>/
├── .claude-plugin/plugin.json     name, version, description, author, keywords
├── skills/<skill>/SKILL.md        short core: when it triggers, what to do
├── skills/<skill>/references/     long details, loaded on demand
├── commands/*.md                  optional slash commands
└── README.md
```

- Keep SKILL.md short; move detail to `references/`. The description decides
  triggering, so write it as "Use when ..." with concrete phrases.
- Rules that belong in a project go to `templates/` and are copied by a
  command, never baked into a skill.

## Adding a mod (hooks module)

Use the `plugin-authoring` skill. Its reference and the generated
`claude-code.d.ts` are the authority on the API; `plugin-dev` does not cover
this kind of plugin.

```
plugins/<name>/
├── .claude-plugin/plugin.json     + "types": "./types/index.d.ts", userConfig
├── hooks/hooks.json               { "modules": ["./register.ts"] }
├── hooks/register.ts(x)           export const register: Register = (on, options) => ...
├── hooks/register.test.ts         run by `claude plugin test`
├── types/index.d.ts               PluginState contract for every $.state key
└── README.md
```

- Guard hooks (anything that can deny a tool call) always carry
  `.catch(($, e, next) => next.called ? next(e) : { deny: '...' })`.
- Drawing state lives in `$.state` (declared in the contract), never in module
  variables: a hot reload resets those.
- `.claude-plugin/types/` is engine-generated and git-ignored.
- A mod derived from another project keeps its LICENSE and NOTICE in the folder.

## Adding the plugin to the marketplace

Append to `plugins` in `.claude-plugin/marketplace.json`:

```json
{
  "name": "<name>",
  "description": "<one line>",
  "category": "<productivity|development|security|...>",
  "source": "./plugins/<name>"
}
```

Then add a row to the table in `README.md` and run `scripts/validate.ps1`.
