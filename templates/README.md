# templates/

Files that plugins copy INTO a project (a plugin cannot place rules into a
project by itself). Typical contents:

- `laravel/CLAUDE.md`: a starter CLAUDE.md for a Laravel/Filament project
- `laravel/rules/*.md`: files for the project's `.claude/rules/`
- `handoff.md`: the format a context handoff file follows

A slash command in the owning plugin (for example `/laravel-init`) copies the
relevant folder into the current project. Keep templates small and generic:
project-specific knowledge belongs in the project, not here.
