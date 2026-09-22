# Family Messenger 0.5.0 — AI setup

## Режимы

Family Messenger поддерживает три режима:

- `auto` — сначала Ollama, при недоступности переходит на OpenRouter.
- `ollama` — только локальная модель.
- `openrouter` — только OpenRouter.

Секреты хранятся только на backend. В Web/PWA/APK ключи не встраиваются.

## OpenRouter

Переменные backend:

```
OPENROUTER_API_KEY=<secret>
OPENROUTER_MODEL=openrouter/free
```

Для production задавайте `OPENROUTER_API_KEY` как secret/environment variable хостинга. Никогда не коммитьте ключ в Git.

## Ollama

По умолчанию:

```
OLLAMA_MODEL=qwen3:4b
```

Готовый локальный стек находится в `deploy/ollama/docker-compose.yml`.

Если backend работает на том же Docker-хосте и находится в одной сети:

```
OLLAMA_BASE_URL=http://ollama:11434
```

Если backend остаётся на Render, не открывайте порт Ollama 11434 напрямую в интернет. Используйте защищённый HTTPS-шлюз/туннель и указывайте его адрес как `OLLAMA_BASE_URL`.

## Проверка API

После входа Family Messenger:

```
GET /v1/assistant/status
```

Ответ показывает только configured/model и не раскрывает секреты.

Вкладка «Помощник» позволяет выбрать:
- Авто
- Локальный Ollama
- OpenRouter Free

В режиме Auto локальный провайдер имеет приоритет.
