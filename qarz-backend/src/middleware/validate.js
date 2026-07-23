import { AppError } from '../utils/errors.js';

/**
 * Validate req[source] against a zod schema.
 * On success replaces req[source] with parsed data.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return next(new AppError(msg, 422, 'VALIDATION_ERROR'));
  }
  req[source] = result.data;
  next();
};
