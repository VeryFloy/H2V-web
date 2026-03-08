# H2V Messenger — Web Client

Web-клиент мессенджера H2V: SolidJS, TypeScript, Vite, PWA.

## Стек

- **SolidJS** — реактивный UI
- **TypeScript** + **Vite** — сборка
- **CSS Modules** — стили
- **Signal Protocol** — E2E шифрование (клиент)
- **PWA** — service worker, push-уведомления, установка

## Возможности

- Личные и групповые чаты
- Секретные E2E чаты
- Редактирование, удаление, реакции, ответы
- Прочитано, доставлено, набор текста
- Онлайн/офлайн статус
- Медиа (фото, видео, аудио, файлы)
- Голосовые сообщения
- Push-уведомления
- RU/EN

## Запуск

```bash
npm install
npm run dev
```

По умолчанию: `http://localhost:5173`. Требуется работающий backend API (см. основной репозиторий).

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Dev-сервер Vite |
| `npm run build` | Production-сборка |
| `npm run preview` | Просмотр production-сборки |
