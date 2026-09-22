# Family Messenger — постоянный сервер 24/7

## Постоянная схема

Интернет -> HTTPS :443 -> Caddy -> Family Messenger -> PostgreSQL

Клиенты:
- iPhone владельца — первое и основное администраторское устройство;
- Android жены — отдельный участник семьи;
- Windows PC — дополнительное устройство владельца, не сервер.

После постоянного развёртывания выключение рабочего/домашнего ПК не влияет на чат.

## Требования к серверу

- Linux VM/server.
- Docker Engine и Docker Compose v2.
- Постоянный диск для Docker volumes.
- Входящие TCP 80 и 443.
- Публичный DNS-адрес или публичный IPv4.

Если собственного домена пока нет, Install-Server.sh предложит имя вида PUBLIC-IP.sslip.io.

## Первая установка

На сервере:

```sh
git clone https://github.com/zinovalexanderprmosav-max/family-messenger.git
cd family-messenger
git checkout release/0.3.8-rc1
chmod +x Install-Server.sh Update-Server.sh Stop-Server.sh
./Install-Server.sh
```

Установщик:
- определяет публичный IPv4, если возможно;
- предлагает HTTPS host;
- генерирует случайный пароль PostgreSQL;
- создаёт закрытый .env.server;
- запускает PostgreSQL, приложение и Caddy;
- ждёт успешный HTTPS /health.

Контейнеры используют restart: unless-stopped и автоматически возвращаются после перезапуска Docker/сервера.

## Первый вход

1. Откройте выданный HTTPS-адрес в Safari на iPhone владельца.
2. Создайте семью на iPhone.
3. Этот iPhone станет первым администратором и первым доверенным устройством.
4. Safari -> Поделиться -> На экран Домой.

## Android жены

На iPhone:
Семейное управление -> Пригласить нового участника -> ввести имя -> показать QR.

На Android:
Family Messenger -> Сканировать QR-код.

После подтверждения устройства на iPhone повторный QR больше не требуется.

## ПК владельца

Позже на iPhone:
Мои устройства -> Добавить моё устройство.

ПК становится вторичным устройством того же владельца и может быть выключен в любое время.

## Данные

PostgreSQL:
`family_server_db`

TLS/сертификаты Caddy:
`family_caddy_data`

Конфигурация Caddy:
`family_caddy_config`

## Обновление

```sh
./Update-Server.sh
```

## Остановка

```sh
./Stop-Server.sh
```
