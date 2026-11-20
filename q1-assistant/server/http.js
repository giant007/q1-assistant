import { AppError } from './errors.js';
import { logger } from './logger.js';

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

export function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) logger.error(err);
  return fail(res, status, err.code ?? 'INTERNAL', status >= 500 ? '服务内部错误' : err.message);
}
