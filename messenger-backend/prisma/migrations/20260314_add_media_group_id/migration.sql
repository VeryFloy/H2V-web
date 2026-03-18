-- AlterTable
ALTER TABLE "messages" ADD COLUMN "media_group_id" TEXT;

-- CreateIndex (optional, speeds up grouping queries)
CREATE INDEX "messages_media_group_id_idx" ON "messages"("media_group_id");
