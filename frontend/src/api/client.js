export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new ApiError('Backend unavailable', { status: 0, code: 'NETWORK_ERROR' });
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const err = body?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${response.status})`, {
      status: response.status,
      code: err.code,
      details: err.details,
    });
  }
  return body;
}
export const api = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
};