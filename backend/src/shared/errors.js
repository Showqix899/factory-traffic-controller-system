export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new AppError(message, { status: 400, code: 'BAD_REQUEST', details });

export const notFound = (message) =>
  new AppError(message, { status: 404, code: 'NOT_FOUND' });

export const conflict = (message, details) =>
  new AppError(message, { status: 409, code: 'CONFLICT', details });