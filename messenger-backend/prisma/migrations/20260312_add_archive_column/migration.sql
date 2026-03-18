-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;
