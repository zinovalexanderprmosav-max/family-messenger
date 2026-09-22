# Family Messenger — локальный Ollama

Этот стек поднимает Ollama и автоматически загружает модель `qwen3:4b`.

## Запуск

```bash
docker compose up -d
```

Проверка:

```bash
curl http://127.0.0.1:11434/api/tags
```

Ollama привязан только к `127.0.0.1:11434` и не публикуется напрямую в интернет.

Если backend Family Messenger будет работать на этом же Docker-хосте, подключите его к той же Docker-сети и используйте:

```
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen3:4b
```

Если backend остаётся на Render, не открывайте порт 11434 напрямую. Нужен защищённый HTTPS-туннель/прокси между Render и этим сервером.
