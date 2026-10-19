[English](README.md) | **Русский**

# AI-helpers

Маркетплейс плагинов для Claude Code: одна идея равна одному плагину, каждый
ставится отдельно.

- **Плагины знаний**: скилы и правила написания кода (Laravel, Filament),
  скилы рабочего процесса (трекинг задач, планирование архитектуры) и
  мета-скил о том, как писать скилы и моды в этом репозитории.
- **Моды**: небольшие TypeScript-модули хуков, меняющие интерфейс и поведение
  самого Claude Code (погода контекста над промптом, цветная индикация
  действий агента, подтверждение перед удалением файлов).

## Плагины

| Плагин | Тип | Статус |
| --- | --- | --- |
| [context-relay](plugins/context-relay/README.ru.md) | мод | 0.5.0 |
| [rm-guard](plugins/rm-guard/README.ru.md) | мод | 0.1.0 |

## Установка

Репозиторий живёт на GitHub: <https://github.com/demyanenkomaks/ai-helpers>.
Добавьте его как маркетплейс один раз, затем ставьте любой плагин по имени. В терминальной
сессии Claude Code:

```
/plugin marketplace add demyanenkomaks/ai-helpers
/plugin install <plugin>@ai-helpers
```

Из командной строки:

```bash
claude plugin marketplace add demyanenkomaks/ai-helpers
claude plugin install <plugin>@ai-helpers
```

При наличии SSH-доступа к GitHub так же работает URL
`git@github.com:demyanenkomaks/ai-helpers.git`.

В десктоп-приложении Claude, где `/plugin` не работает: нажмите **+** рядом с
полем ввода, затем **Plugins**, **Add marketplace** с `demyanenkomaks/ai-helpers`, затем
**Add plugin**.

Обновление: `claude plugin update <plugin>@ai-helpers`, затем `/reload-plugins`.

## Локальная разработка

Добавьте рабочую копию как маркетплейс, тогда правки читаются прямо из папки:

```bash
claude plugin marketplace add W:\Projects\AI-helpers
claude plugin install <plugin>@ai-helpers
```

После правки плагина выполните `/reload-plugins` в сессии. Перед коммитом:

```powershell
.\scripts\validate.ps1
```

Моды также загружаются прямо из своей папки через `claude --plugin-dir
plugins/<mod>` или, для сессий десктоп-приложения, через переменную
`CLAUDE_CODE_PLUGIN_DIRS` в блоке `env` файла `~/.claude/settings.json`.

## Структура

```
.claude-plugin/marketplace.json   перечисляет все плагины из plugins/
plugins/<name>/                   один плагин на папку
templates/                        файлы, которые плагины копируют в проекты (правила, стартовые CLAUDE.md)
scripts/validate.ps1              валидирует и тестирует каждый плагин
docs/                             заметки по дизайну и скриншоты
CLAUDE.md                         конвенции работы в этом репозитории (только на английском, его читает модель)
```

## Документация на двух языках

Основной язык документации английский. У каждого документа для людей есть
русский дубль с суффиксом `.ru.md` рядом (`README.md` и `README.ru.md`), и оба
правятся в одном коммите. Файлы, которые читает модель (`CLAUDE.md`,
`SKILL.md`, команды, агенты), существуют только на английском.

## Лицензия

MIT, если в папке плагина не указано иное (плагин, производный от другого
проекта, хранит LICENSE и NOTICE того проекта в своей папке).
