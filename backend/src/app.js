import express from 'express';
import cors from 'cors';
import { healthRouter } from './interfaces/http/routes/health.routes.js';
import { createApiRouter } from './interfaces/http/routes/api.routes.js';
import { errorHandler, notFoundHandler } from './interfaces/http/middleware/error-handler.js';

export function createApp({ service, simulator }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api', createApiRouter({ service, simulator }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}