-- pg_trgm: ускоряет ILIKE '%query%' запросы через GIN-индексы
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Поиск сообщений по тексту (глобальный + в чате)
CREATE INDEX IF NOT EXISTS idx_messages_text_trgm
  ON messages USING gin (text gin_trgm_ops);

-- Поиск пользователей по nickname
CREATE INDEX IF NOT EXISTS idx_users_nickname_trgm
  ON users USING gin (nickname gin_trgm_ops);
