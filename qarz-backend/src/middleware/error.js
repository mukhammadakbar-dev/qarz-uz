import { AppError } from '../utils/errors.js';
import { config } from '../config/index.js';

export const notFoundHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint topilmadi' } });
};

/**
 * Postgres errors that are really *client* mistakes, not server faults.
 *
 * Route params flow straight into typed columns, so a request like
 * GET /api/debtors/not-a-uuid or ?from=hello raises a data-type error from the
 * driver. Left unmapped those surfaced as 500 INTERNAL — noisy in monitoring
 * and misleading to callers, who cannot fix a "server error" by sending a
 * valid id. Mapped here once rather than guarded at every call site.
 */
const PG_CLIENT_ERRORS = {
  '22P02': { status: 400, code: 'BAD_INPUT', message: 'So\'rovdagi qiymat noto\'g\'ri formatda' },
  '22007': { status: 400, code: 'BAD_DATE', message: 'Sana formati noto\'g\'ri (YYYY-MM-DD)' },
  '22008': { status: 400, code: 'BAD_DATE', message: 'Sana formati noto\'g\'ri (YYYY-MM-DD)' },
  '22003': { status: 400, code: 'OUT_OF_RANGE', message: 'Qiymat juda katta' },
  '23505': { status: 409, code: 'CONFLICT', message: 'Bunday yozuv allaqachon mavjud' },
  '23503': { status: 409, code: 'FK_VIOLATION', message: 'Bog\'liq yozuv topilmadi' },
  '23514': { status: 422, code: 'CHECK_VIOLATION', message: 'Qiymat qoidaga mos emas' },
};

// Body-parser failures, raised before any route handler runs.
const BODY_ERRORS = {
  'entity.parse.failed': { status: 400, code: 'BAD_JSON', message: 'So\'rov tanasi yaroqsiz JSON' },
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'So\'rov hajmi juda katta' },
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }

  const mapped = PG_CLIENT_ERRORS[err.code] || BODY_ERRORS[err.type];
  if (mapped) {
    return res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message },
    });
  }

  // Genuinely unexpected: log with a stack, but never leak internals to callers.
  console.error('[error]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Serverda xatolik yuz berdi',
      ...(config.env === 'development' ? { detail: err.message } : {}),
    },
  });
};
