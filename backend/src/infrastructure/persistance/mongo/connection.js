import mongoose from 'mongoose';
import { logger } from '../../../shared/logger.js';

export async function connectMongo(uri) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info('MongoDB connected', { uri });
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

// 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
export const isMongoConnected = () => mongoose.connection.readyState === 1;