// Domain-level error. The HTTP layer maps `kind` to a status code; the domain knows nothing about HTTP.
export class DomainError extends Error {
  /** @param {'INVALID'|'NOT_FOUND'|'CONFLICT'} kind */
  constructor(kind, code, message) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    this.code = code;
  }
}