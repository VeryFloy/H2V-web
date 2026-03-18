-- CreateTable
CREATE TABLE "drafts" (
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reply_to_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("user_id","chat_id")
);

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
