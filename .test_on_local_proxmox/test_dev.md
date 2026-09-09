---
name: dev-sandbox-999
description: "Use when deploying test projects to the dev/test sandbox LXC 999 (test-dev): SSH access, docker, quick env setup for coding agents."
version: 1.0.0
author: hermes (rick_admin profile)
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [sandbox, docker, lxc, proxmox, ssh, dev]
    category: devops
---

# Dev sandbox LXC 999 «test-dev» — деплой тестовых проектов

Быстрая песочница для агентов-разработчиков: SSH по паролю, docker+compose
без sudo, минимум ограничений. Не для прод-данных.

## Паспорт среды

| | |
|---|---|
| VMID | 999, hostname `test-dev`, нода m79 (PVE 9.2.11) |
| Сеть | VLAN 20, DHCP → IP смотри ниже, MAC `BC:24:11:FD:9D:56` |
| Ресурсы | 2 vCPU / 1 GB RAM / 8 GB rootfs (local-btrfs), unprivileged, nesting=1, onboot=1 |
| ОС | Ubuntu 26.04, docker.io + docker-compose-v2 (compose plugin) |
| Пользователь | `dev` (в группе `docker` — контейнеры без sudo), пароль см. ниже |
| Root | пароль `<ROOT_PASSWORD>` (запроси у владельца среды) |

**IP:** 10.0.20.250 (DHCP; если изменится — `gh`/PVE API `/nodes/m79/lxc/999/interfaces`).

## Быстрый старт (скопируй агенту)

```bash
ssh dev@10.0.20.250       # пароль спросит интерактивно
# или одной строкой (для скриптов/агентов):
sshpass -p '<DEV_PASSWORD>' ssh -o StrictHostKeyChecking=no dev@10.0.20.242 '<команда>'
```

`<DEV_PASSWORD>`: `<DEV_PASSWORD>` — запроси у владельца, если ротирован.

## Рабочий цикл деплоя тестового проекта

```bash
sshpass -p '<DEV_PASSWORD>' ssh -o StrictHostKeyChecking=no dev@10.0.20.242 bash -s <<'EOF'
set -e
mkdir -p ~/myproject && cd ~/myproject
# вариант 1: свой compose
cat > docker-compose.yml <<YAML
services:
  web:
    image: nginx:alpine
    ports: ["8080:80"]
YAML
docker compose up -d
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8080
# вариант 2: из git
# git clone https://github.com/<owner>/<repo>.git && cd <repo> && docker compose up -d --build
EOF
```

## Гигиена (обязательно)

```bash
docker compose down -v      # остановить и удалить volume'ы проекта
docker image prune -f       # убрать висячие образы (диск 8GB, следи!)
```

Тестовые порты внутри среды: 3000/8080/8000 свободны. Доступ ИЗВНЕ — только
с хостов VLAN 20 и маршрутизируемых сегментов (проверено с Hermes-хоста).

## Ограничения и подводные камни (проверено live 2026-09-07)

- **RAM 1 GB** — не поднимай тяжёлые стеки (postgres+redis+app влезает впритык;
  OOM-killer убьёт что-то без предупреждения). `free -m` перед деплоем.
- **Диск 8 GB** — образы кэшируются быстро, чисти `docker image prune -f`.
- **`BatchMode=yes` ломает sshpass** — не добавляй эту опцию к парольным
  сессиям, получишь `Permission denied` вместо пароля.
- **curl в шаблоне ubuntu-26.04 нет** — ставится с docker.io, но в чистом
  шаблоне проверяй `which curl`.
- LXC unprivileged + nesting=1: docker работает, но `--privileged`-контейнеры,
  GPU и inner-mounts — нет.
- Настройки Portainer/registry не сохраняются между пересозданиями контейнера —
  999 пересоздаётся с нуля по запросу (данные внутри — расходник).

## Пересоздание (если среда убита)

Бэкап старого → destroy → create (см. memory: параметры контейнера; шаблон
`m79_hdd:vztmpl/ubuntu-26.04-standard_26.04-1_amd64.tar.zst`), затем apt
install docker.io docker-compose-v2 git curl, useradd dev + пароль + группа
docker. Полная процедура — 2 минуты.
