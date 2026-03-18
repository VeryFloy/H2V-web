-- Drop the old boolean column (added by the previous migration)
ALTER TABLE "chat_members" DROP COLUMN IF EXISTS "is_pinned";

-- Add the new timestamp column
ALTER TABLE "chat_members" ADD COLUMN IF NOT EXISTS "pinned_at" TIMESTAMP(3);
