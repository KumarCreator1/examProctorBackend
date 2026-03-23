import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;
let redisAvailable = false;

export const connectRedis = async (): Promise<Redis> => {
  try {
    const client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          logger.error('Redis connection retries exhausted. Running without Redis.');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 200, 2000);
        logger.warn(`Redis retry attempt ${times}, retrying in ${delay}ms...`);
        return delay;
      },
      lazyConnect: true,
    });

    // Attach error handlers BEFORE connecting to suppress unhandled errors
    client.on('error', () => {
      // Silently swallow — already logged via retryStrategy and catch block
    });

    client.on('reconnecting', () => {
      logger.warn('⚠️  Redis reconnecting...');
    });

    await client.connect();
    logger.info(`✅ Redis connected: ${config.redis.host}:${config.redis.port}`);

    redisClient = client;
    redisAvailable = true;
    return client;
  } catch (error) {
    logger.error({ error }, '❌ Failed to connect to Redis');
    logger.warn('⚠️  App running without Redis. Some features will be unavailable.');
    // Don't set redisClient — leave it null so getRedisClient() returns null
    redisClient = null;
    redisAvailable = false;
    throw error;
  }
};

export const getRedisClient = (): Redis | null => {
  return redisAvailable ? redisClient : null;
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis disconnected gracefully');
    } catch {
      // Already disconnected or errored — safe to ignore
    }
    redisClient = null;
    redisAvailable = false;
  }
};
