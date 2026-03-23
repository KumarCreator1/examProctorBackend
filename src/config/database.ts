import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../utils/logger';
import { DB_NAME } from '../utils/constants';

export const connectDatabase = async (): Promise<void> => {
  try {
    mongoose.set('strictQuery', true);

    const conn = await mongoose.connect(config.mongo.uri, {
      dbName: DB_NAME,
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
    });

    logger.info(`✅ MongoDB connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);

    // Connection event handlers
    mongoose.connection.on('error', (err) => {
      logger.error({ err }, '❌ MongoDB connection error');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('✅ MongoDB reconnected');
    });
  } catch (error) {
    logger.error({ error }, '❌ Failed to connect to MongoDB');
    process.exit(1);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected gracefully');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from MongoDB');
  }
};
