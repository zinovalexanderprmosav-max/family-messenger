# Family Messenger 0.5.0 — AI setup

Family Messenger использует один серверный ИИ-провайдер: OpenRouter Free.

Секретный ключ хранится только на backend Render. В Web/PWA/APK ключ не встраивается.

## Переменные Render

```
OPENROUTER_API_KEY=<secret>
OPENROUTER_MODEL=openrouter/free
```

`OPENROUTER_API_KEY` задаётся как Environment Variable в Render и никогда не коммитится в Git.

## Проверка

После входа Family Messenger:

```
GET /v1/assistant/status
```

Ответ показывает только состояние подключения и модель, без секретного ключа.

В приложении вкладка «Помощник» использует OpenRouter Free автоматически — выбирать провайдера пользователю не нужно.
