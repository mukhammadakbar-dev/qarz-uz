export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const NotFound = (msg = 'Topilmadi') => new AppError(msg, 404, 'NOT_FOUND');
export const Unauthorized = (msg = 'Avtorizatsiya talab qilinadi') => new AppError(msg, 401, 'UNAUTHORIZED');
export const Forbidden = (msg = 'Ruxsat yo\'q') => new AppError(msg, 403, 'FORBIDDEN');
export const Conflict = (msg = 'Konflikt') => new AppError(msg, 409, 'CONFLICT');

// wraps async route handlers so thrown errors reach the error middleware
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
