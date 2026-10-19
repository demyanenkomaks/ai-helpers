[English](README.md) | **Русский**

# plugins/

Одна идея равна одному плагину. Каждый плагин лежит в своей папке здесь и
перечислен в `../.claude-plugin/marketplace.json` строкой
`"source": "./plugins/<name>"`.

Рядом живут два типа плагинов:

| Тип | Что содержит | Раскладка папки |
| --- | --- | --- |
| Плагин знаний | скилы, слэш-команды, агенты | `.claude-plugin/plugin.json`, `skills/<skill>/SKILL.md`, `commands/*.md` |
| Мод (плагин интерфейса) | один TypeScript-модуль хуков | `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts(x)`, `types/index.d.ts` |

Точные шаги добавления плагина описаны в `../CLAUDE.md`, проверка перед
коммитом выполняется скриптом `../scripts/validate.ps1`.
