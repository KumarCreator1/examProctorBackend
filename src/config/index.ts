import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

// ─── Environment Schema Validation ──────────────────────
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),

  // MongoDB
  MONGODB_URI: z.string().url().default('mongodb://localhost:27017/integrity_proctoring'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000,https://v0-frontend-for-backend.onrender.com,https://examproctorbackend.onrender.com'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(4).max(16).default(10),

  // Crypto
  CRYPTO_SECRET: z.string().min(10),
});

// Parse and validate
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.format();
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(formatted, null, 2));
  process.exit(1);
}

// ─── Export Typed Config ────────────────────────────────
export const config = {
  env: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',

  mongo: {
    uri: parsed.data.MONGODB_URI,
  },

  redis: {
    host: parsed.data.REDIS_HOST,
    port: parsed.data.REDIS_PORT,
    password: parsed.data.REDIS_PASSWORD || undefined,
  },

  jwt: {
    accessSecret: parsed.data.JWT_ACCESS_SECRET,
    refreshSecret: parsed.data.JWT_REFRESH_SECRET,
    accessExpiry: parsed.data.JWT_ACCESS_EXPIRY,
    refreshExpiry: parsed.data.JWT_REFRESH_EXPIRY,
  },

  cors: {
    origin: parsed.data.CORS_ORIGIN.split(',').map(url => url.trim()),
  },

  rateLimit: {
    windowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
    maxRequests: parsed.data.RATE_LIMIT_MAX_REQUESTS,
  },

  bcrypt: {
    saltRounds: parsed.data.BCRYPT_SALT_ROUNDS,
  },

  crypto: {
    secret: parsed.data.CRYPTO_SECRET,
  },
} as const;

export type Config = typeof config;
