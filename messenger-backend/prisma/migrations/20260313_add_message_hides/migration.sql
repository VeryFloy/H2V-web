-- CreateTable: MessageHide — "удалить у себя" на уровне сервера
CREATE TABLE "message_hides" (
    "user_id"    TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "hidden_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_hides_pkey" PRIMARY KEY ("user_id", "message_id")
);

-- Index for fast lookup by user
CREATE INDEX "message_hides_user_id_idx" ON "message_hides"("user_id");

-- Foreign Keys
ALTER TABLE "message_hides" ADD CONSTRAINT "message_hides_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_hides" ADD CONSTRAINT "message_hides_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
