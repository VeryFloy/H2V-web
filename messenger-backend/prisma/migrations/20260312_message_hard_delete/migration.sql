-- Migration: change reply_to FK to SET NULL on delete (supports hard delete)
-- This allows deleting a message even if other messages reference it as a reply;
-- those references will be set to NULL automatically.

DO $$
BEGIN
  -- Drop existing FK constraint (name may vary by Prisma version / initial migration tool)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'messages'
      AND constraint_name = 'messages_reply_to_id_fkey'
  ) THEN
    ALTER TABLE "messages" DROP CONSTRAINT "messages_reply_to_id_fkey";
  END IF;
END $$;

-- Recreate with ON DELETE SET NULL
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reply_to_id_fkey"
  FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
