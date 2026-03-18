import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 500, 30_000),
  lazyConnect: true,
  enableOfflineQueue: false,
});

let redisAvailable = false;

redis.on('connect', () => {
  redisAvailable = true;
  console.log('[Redis] Connected');
});
redis.on('error', (err) => {
  if (redisAvailable) console.error('[Redis] Error:', err.message);
  redisAvailable = false;
});

// ─── Ключи ───────────────────────────────────────────────────────────────────
export const redisKeys = {
  userOnline: (userId: string) => `user:${userId}:online`,
  userLastOnline: (userId: string) => `user:${userId}:last_online`,
  userTyping: (chatId: string, userId: string) =>
    `chat:${chatId}:typing:${userId}`,
  chatTyping: (chatId: string) => `chat:${chatId}:typing`,
  userProfile: (userId: string) => `cache:user:${userId}`,
};

// ─── Cache-aside для профилей ───────────────────────────────────────────────
const PROFILE_TTL = 300; // 5 минут

export const cacheService = {
  async getProfile(userId: string): Promise<Record<string, unknown> | null> {
    const raw = await safeRedis(() => redis.get(redisKeys.userProfile(userId)), null);
    return raw ? JSON.parse(raw) : null;
  },

  async setProfile(userId: string, data: Record<string, unknown>): Promise<void> {
    await safeRedis(
      () => redis.set(redisKeys.userProfile(userId), JSON.stringify(data), 'EX', PROFILE_TTL),
      'OK',
    );
  },

  async invalidateProfile(userId: string): Promise<void> {
    await safeRedis(() => redis.del(redisKeys.userProfile(userId)), 0);
  },
};

// ─── Онлайн-статус (graceful fallback если Redis недоступен) ─────────────────
async function safeRedis<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const presenceService = {
  async setOnline(userId: string): Promise<void> {
    await safeRedis(() => redis.set(redisKeys.userOnline(userId), '1', 'EX', 120), 'OK');
  },

  async setOffline(userId: string): Promise<void> {
    const now = new Date().toISOString();
    await safeRedis(async () => {
      await redis.del(redisKeys.userOnline(userId));
      return redis.set(redisKeys.userLastOnline(userId), now);
    }, 'OK');
  },

  async isOnline(userId: string): Promise<boolean> {
    const val = await safeRedis(() => redis.get(redisKeys.userOnline(userId)), null);
    return val === '1';
  },

  async getLastOnline(userId: string): Promise<string | null> {
    return safeRedis(() => redis.get(redisKeys.userLastOnline(userId)), null);
  },

  async heartbeat(userId: string): Promise<void> {
    await safeRedis(() => redis.set(redisKeys.userOnline(userId), '1', 'EX', 120), 'OK');
  },

  async setTyping(chatId: string, userId: string): Promise<void> {
    await safeRedis(() => redis.set(redisKeys.userTyping(chatId, userId), '1', 'EX', 5), 'OK');
  },

  async clearTyping(chatId: string, userId: string): Promise<void> {
    await safeRedis(() => redis.del(redisKeys.userTyping(chatId, userId)), 0);
  },
};
