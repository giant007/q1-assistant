export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new AppError(400, 'BAD_REQUEST', message);
export const notFound = (message) => new AppError(404, 'NOT_FOUND', message);
