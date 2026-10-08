import { AppError } from '../../../shared/errors.js';
import { DomainError } from '../../../domain/errors.js';
import { logger } from '../../../shared/logger.js';

// Domain error kinds -> HTTP status codes
const KIND_STATUS = { INVALID: 400, NOT_FOUND: 404, CONFLICT: 409 };

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.originalUrl} not found` },
  });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof DomainError) {
    return res.status(KIND_STATUS[err.kind] ?? 400).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
};