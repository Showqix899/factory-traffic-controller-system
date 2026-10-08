import { Router } from 'express';
import { isMongoConnected } from '../../../infrastructure/persistance/mongo/connection.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const database = isMongoConnected() ? 'UP' : 'DOWN';
  res.status(database === 'UP' ? 200 : 503).json({
    status: database === 'UP' ? 'OK' : 'DEGRADED',
    database,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});