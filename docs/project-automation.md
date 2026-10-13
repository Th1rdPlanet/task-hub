# Автоматизация Development Hub

## Включено

- Новые открытые issues из `task-hub` автоматически добавляются в Project.
- Новые sub-issues автоматически добавляются в тот же Project.
- Добавленный issue получает Status `Inbox`.
- Повторно открытый issue получает Status `Triage`.

## Ограничение GitHub Free

Для Project доступен один auto-add workflow. Он закреплён за `task-hub`, потому что это единая точка входа. Технические задачи из остальных репозиториев попадают в Project как sub-issues; отдельные прямые issues при необходимости добавляются вручную.

Поля `Направление`, `Ответственная команда` и `Приоритет` заполняет reviewer во время Triage. Автоматический переход закрытого issue в `Done` выключен, чтобы закрытие отклонённой задачи не перезаписывало Status `Rejected`. Автоматический переход merged pull request в `Done` также выключен: задачи сборки должны сначала пройти `Ready for Verification`.

## Синхронизация с issue

GitHub Action каждые пять минут переносит рабочий этап из Project в label самой issue:

| Status | Label |
| --- | --- |
| `Inbox`, `Triage` | `на рассмотрении` |
| `Ready` | `готово к работе` |
| `In Progress` | `в работе` |
| `Review` | `ревью` |
| `Ready for Verification` | `проверка` |
| `Deferred` | `отложено` |
| `Rejected` | `rejected` |
| `Done` | статусный label удаляется |

У issue остаётся только один статусный label. `blocked`, `security`, `duplicate` и другие смысловые labels не изменяются. При `Done` issue закрывается как выполненная. Pull requests эта автоматизация не изменяет.

### Отклонение

Label `rejected` ставится всегда. Причину можно записать в поле Project `Причина решения` или отдельным комментарием issue в формате `Причина отклонения: текст`.

- Если причина найдена, открытая issue закрывается как `not planned`.
- Если причины нет, issue остаётся открытой с label `rejected`.
- Reviewer может самостоятельно написать причину и закрыть issue: автоматизация не откроет её повторно и не продублирует комментарий.
- Если причина добавлена позже, issue закроется при следующем запуске.

Синхронизацию можно запустить вручную через Actions → `Sync Project status to issues` → `Run workflow`.

### Доступ автоматизации

Repository secret `PROJECT_SYNC_TOKEN` содержит fine-grained token пользователя `1VicTim1`. Токену нужны `Projects: read` для организации, `Issues: read and write` для подключённых репозиториев и `Metadata: read`. Workflow имеет только `contents: read`; токен не выводится в лог.
