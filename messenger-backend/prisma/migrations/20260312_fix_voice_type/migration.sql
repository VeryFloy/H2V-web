-- Fix voice messages misclassified as VIDEO due to WebM container detection
UPDATE messages
SET type = 'AUDIO'
WHERE type = 'VIDEO'
  AND (media_url LIKE '%.webm' OR media_url LIKE '%.ogg')
  AND (media_name LIKE 'voice_%' OR media_name LIKE '%.ogg');
